"use client";

import { useMemo } from "react";
import { assessHouse, assessPlan, roomBounds } from "@/domain/design/analysis";
import { assessHouseSense } from "@/domain/design/houseSense";
import { floorFor } from "@/domain/design/program";
import { DEFAULT_INTERIOR_STYLE } from "@/domain/design/renderRequest";
import { floorLabel, levelOf, storeysWord } from "@/domain/plan/levels";
import { INTERIOR_STYLE_LABEL } from "@/domain/project/schema";
import { DownloadIcon, WarningIcon } from "@/components/ui/icons";
import { useAreaText } from "@/components/units";
import { editor, useDocumentState, useProjectState, useSessionState } from "../../state/editor";
import { toolController } from "../../tools/instance";
import { ExteriorPicture } from "../designer/ConceptDetail";
import { useConcepts } from "../designer/concepts";
import { RoomGallery } from "../designer/RoomGallery";
import { MATERIAL_LABEL } from "../inspector/RoomInspector";
import { export3dModel, export3dPng, exportPlanPng, exportPresentationPng, exportProjectFile } from "../shell/exports";
import { usePhoneLayout } from "../shell/phone";
import { SendToComputer } from "../shell/SendToComputer";

/**
 * Step 5, Review: the chosen design summed up beside its plan. What it is,
 * how it looks, what to check (each linked to its room), every room with its
 * size and finish, its pictures, and the downloads. Nothing here changes the
 * plan; Refine does that.
 */
export function ReviewPanel() {
  const shown = useSessionState((s) => s.workspace === "review");
  if (!shown) return null;
  return <Review />;
}

/** Shows a room on the plan: its floor, picked, and in view. */
function showRoom(roomId: string) {
  const plan = editor.current();
  const level = levelOf(plan, roomId);
  if (!level) return;
  editor.setActiveLevel(level.id);
  editor.select({ kind: "room", id: roomId });
  const b = roomBounds(level, roomId);
  if (b) toolController.zoomTo({ minX: b.minX - 2, minY: b.minY - 2, maxX: b.maxX + 2, maxY: b.maxY + 2 }, true);
}

function Review() {
  const plan = useDocumentState((s) => s.history.present);
  const planId = useProjectState((s) => s.activePlanId);
  const label = useProjectState((s) => s.plans.find((p) => p.id === s.activePlanId)?.label);
  const selection = useSessionState((s) => s.selection);
  const style = useProjectState((s) => s.appearance?.interiorStyle) ?? DEFAULT_INTERIOR_STYLE;
  const { concepts } = useConcepts();
  const phone = usePhoneLayout();
  const areaText = useAreaText();
  const a = useMemo(() => assessHouse(plan), [plan]);
  const sense = useMemo(() => assessHouseSense(plan), [plan]);
  const concept = concepts.find((c) => c.meta.id === planId);
  const name = concept ? (concept.letter ? `${concept.letter} · ${concept.title}` : concept.title) : (label ?? "Your plan");
  const facts = [
    areaText(a.totalArea, 0),
    `${a.bedrooms} bed`,
    `${a.bathrooms} bath`,
    ...(a.storeys && a.storeys > 1 ? [storeysWord(a.storeys)] : []),
    ...(a.outside ? [`${a.outside.width.toFixed(1)} × ${a.outside.depth.toFixed(1)} m`] : []),
  ].join(" · ");

  return (
    <aside className="review-panel floating" aria-label="Review" data-chrome={phone ? "bottom" : "right"} data-testid="review-panel">
      <header className="review-header">
        <span className="review-kicker">Your design</span>
        <h2>{name}</h2>
        <p className="review-facts" data-testid="review-facts">
          {facts}
        </p>
        <p className="review-style" data-testid="review-style">
          {INTERIOR_STYLE_LABEL[style]} interior
        </p>
      </header>
      <div className="review-body">
        <ExteriorPicture planId={planId} level={plan} />

        <h3 className="detail-heading">Things to check</h3>
        {sense.findings.length ? (
          <ul className="review-checks" data-testid="review-checks">
            {sense.findings.map((f, i) => (
              <li key={i}>
                <button type="button" disabled={!f.roomIds.length} onClick={() => f.roomIds[0] && showRoom(f.roomIds[0])} data-testid="review-check">
                  <WarningIcon width={18} height={18} />
                  <span>{f.message}</span>
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="field-hint">Nothing obvious to fix.</p>
        )}

        <h3 className="detail-heading">Rooms</h3>
        <div className="room-schedule" data-testid="room-schedule">
          {plan.levels.map((level, i) => (
            <section key={level.id} aria-label={plan.levels.length > 1 ? floorLabel(plan, i) : "Rooms"}>
              {plan.levels.length > 1 && <p className="floor-group-label">{floorLabel(plan, i)}</p>}
              <ul>
                {assessPlan(level).rooms.map((r) => {
                  // The finish chosen, else the one its use usually has (as the plan draws it).
                  const room = level.rooms[r.id];
                  const finish = room?.floorMaterial ?? (room && room.type !== "unspecified" ? floorFor(room.type) : null);
                  const picked = selection?.kind === "room" && selection.id === r.id;
                  return (
                    <li key={r.id}>
                      <button type="button" className={picked ? "is-active" : undefined} onClick={() => showRoom(r.id)}>
                        <span className="schedule-name">{r.name}</span>
                        <span className="schedule-finish">{finish ? MATERIAL_LABEL[finish] : ""}</span>
                        <span className="schedule-area">{areaText(r.area, 1)}</span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            </section>
          ))}
          <p className="schedule-total">
            <span>Total floor area</span>
            <strong data-testid="review-total-area">{areaText(a.totalArea, 1)}</strong>
          </p>
        </div>

        <RoomGallery planId={planId} level={plan} />
      </div>
      <footer className="review-footer">
        <button type="button" className="btn btn-primary btn-block btn-lg" onClick={() => void exportPresentationPng()} data-testid="review-export-presentation">
          <DownloadIcon width={18} height={18} /> Download presentation image
        </button>
        <div className="review-downloads">
          <button type="button" className="btn btn-secondary btn-sm" onClick={exportPlanPng} data-testid="review-export-png">
            Plan image
          </button>
          <button type="button" className="btn btn-secondary btn-sm" onClick={exportProjectFile} data-testid="review-export-json">
            Project file
          </button>
          <button type="button" className="btn btn-secondary btn-sm" onClick={() => void export3dPng()} data-testid="review-export-3d-png">
            3D image
          </button>
          <button type="button" className="btn btn-secondary btn-sm" onClick={() => void export3dModel()} data-testid="review-export-glb">
            3D model
          </button>
        </div>
        {phone && <SendToComputer planId={planId} className="btn btn-secondary btn-block btn-md" />}
      </footer>
    </aside>
  );
}
