import { renderKey } from "@/domain/design/renderRequest";
import type { PlanDocument } from "@/domain/plan/types";
import { DEFAULT_APPEARANCE, type Appearance } from "@/domain/project/schema";
import type { RenderRecord } from "@/persistence/planStorage";
import type { EditorStores } from "./stores";

/**
 * Home's project covers: the chosen plan seen from the garden, rendered in
 * the editor a while after the last change and kept with the project's
 * photos as its "cover" view. Home only reads the picture, so three.js never
 * loads there; a project without one shows its plan drawing.
 */

export const COVER_VIEW = "cover";
/** How long the plan stays as it is before its cover is drawn again, ms. */
export const COVER_SETTLE = 5000;

export interface CoverDeps {
  still: (plan: PlanDocument, appearance: Appearance) => Promise<Blob | null>;
  put: (record: RenderRecord) => Promise<void>;
  now: () => string;
  /** Waits for the browser to be idle (setTimeout where there's no requestIdleCallback). */
  idle?: (run: () => void) => void;
}

/** Writes the project's cover after each settled change; returns the stop function. */
export function startCovers(stores: EditorStores, deps: CoverDeps, settle = COVER_SETTLE): () => void {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let last: string | null = null;
  let stopped = false;
  const idle = deps.idle ?? ((run: () => void) => (typeof requestIdleCallback === "function" ? requestIdleCallback(() => run()) : setTimeout(run, 0)));
  const write = async () => {
    const project = stores.project.getState();
    const plan = stores.documents.getState().history.present;
    const appearance = { ...DEFAULT_APPEARANCE, ...project.appearance };
    // The same outside, the same cover: nothing to draw.
    const key = `${project.id}/${project.activePlanId}/${renderKey(plan, { kind: "exterior" }, appearance, appearance.interiorStyle ?? "modern")}`;
    if (key === last) return;
    const blob = await deps.still(plan, appearance);
    if (!blob || stopped) return;
    last = key;
    await deps.put({ projectId: project.id, planId: project.activePlanId, view: COVER_VIEW, bytes: await blob.arrayBuffer(), mimeType: blob.type || "image/jpeg", sourceHash: key, style: "cover", model: "still", createdAt: deps.now() });
  };
  const schedule = () => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => idle(() => void write().catch(() => {})), settle);
  };
  const a = stores.documents.subscribe(schedule);
  const b = stores.project.subscribe(schedule);
  schedule();
  return () => {
    stopped = true;
    if (timer) clearTimeout(timer);
    a();
    b();
  };
}
