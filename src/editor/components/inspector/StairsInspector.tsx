"use client";

import type { StairChanges } from "@/domain/commands";
import { turn } from "@/domain/furniture/geometry";
import { staircasePlan, stairSpan, stairsLabel, stairStoreys } from "@/domain/geometry/stairs";
import type { PlanDocument, Staircase, StairShape } from "@/domain/plan/types";
import { Button, MenuItem, NumberField, ReadoutRow, SegmentedControl, SelectField } from "@/components/ui/controls";
import { RefreshIcon, TrashIcon } from "@/components/ui/icons";
import { editor } from "../../state/editor";
import { InspectorFrame, MM_FIELD, mm, run, Section } from "./frame";

const SHAPES: ReadonlyArray<{ value: StairShape; label: string }> = [
  { value: "straight", label: "Straight" },
  { value: "l", label: "L-shaped" },
  { value: "u", label: "U-shaped" },
];

const SHAPE_WORD: Record<StairShape, string> = { straight: "Straight", l: "L-shaped", u: "U-shaped, with a half landing" };

/**
 * Stairs are moved by dragging them; this card sets their shape and size
 * and how far up they go. The number and height of the steps follow from
 * the floors they climb between.
 */
export function StairsInspector({ plan, staircase }: { plan: PlanDocument; staircase: Staircase }) {
  const id = staircase.id;
  const update = (changes: StairChanges) => run({ type: "updateStairs", staircaseId: id, changes });
  const remove = () => editor.dispatch({ type: "deleteStairs", staircaseId: id });
  const p = staircasePlan(plan, staircase);
  const rise = Math.max(0, ...stairStoreys(plan, staircase)) / p.risers;
  const span = stairSpan(plan, staircase);
  const from = span ? plan.levels[span.from] : undefined;
  const above = span ? plan.levels.slice(span.from + 1) : [];
  const size = `${(p.bounds.maxX - p.bounds.minX).toFixed(2)} × ${(p.bounds.maxY - p.bounds.minY).toFixed(2)} m`;
  return (
    <InspectorFrame
      title={stairsLabel(plan, id)}
      summary={`${SHAPE_WORD[staircase.shape]} · ${p.risers} steps of ${mm(rise)} mm`}
      menu={
        <MenuItem onSelect={remove} data-testid="remove-stairs-menu">
          <span className="menu-item-main">
            <TrashIcon width={16} height={16} /> Remove stairs
          </span>
        </MenuItem>
      }
    >
      <Section>
        <SegmentedControl label="Shape" value={staircase.shape} options={SHAPES} onChange={(shape) => update({ shape })} testIdPrefix="stairs-shape" />
        {staircase.shape !== "straight" && (
          <SegmentedControl
            label="Turns"
            value={staircase.turn ?? "right"}
            options={[
              { value: "left", label: "Turns left" },
              { value: "right", label: "Turns right" },
            ]}
            onChange={(t) => update({ turn: t })}
            testIdPrefix="stairs-turn"
          />
        )}
        <Button onClick={() => update({ rotation: turn(staircase.rotation, -1) })} data-testid="stairs-rotate">
          <RefreshIcon width={16} height={16} /> Turn a quarter
        </Button>
      </Section>
      <Section>
        <div className="field-row">
          <NumberField label="Width" value={staircase.width} {...MM_FIELD} testId="stairs-width" onCommit={(width) => update({ width })} />
          <NumberField label="Tread depth" value={staircase.going} {...MM_FIELD} testId="stairs-going" onCommit={(going) => update({ going })} />
        </div>
        <ReadoutRow label="Steps" value={`${p.risers} of ${mm(rise)} mm`} testId="stairs-steps" />
        <ReadoutRow label="Takes up" value={size} />
        <p className="field-hint">Each storey gets as many steps as keep them under 220 mm. These are starting values, not building regulations.</p>
      </Section>
      <Section>
        <ReadoutRow label="From" value={from?.name ?? "—"} />
        {above.length > 1 ? (
          <SelectField label="Goes up to" value={staircase.toLevelId} options={above.map((l) => ({ value: l.id, label: l.name }))} onChange={(toLevelId) => update({ toLevelId })} testId="stairs-to" />
        ) : (
          <ReadoutRow label="Goes up to" value={plan.levels.find((l) => l.id === staircase.toLevelId)?.name ?? "—"} />
        )}
      </Section>
      <Section>
        <Button variant="danger" className="btn-block" onClick={remove} data-testid="remove-stairs">
          Remove stairs
        </Button>
      </Section>
    </InspectorFrame>
  );
}
