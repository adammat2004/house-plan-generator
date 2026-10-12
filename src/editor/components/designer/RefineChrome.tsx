"use client";

import { Menu, MenuItem } from "@/components/ui/controls";
import { ArrowLeftIcon, CheckIcon, ChevronDownIcon, CopyIcon, SplitIcon } from "@/components/ui/icons";
import { editor, useProjectState, useSessionState } from "../../state/editor";
import { inRefine } from "../../state/stores";
import { goToStep, openConcept } from "../shell/tools";
import { conceptName as nameOf, useConcepts, type Concept } from "./concepts";
import { PlanThumbnail } from "./PlanThumbnail";

/** A copy the user saved, or a room variation kept as a plan: listed under the plan it came from. */
const isCopy = (c: Concept) => c.meta.origin.kind === "user" || c.meta.scope.kind === "rooms";

/**
 * The project's plans in groups: the layouts, then the user's own house,
 * each with the copies made from it underneath.
 */
function groupPlans(concepts: Concept[]): Array<{ label: string; items: Array<{ concept: Concept; depth: number }> }> {
  const ids = new Set(concepts.map((c) => c.meta.id));
  const child = (c: Concept) => isCopy(c) && !!c.meta.parentId && ids.has(c.meta.parentId) && c.meta.parentId !== c.meta.id;
  const withCopies = (c: Concept, depth: number, seen: Set<string>): Array<{ concept: Concept; depth: number }> => {
    if (seen.has(c.meta.id)) return [];
    seen.add(c.meta.id);
    return [{ concept: c, depth }, ...concepts.filter((o) => child(o) && o.meta.parentId === c.meta.id).flatMap((o) => withCopies(o, Math.min(depth + 1, 2), seen))];
  };
  const seen = new Set<string>();
  const roots = concepts.filter((c) => !child(c));
  return [
    { label: "Layouts", items: roots.filter((c) => c.meta.origin.kind === "generated").flatMap((c) => withCopies(c, 0, seen)) },
    { label: "Your house", items: roots.filter((c) => c.meta.origin.kind !== "generated").flatMap((c) => withCopies(c, 0, seen)) },
  ].filter((g) => g.items.length > 0);
}

/**
 * Which plan Refine is working on, top left: back to all the layouts, and a
 * menu of the project's other plans to switch to, or a copy of this one to
 * try something without losing it.
 */
export function PlanPill() {
  const shown = useSessionState(inRefine);
  const activePlanId = useProjectState((s) => s.activePlanId);
  const { concepts, shells, recommendedId } = useConcepts();
  if (!shown) return null;
  const concept = concepts.find((c) => c.meta.id === activePlanId);
  const name = concept ? nameOf(concept) : (shells.find((s) => s.meta.id === activePlanId)?.meta.label ?? "Plan");
  return (
    <nav className="design-crumb plan-pill floating" aria-label="Plan" data-chrome="top">
      <button type="button" className="plan-back" onClick={() => goToStep("explore")} aria-label="All layouts" data-tooltip="All layouts" data-tooltip-side="bottom" data-testid="back-to-concepts">
        <ArrowLeftIcon width={16} height={16} />
      </button>
      <Menu
        label="Switch plan"
        className="plan-menu"
        testId="plan-menu"
        summary={
          <span className="plan-name">
            <span className="crumb-current" data-testid="current-concept">
              {name}
            </span>
            <ChevronDownIcon width={16} height={16} />
          </span>
        }
      >
        {groupPlans(concepts).map((group) => (
          <div key={group.label} role="group" aria-label={group.label}>
            <p className="menu-label">{group.label}</p>
            {group.items.map(({ concept: c, depth }) => (
              <MenuItem
                key={c.meta.id}
                className={depth ? `plan-copy depth-${depth}` : undefined}
                onSelect={() => c.meta.id !== activePlanId && openConcept(c.meta.id)}
                aria-current={c.meta.id === activePlanId || undefined}
                data-testid={`plan-option-${c.meta.label}`}
              >
                <span className="plan-option">
                  <PlanThumbnail level={c.level} plan={c.plan} palette="finish" className="plan-option-thumb" pad={0.3} />
                  <span className="plan-option-name">{nameOf(c)}</span>
                  {c.meta.id === activePlanId && <CheckIcon width={16} height={16} />}
                </span>
              </MenuItem>
            ))}
          </div>
        ))}
        <hr />
        {concepts.length > 1 && (
          <MenuItem
            onSelect={() => {
              const others = concepts.filter((c) => c.meta.id !== activePlanId);
              const other = others.find((c) => c.meta.id === recommendedId) ?? others[0];
              editor.comparePlansSideBySide(activePlanId, other.meta.id);
            }}
            data-testid="compare-plans"
          >
            <span className="menu-item-main">
              <SplitIcon width={16} height={16} /> Compare with another plan
            </span>
          </MenuItem>
        )}
        <MenuItem
          onSelect={() => {
            const id = editor.duplicatePlan();
            if (id) openConcept(id);
          }}
          data-testid="new-variation"
        >
          <span className="menu-item-main">
            <CopyIcon width={16} height={16} /> Save a copy as a variation
          </span>
        </MenuItem>
      </Menu>
    </nav>
  );
}
