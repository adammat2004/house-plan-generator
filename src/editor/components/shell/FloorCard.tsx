"use client";

import { PlusIcon } from "@/components/ui/icons";
import { LIMITS } from "@/domain/plan/defaults";
import { editor, useActiveLevel, useDocumentState, useSessionState } from "../../state/editor";
import { canEditPlan, inRefine, only3d } from "../../state/stores";
import { PlanThumbnail } from "../designer/PlanThumbnail";

/**
 * The house's floors, bottom left: each with a small drawing of it, the one
 * on show picked out, and "Add floor" where the plan can be edited. Looking
 * at another floor works everywhere the plan is shown, phones included.
 */
export function FloorCard() {
  const shown = useSessionState((s) => (inRefine(s) || s.workspace === "review" || s.workspace === "site") && !only3d(s));
  const editable = useSessionState(canEditPlan);
  const plan = useDocumentState((s) => s.history.present);
  const active = useActiveLevel();
  // A house of one floor, where nothing can be added, has nothing to choose between.
  if (!shown || (plan.levels.length < 2 && !editable)) return null;
  const full = plan.levels.length >= LIMITS.maxLevels;
  return (
    <div className="floor-card floating" aria-label="Floors">
      <div className="floor-rows" role="radiogroup" aria-label="Floor">
        {plan.levels.map((level) => {
          const on = level.id === active.id;
          return (
            <button
              key={level.id}
              type="button"
              role="radio"
              aria-checked={on}
              className={`floor-row${on ? " is-active" : ""}`}
              onClick={() => editor.setActiveLevel(level.id)}
              data-testid={`floor-${level.id}`}
            >
              <PlanThumbnail level={level} plan={plan} palette="finish" className="floor-thumb" pad={0.4} />
              <span className="floor-name">{level.name}</span>
            </button>
          );
        })}
      </div>
      {editable && (
        <button
          type="button"
          className="floor-add"
          aria-disabled={full || undefined}
          data-tooltip={full ? `A house can have at most ${LIMITS.maxLevels} floors` : "Add a floor above"}
          data-tooltip-side="right"
          onClick={() => !full && editor.addFloor()}
          data-testid="add-floor"
        >
          <PlusIcon width={16} height={16} /> Add floor
        </button>
      )}
    </div>
  );
}
