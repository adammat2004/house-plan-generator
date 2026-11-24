"use client";

import { useState } from "react";
import type { StillTarget } from "@/domain/design/renderRequest";
import type { PlanDocument } from "@/domain/plan/types";
import { CloseIcon, SparkleIcon, TargetIcon } from "@/components/ui/icons";
import { IconButton } from "@/components/ui/controls";
import { editor, editorStores, renders, useDocumentState, useProjectState, useRenders, useSessionState } from "../../state/editor";
import { inRefine, type SessionState } from "../../state/stores";
import { chooseView } from "../shell/tools";
import { RoomGallery, useLook } from "./RoomGallery";
import { useStill } from "./useStill";

/**
 * Furnish & Render: furnishes the rooms that are empty, shows the plan
 * furnished, and opens the house and every room as pictures, with the
 * house and interior styles to render them in.
 */
export function furnishAndRender() {
  chooseView("furnished");
  // Rooms that are already furnished stay as they are; say nothing if there's nothing to add.
  editor.furnishAll(false, true);
  editor.setRenderOpen(true);
}

/** Over the top right of the plan in Refine, above the 3D card. */
export function FurnishRenderButton() {
  const refining = useSessionState(inRefine);
  const readOnly = useSessionState((s) => s.readOnly);
  const open = useSessionState((s) => s.renderOpen);
  if (!refining || readOnly || open) return null;
  return (
    <button type="button" className="btn btn-primary btn-md furnish-render" onClick={furnishAndRender} data-testid="furnish-render">
      <SparkleIcon width={16} height={16} /> Furnish &amp; Render
    </button>
  );
}

export function RenderPanel() {
  const open = useSessionState((s) => s.renderOpen && inRefine(s));
  const planId = useProjectState((s) => s.activePlanId);
  const plan = useDocumentState((s) => s.history.present);
  if (!open) return null;
  return (
    <aside className="render-panel floating" aria-label="Furnish and render" data-testid="render-panel">
      <header className="render-panel-head">
        <div>
          <h2>Furnish &amp; Render</h2>
          <p>The rooms are furnished. Pick a style, then render the house and its rooms as photos.</p>
        </div>
        <IconButton label="Close" onClick={() => editorStores.session.setState({ renderOpen: false })} data-testid="render-panel-close">
          <CloseIcon width={18} height={18} />
        </IconButton>
      </header>
      <div className="render-panel-body">
        <CameraViews plan={plan} />
        <RoomGallery planId={planId} level={plan} />
      </div>
    </aside>
  );
}

const SPOT_TILE = { width: 320, height: 240 };

/** Views from a camera put down on the plan: the 3D view at once, and a photo of it on request. */
function CameraViews({ plan }: { plan: PlanDocument }) {
  const picking = useSessionState((s) => s.cameraPick);
  const spots = useSessionState((s) => s.cameraSpots);
  return (
    <section className="camera-views" aria-label="Views from a spot" data-testid="camera-views">
      <div className="camera-views-head">
        <div>
          <h3>Views from a spot</h3>
          <p>{picking ? (picking.eye ? "Now click what the camera looks at." : "Click on the plan where you'd stand. Esc stops.") : "Stand anywhere in a room and look where you like."}</p>
        </div>
        <button
          type="button"
          className={`btn btn-md ${picking ? "btn-primary" : "btn-secondary"}`}
          onClick={() => editorStores.session.setState({ cameraPick: picking ? null : { eye: null } })}
          aria-pressed={!!picking}
          data-testid="camera-pick"
        >
          <TargetIcon width={16} height={16} /> {picking ? "Stop" : "Put a camera down"}
        </button>
      </div>
      {spots.length > 0 && (
        <ul className="camera-views-grid">
          {spots.map((spot) => (
            <SpotTile key={spot.id} plan={plan} spot={spot} />
          ))}
        </ul>
      )}
    </section>
  );
}

function SpotTile({ plan, spot }: { plan: PlanDocument; spot: SessionState["cameraSpots"][number] }) {
  const { appearance, style } = useLook();
  const available = useRenders((s) => s.available);
  const target: StillTarget = { kind: "room", roomId: spot.roomId, spot: { eye: spot.eye, look: spot.look } };
  const { ref, url } = useStill(plan, target, SPOT_TILE, appearance);
  const [photo, setPhoto] = useState<{ url: string } | { error: string } | "busy" | null>(null);
  const name = plan.levels.find((l) => spot.roomId in l.rooms)?.rooms[spot.roomId]?.name ?? "Room";
  const render = async () => {
    setPhoto("busy");
    const result = await renders.renderOne(plan, target, appearance, style);
    setPhoto(result.ok ? { url: result.url } : { error: result.message });
  };
  const shown = photo && typeof photo === "object" && "url" in photo ? photo.url : url;
  return (
    <li className="camera-view" ref={ref} data-testid="camera-view">
      {/* eslint-disable-next-line @next/next/no-img-element -- a still drawn in the browser */}
      {shown ? <img src={shown} alt={`${name} from the camera you put down`} /> : <span className="camera-view-empty" aria-hidden />}
      <div className="camera-view-foot">
        <strong>{name}</strong>
        <span>
          <button type="button" className="link-btn" disabled={available !== "yes" || photo === "busy"} onClick={() => void render()} title={available === "yes" ? "Turns this view into a photo, in about ten seconds" : "Photos need the image service"} data-testid="camera-view-photo">
            <SparkleIcon width={13} height={13} /> {photo === "busy" ? "Making a photo…" : "Photo"}
          </button>
          <button type="button" className="link-btn" onClick={() => editorStores.session.setState((s) => ({ cameraSpots: s.cameraSpots.filter((x) => x.id !== spot.id) }))} aria-label={`Remove the view of ${name}`}>
            Remove
          </button>
        </span>
      </div>
      {photo && typeof photo === "object" && "error" in photo && <p className="field-error">{photo.error}</p>}
    </li>
  );
}
