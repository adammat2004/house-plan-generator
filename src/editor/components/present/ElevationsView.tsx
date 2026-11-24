"use client";

import { useMemo } from "react";
import { DownloadIcon } from "@/components/ui/icons";
import { takesWallColour, effectiveRoofPitch } from "@/domain/project/exterior";
import { DEFAULT_APPEARANCE } from "@/domain/project/schema";
import { buildElevations, type Elevation } from "../../rendering/drawing/elevations";
import { DOOR_COLOUR, EXTERIOR, FRAMES, ROOF, WALL_COLOUR } from "../../rendering/three/exteriorPalette";
import { useDocumentState, useProjectState } from "../../state/editor";
import { exportPdf } from "../shell/drawingExports";

const MARGIN = 0.6;

function ElevationDrawing({ elevation, wall, roof, frame, door }: { elevation: Elevation; wall: string; roof: string; frame: string; door: string }) {
  const { u0, u1, top } = elevation.extent;
  const width = u1 - u0 + MARGIN * 2;
  const height = top + MARGIN * 2;
  const x = (u: number) => u - u0 + MARGIN;
  const y = (z: number) => top - z + MARGIN;
  const rect = (r: { u0: number; u1: number; z0: number; z1: number }) => ({ x: x(r.u0), y: y(r.z1), width: r.u1 - r.u0, height: r.z1 - r.z0 });
  const far = (a: { depth: number }, b: { depth: number }) => b.depth - a.depth;
  return (
    <figure className="elevation" data-testid="elevation">
      <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label={elevation.title}>
        <line x1={0} x2={width} y1={y(0)} y2={y(0)} className="elevation-ground" />
        {[...elevation.walls].sort(far).map((w, i) => (
          <rect key={`w${i}`} {...rect(w)} fill={wall} className="elevation-wall" />
        ))}
        {[...elevation.bands].sort(far).map((b, i) => (
          <rect key={`b${i}`} {...rect(b)} fill={roof} className="elevation-band" />
        ))}
        {[...elevation.roofs].sort(far).map((r, i) => (
          <polygon key={`r${i}`} points={r.points.map((p) => `${x(p.u)},${y(p.z)}`).join(" ")} fill={roof} className="elevation-roof" />
        ))}
        {[...elevation.openings].sort(far).map((o, i) => (
          <rect key={`o${i}`} {...rect(o)} fill={o.kind === "door" ? door : "#c9dce6"} stroke={frame} strokeWidth={0.06} className={`elevation-${o.kind}`} />
        ))}
      </svg>
      <figcaption>{elevation.title}</figcaption>
    </figure>
  );
}

/** The house's four elevations, drawn from the plan with its current roof, pitch and finishes. Read only. */
export function ElevationsView() {
  const plan = useDocumentState((s) => s.history.present);
  const stored = useProjectState((s) => s.appearance);
  const appearance = useMemo(() => ({ ...DEFAULT_APPEARANCE, ...stored }), [stored]);
  const pitch = effectiveRoofPitch(appearance);
  const elevations = useMemo(() => buildElevations(plan, appearance.roofForm, pitch), [plan, appearance.roofForm, pitch]);
  const wall = appearance.wallColour && takesWallColour(appearance.exterior) ? WALL_COLOUR[appearance.wallColour] : EXTERIOR[appearance.exterior];
  const door = appearance.doorColour ? DOOR_COLOUR[appearance.doorColour] : "#7b5a40";
  return (
    <section className="elevations-view" aria-label="Elevations" data-testid="elevations-view">
      <header>
        <h2>Elevations</h2>
        <button type="button" className="btn btn-secondary btn-sm" onClick={() => void exportPdf()} data-testid="elevations-download">
          <DownloadIcon width={16} height={16} /> Download drawings (PDF)
        </button>
      </header>
      {elevations.length === 0 ? (
        <p className="elevations-empty">Draw a closed outline for the house to see its elevations.</p>
      ) : (
        <div className="elevations-grid">
          {elevations.map((e) => (
            <ElevationDrawing key={e.side} elevation={e} wall={wall} roof={ROOF[appearance.roof]} frame={FRAMES[appearance.frames]} door={door} />
          ))}
        </div>
      )}
    </section>
  );
}
