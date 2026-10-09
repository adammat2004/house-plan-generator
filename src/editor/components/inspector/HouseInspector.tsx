"use client";

import { describeEntity } from "@/domain/commands";
import { analyzeEnvelope } from "@/domain/geometry/envelope";
import { describeOutline } from "@/domain/geometry/outlineDescription";
import type { Level } from "@/domain/plan/types";
import { Button, NumberField, ReadoutRow } from "@/components/ui/controls";
import { editorStores } from "../../state/editor";
import { InspectorFrame, mm, run, Section } from "./frame";

/** The house outline as a whole: shape, outside size and fixed shell properties. */
export function HouseInspector({ level }: { level: Level }) {
  const env = analyzeEnvelope(level);
  if (!env.ok) {
    return (
      <InspectorFrame title="House" summary={env.message}>
        {null}
      </InspectorFrame>
    );
  }
  const info = env.info;
  const words = describeOutline(info).words;
  const shape = info.isRectangle ? "" : `${words[0].toUpperCase()}${words.slice(1)} · `;
  return (
    <InspectorFrame title="House" summary={`${shape}${info.width.toFixed(3)} × ${info.depth.toFixed(3)} m outside`}>
      <Section>
        <div className="field-row">
          <NumberField label="Width" value={info.width} testId="house-width" onCommit={(width) => run({ type: "resizeFootprint", width })} />
          <NumberField label="Depth" value={info.depth} testId="house-depth" onCommit={(depth) => run({ type: "resizeFootprint", depth })} />
        </div>
        <p className="field-hint">
          {info.isRectangle
            ? "Outside face to outside face. The south-west corner stays fixed."
            : "The overall size, outside face to outside face. Changing it moves the easternmost or northernmost walls; the south-west corner stays fixed."}
        </p>
      </Section>
      <Section>
        <ReadoutRow label="Shape" value={info.isRectangle ? "Rectangle" : `${words}, ${info.edges.length} walls`} testId="house-shape" />
        <ReadoutRow label="Floor area (gross)" value={`${info.grossArea.toFixed(1)} m²`} testId="house-area" />
        <ReadoutRow label="External walls" value={`${mm(info.externalThickness)} mm`} />
        <ReadoutRow label="Wall height" value={`${mm(level.defaultWallHeight)} mm`} />
        <ReadoutRow label="Rear wall" value={level.rearWallId ? describeEntity(level, level.rearWallId) : "Not set"} testId="rear-wall-readout" />
      </Section>
      <Section>
        <Button className="btn-block" data-testid="change-shape" onClick={() => editorStores.session.setState({ createDialogOpen: true })}>
          Change shape…
        </Button>
        <p className="field-hint">Starts a new house of another shape. You can undo it.</p>
      </Section>
    </InspectorFrame>
  );
}
