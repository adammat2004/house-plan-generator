"use client";

import { useEffect, useMemo, useState } from "react";
import { DEFAULT_INTERIOR_STYLE, EXTERIOR_ANGLES, exteriorTarget, renderKey, targetKey, type ExteriorAngle, type ExteriorLight } from "@/domain/design/renderRequest";
import { DEFAULT_APPEARANCE } from "@/domain/project/schema";
import { renders, useDocumentState, useProjectState, useRenders } from "../../state/editor";

const ANGLE_LABEL: Record<ExteriorAngle, string> = { front: "Front", rear: "Rear", aerial: "From above" };
const LIGHT_LABEL: Record<ExteriorLight, string> = { day: "Day", dusk: "Dusk" };

/**
 * The house from the front, the back and above, in day or dusk light. Each
 * view is its own saved photo; until one is rendered, or if its render
 * fails, the tile shows the 3D view instead.
 */
export function ExteriorGallery() {
  const plan = useDocumentState((s) => s.history.present);
  const planId = useProjectState((s) => s.activePlanId);
  const stored = useProjectState((s) => s.appearance);
  const appearance = useMemo(() => ({ ...DEFAULT_APPEARANCE, ...stored }), [stored]);
  const style = appearance.interiorStyle ?? DEFAULT_INTERIOR_STYLE;
  const photos = useRenders((s) => s.byPlan[planId]);
  const fallbacks = useRenders((s) => s.fallbacks[planId]);
  const batch = useRenders((s) => s.batch);
  const error = useRenders((s) => s.error);
  const available = useRenders((s) => s.available);
  const [light, setLight] = useState<ExteriorLight>("day");
  const targets = useMemo(() => EXTERIOR_ANGLES.map((angle) => exteriorTarget(angle, light)), [light]);

  useEffect(() => {
    for (const target of targets) void renders.showStill(planId, plan, target, appearance, style);
  }, [targets, planId, plan, appearance, style]);

  const running = !!batch;
  return (
    <section className="exterior-gallery" aria-label="Exterior gallery" data-testid="exterior-gallery">
      <header>
        <h2>Exterior gallery</h2>
        <div className="exterior-gallery-actions">
          <div role="group" aria-label="Lighting" className="segmented">
            {(["day", "dusk"] as const).map((l) => (
              <button key={l} type="button" className={`btn btn-ghost btn-sm${light === l ? " is-active" : ""}`} aria-pressed={light === l} onClick={() => setLight(l)} data-testid={`gallery-light-${l}`}>
                {LIGHT_LABEL[l]}
              </button>
            ))}
          </div>
          <button
            type="button"
            className="btn btn-primary btn-sm"
            disabled={running}
            onClick={() => void renders.renderPlan(planId, plan, appearance, style, { targets })}
            data-testid="gallery-render-all"
          >
            {running ? "Rendering…" : `Render all ${LIGHT_LABEL[light].toLowerCase()} views`}
          </button>
        </div>
      </header>
      {available === "no" && <p className="exterior-gallery-note">The photo service isn't set up here, so these are 3D views.</p>}
      {error && (
        <p className="exterior-gallery-note is-error" role="alert" data-testid="gallery-error">
          {error} Showing the 3D view instead.
        </p>
      )}
      <ul className="exterior-gallery-grid">
        {targets.map((target) => {
          const key = targetKey(target);
          const hash = renderKey(plan, target, appearance, style);
          const photo = photos?.[key];
          const fallback = fallbacks?.[key];
          const kind = photo ? (photo.sourceHash === hash ? "photo" : "stale") : fallback ? "still" : "none";
          const url = photo?.url ?? fallback?.url;
          return (
            <li key={key} className="exterior-gallery-tile" data-testid="gallery-tile" data-kind={kind} data-view={key}>
              {url ? <img src={url} alt={`${ANGLE_LABEL[target.angle ?? "front"]} view, ${LIGHT_LABEL[target.light ?? "day"].toLowerCase()}`} /> : <div className="exterior-gallery-empty">Drawing 3D view…</div>}
              <div className="exterior-gallery-caption">
                <span>{ANGLE_LABEL[target.angle ?? "front"]}</span>
                <span className="exterior-gallery-badge">{kind === "photo" ? "Rendered" : kind === "stale" ? "Out of date" : "3D view"}</span>
                <button type="button" className="btn btn-secondary btn-sm" disabled={running} onClick={() => void renders.renderPlan(planId, plan, appearance, style, { targets: [target], force: true })} data-testid="gallery-render">
                  {kind === "photo" ? "Redo" : "Render"}
                </button>
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
