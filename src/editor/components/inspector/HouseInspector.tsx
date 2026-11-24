"use client";

import { describeEntity } from "@/domain/commands";
import { analyzeEnvelope } from "@/domain/geometry/envelope";
import { describeOutline } from "@/domain/geometry/outlineDescription";
import { DEFAULT_HOUSE, LIMITS } from "@/domain/plan/defaults";
import { levelIndex } from "@/domain/plan/levels";
import type { Level } from "@/domain/plan/types";
import { Button, NumberField, ReadoutRow, TextField } from "@/components/ui/controls";
import { lengthText, sizeText, useAreaText } from "@/components/units";
import { editor, editorStores, useDocumentState, useSessionState } from "../../state/editor";
import { InspectorFrame, MM_FIELD, mm, run, Section } from "./frame";

/**
 * The house outline as a whole: shape, outside size and fixed shell
 * properties. On a house of several floors, the floor on show, with its
 * height and the controls to add and remove floors.
 */
export function HouseInspector({ level }: { level: Level }) {
  const areaText = useAreaText();
  const plan = useDocumentState((s) => s.history.present);
  const index = Math.max(0, levelIndex(plan, level.id));
  const upper = index > 0;
  const env = analyzeEnvelope(level);
  if (!env.ok) {
    return (
      <InspectorFrame title={upper ? level.name : "House"} summary={env.message}>
        {null}
      </InspectorFrame>
    );
  }
  const info = env.info;
  const words = describeOutline(info).words;
  const shape = info.isRectangle ? "" : `${words[0].toUpperCase()}${words.slice(1)} · `;
  const levelId = upper ? { levelId: level.id } : {};
  return (
    <InspectorFrame title={upper ? level.name : "House"} summary={`${shape}${sizeText(info.width, info.depth, 3)} outside`}>
      <Section>
        <div className="field-row">
          <NumberField label="Width" value={info.width} testId="house-width" onCommit={(width) => run({ type: "resizeFootprint", width, ...levelId })} />
          <NumberField label="Depth" value={info.depth} testId="house-depth" onCommit={(depth) => run({ type: "resizeFootprint", depth, ...levelId })} />
        </div>
        <p className="field-hint">
          {upper
            ? "This floor's outside size. It can be smaller than the floor below, never bigger."
            : info.isRectangle
              ? `Outside face to outside face. The south-west corner stays fixed${plan.levels.length > 1 ? ", and floors above that line up move too" : ""}.`
              : "The overall size, outside face to outside face. Changing it moves the easternmost or northernmost walls; the south-west corner stays fixed."}
        </p>
      </Section>
      <Section>
        <ReadoutRow label="Shape" value={info.isRectangle ? "Rectangle" : `${words}, ${info.edges.length} walls`} testId="house-shape" />
        <ReadoutRow label="Floor area (gross)" value={areaText(info.grossArea, 1)} testId="house-area" />
        <ReadoutRow label="External walls" value={`${mm(info.externalThickness)} mm`} />
        {plan.levels.length === 1 && <ReadoutRow label="Wall height" value={`${mm(level.defaultWallHeight)} mm`} />}
        <ReadoutRow label="Garden side" value={level.rearWallId ? describeEntity(level, level.rearWallId) : "Not set"} testId="rear-wall-readout" />
      </Section>
      <FloorsSection level={level} index={index} count={plan.levels.length} />
      {!upper && (
        <Section>
          <Button className="btn-block" data-testid="change-shape" onClick={() => editorStores.session.setState({ createDialogOpen: true })}>
            Change shape…
          </Button>
          <p className="field-hint">Starts a new house of another shape{plan.levels.length > 1 ? ", and the floors above start again over it" : ""}. You can undo it.</p>
        </Section>
      )}
    </InspectorFrame>
  );
}

/** The floor's name, ceiling height and how it stands on the one below; adding and removing floors. */
function FloorsSection({ level, index, count }: { level: Level; index: number; count: number }) {
  const readOnly = useSessionState((s) => s.readOnly);
  const full = count >= LIMITS.maxLevels;
  const add = !readOnly && !full && (
    <Button className="btn-block" onClick={() => editor.addFloor()} data-testid="inspector-add-floor">
      Add a floor above
    </Button>
  );
  if (count === 1) {
    return (
      <Section>
        {add}
        <p className="field-hint">A new floor starts with the outline of the one below. Pull its walls in for a smaller floor, such as over a single-storey extension.</p>
      </Section>
    );
  }
  const update = (changes: { name?: string; wallHeight?: number; floorThickness?: number }) => run({ type: "updateLevel", levelId: level.id, ...changes });
  return (
    <Section>
      <TextField label="Floor name" value={level.name} testId="floor-name" onCommit={(name) => update({ name })} />
      <NumberField label="Ceiling height" value={level.defaultWallHeight} {...MM_FIELD} testId="floor-ceiling" hint="Every wall on this floor. Floors above move up or down with it." onCommit={(wallHeight) => update({ wallHeight })} />
      {index > 0 && (
        <>
          <NumberField label="Floor thickness" value={level.floorThickness ?? DEFAULT_HOUSE.floorThickness} {...MM_FIELD} testId="floor-thickness" hint="From the ceiling below to this floor." onCommit={(floorThickness) => update({ floorThickness })} />
          <ReadoutRow label="Floor level" value={`${lengthText(level.elevation, 2)} above the ground floor`} testId="floor-level" />
        </>
      )}
      {add}
      {full && <p className="field-hint">A house can have at most {LIMITS.maxLevels} floors.</p>}
      {index > 0 && !readOnly && (
        <Button variant="danger" className="btn-block" onClick={() => editor.removeFloor(level.id)} data-testid="remove-floor">
          Remove this floor
        </Button>
      )}
    </Section>
  );
}
