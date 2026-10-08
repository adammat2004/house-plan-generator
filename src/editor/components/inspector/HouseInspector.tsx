"use client";

import { describeEntity } from "@/domain/commands";
import { analyzeEnvelope } from "@/domain/geometry/envelope";
import type { Level } from "@/domain/plan/types";
import { NumberField, ReadoutRow } from "@/components/ui/controls";
import { InspectorFrame, mm, run, Section } from "./frame";

/** The rectangular envelope as a whole: outside size and fixed shell properties. */
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
  return (
    <InspectorFrame title="House" summary={`${info.width.toFixed(3)} × ${info.depth.toFixed(3)} m outside`}>
      <Section>
        <div className="field-row">
          <NumberField label="Width" value={info.width} testId="house-width" onCommit={(width) => run({ type: "resizeFootprint", width })} />
          <NumberField label="Depth" value={info.depth} testId="house-depth" onCommit={(depth) => run({ type: "resizeFootprint", depth })} />
        </div>
        <p className="field-hint">Outside face to outside face. The south-west corner stays fixed.</p>
      </Section>
      <Section>
        <ReadoutRow label="External walls" value={`${mm(info.thickness.south)} mm`} />
        <ReadoutRow label="Wall height" value={`${mm(level.defaultWallHeight)} mm`} />
        <ReadoutRow label="Rear wall" value={level.rearWallId ? describeEntity(level, level.rearWallId) : "Not set"} testId="rear-wall-readout" />
      </Section>
    </InspectorFrame>
  );
}
