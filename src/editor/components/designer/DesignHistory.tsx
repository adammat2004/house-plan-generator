"use client";

import { pickedBathrooms, pickedBedrooms } from "@/domain/brief/rooms";
import type { HouseBrief } from "@/domain/brief/schema";
import type { PlanVariantMeta } from "@/domain/project/schema";
import { editor, useProjectState } from "../../state/editor";
import { openConcept } from "../shell/tools";
import { PlanThumbnail } from "./PlanThumbnail";
import { roomInstances } from "./Studio";

/**
 * Design history: every Create, newest first, with the layouts it made and
 * the rooms it was made from. Open a layout from any run, or bring a run's
 * rooms back to try again from there.
 */

export interface DesignRun {
  requestId: string;
  at?: string;
  brief?: HouseBrief;
  plans: PlanVariantMeta[];
}

/** The project's generated layouts grouped by the Create that made them, newest first. */
export function designRuns(plans: readonly PlanVariantMeta[]): DesignRun[] {
  const runs = new Map<string, DesignRun>();
  for (const p of plans) {
    if (p.origin.kind !== "generated" || p.scope.kind !== "plan") continue;
    const run = runs.get(p.origin.requestId) ?? { requestId: p.origin.requestId, at: p.origin.at, brief: p.origin.brief, plans: [] };
    run.plans.push(p);
    runs.set(p.origin.requestId, run);
  }
  return [...runs.values()].reverse();
}

const when = (at: string | undefined) =>
  at ? new Date(at).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) : "Earlier";

export function DesignHistory() {
  const plans = useProjectState((s) => s.plans);
  const current = useProjectState((s) => JSON.stringify(s.brief.rooms ?? null));
  const runs = designRuns(plans);
  if (!runs.length) return <p className="studio-empty">Nothing yet. Each time you press Create, its layouts are kept here.</p>;
  return (
    <ol className="design-history" data-testid="design-history-list">
      {runs.map((run, i) => {
        const picks = run.brief?.rooms;
        const same = !!picks && JSON.stringify(picks) === current;
        return (
          <li key={run.requestId} className="design-run" data-testid="design-run">
            <header>
              <strong>Run {runs.length - i}</strong>
              <span>{when(run.at)}</span>
            </header>
            {picks && (
              <p className="design-run-facts">
                {pickedBedrooms(picks)} bed · {pickedBathrooms(picks)} bath · {roomInstances(picks).length} rooms
                {run.brief?.storeys === 2 ? " · 2 storeys" : ""}
              </p>
            )}
            <div className="design-run-plans">
              {run.plans.map((p) => {
                const doc = editor.planDocument(p.id);
                return (
                  <button key={p.id} type="button" className="design-run-plan" onClick={() => openConcept(p.id)} title={`Open ${p.label}`} data-testid={`history-open-${p.label}`}>
                    {doc && <PlanThumbnail level={doc.levels[0]} palette="schematic" className="design-run-thumb" pad={0.4} />}
                    <span>{p.label.replace(/^Plan /, "")}</span>
                  </button>
                );
              })}
            </div>
            {run.brief && (
              <button type="button" className="link-btn" disabled={same} onClick={() => editor.setBrief(run.brief!)} data-testid="history-use-rooms">
                {same ? "These are your rooms now" : "Use these rooms again"}
              </button>
            )}
          </li>
        );
      })}
    </ol>
  );
}
