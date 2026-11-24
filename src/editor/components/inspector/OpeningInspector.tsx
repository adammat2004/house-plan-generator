"use client";

import { describeEntity } from "@/domain/commands";
import { deriveLevelGeometry, openingHostInterval } from "@/domain/geometry/derive";
import { roundToPrecision } from "@/domain/geometry/numeric";
import { OPENING_PRESETS } from "@/domain/plan/defaults";
import type { Door, Level, Opening, Window } from "@/domain/plan/types";
import { Button, MenuItem, NumberField, ReadoutRow } from "@/components/ui/controls";
import { ChevronDownIcon, FlipHingeIcon, FlipSwingIcon, TrashIcon } from "@/components/ui/icons";
import { editor } from "../../state/editor";
import { InspectorFrame, lowerFirst, MoreSettings, mm, run, Section } from "./frame";
import { friendlyName } from "./names";
import { DoorArt, WindowArt } from "./openingArt";
import { lengthText } from "@/components/units";

const M_FIELD = { unit: "m", decimals: 3 } as const;

/**
 * Doors and windows are moved by dragging them along their wall; this card
 * offers size presets and exact sizes, a position slider, and precise
 * offsets on request.
 */
export function OpeningInspector({ level, opening }: { level: Level; opening: Opening }) {
  const id = opening.id;
  const update = (changes: Partial<Door> | Partial<Window>) => run({ type: "updateOpening", openingId: id, changes });
  const geometry = deriveLevelGeometry(level);
  const axis = geometry.axes.get(opening.wallId);
  const [lo, hi] = openingHostInterval(geometry, opening) ?? [0, opening.offset + opening.width];
  const centre = () => update({ offset: roundToPrecision((lo + hi - opening.width) / 2) });
  return (
    <InspectorFrame
      title={friendlyName(level, id)}
      summary={`On ${lowerFirst(friendlyName(level, opening.wallId))}`}
      menu={<MenuItem onSelect={centre}>Centre on wall</MenuItem>}
    >
      <div className="product-row">
        <span className="product-thumb">{opening.kind === "door" ? <DoorArt /> : <WindowArt />}</span>
        <div className="product-info">
          <strong data-testid="opening-size">
            {mm(opening.width)} × {mm(opening.height)} mm
          </strong>
          <PresetPicker opening={opening} onPick={update} />
        </div>
      </div>
      {opening.kind === "door" && (
        <Section title="Which way it opens">
          <div className="button-row">
            <Button onClick={() => update({ hinge: opening.hinge === "start" ? "end" : "start" })} data-testid="flip-hinge">
              <FlipHingeIcon width={16} height={16} /> Flip hinge
            </Button>
            <Button onClick={() => update({ swingSide: opening.swingSide === "left" ? "right" : "left" })} data-testid="flip-swing">
              <FlipSwingIcon width={16} height={16} /> Flip side
            </Button>
          </div>
        </Section>
      )}
      <Section title="Size">
        <NumberField label="Width" value={opening.width} {...M_FIELD} testId="opening-width" onCommit={(width) => update({ width })} />
        <NumberField label="Height" value={opening.height} {...M_FIELD} testId="opening-height" onCommit={(height) => update({ height })} />
        {opening.kind === "window" && (
          <NumberField label="Sill height" value={opening.sillHeight} {...M_FIELD} testId="opening-sill" onCommit={(sillHeight) => update({ sillHeight })} />
        )}
      </Section>
      <Section>
        <PositionControl level={level} opening={opening} />
      </Section>
      <MoreSettings>
        <NumberField
          label="Offset from wall start"
          value={opening.offset}
          testId="opening-offset"
          hint="Along the wall centreline to the near edge of the opening."
          onCommit={(offset) => update({ offset })}
        />
        <Clearances level={level} opening={opening} onCentre={centre} />
        <ReadoutRow label="Wall" value={describeEntity(level, opening.wallId)} />
        <ReadoutRow label="Wall length" value={axis ? lengthText(axis.length, 3) : "—"} />
      </MoreSettings>
      <div className="card-footer">
        <Button variant="danger" className="btn-block" onClick={() => run({ type: "deleteOpening", openingId: id })} data-testid="delete-opening">
          <TrashIcon width={18} height={18} /> Delete {opening.kind}
        </Button>
      </div>
    </InspectorFrame>
  );
}

const CUSTOM = "custom";

/** Named sizes for the opening; "Custom" when the current size matches none. */
function PresetPicker({ opening, onPick }: { opening: Opening; onPick: (changes: Partial<Door> | Partial<Window>) => void }) {
  const presets = OPENING_PRESETS[opening.kind];
  const same = (a: number, b: number) => Math.abs(a - b) < 0.0005;
  const current = presets.find(
    (p) => same(p.width, opening.width) && same(p.height, opening.height) && (opening.kind === "door" || same(p.sillHeight ?? 0, opening.sillHeight)),
  );
  return (
    <span className="preset-picker">
      <select
        aria-label={`${opening.kind === "door" ? "Door" : "Window"} type`}
        value={current?.id ?? CUSTOM}
        data-testid="opening-preset"
        onChange={(e) => {
          const preset = presets.find((p) => p.id === e.currentTarget.value);
          if (!preset) return;
          onPick(opening.kind === "window" ? { width: preset.width, height: preset.height, sillHeight: preset.sillHeight } : { width: preset.width, height: preset.height });
        }}
      >
        {presets.map((p) => (
          <option key={p.id} value={p.id}>
            {p.label}
          </option>
        ))}
        {!current && <option value={CUSTOM}>Custom size</option>}
      </select>
      <ChevronDownIcon width={14} height={14} aria-hidden />
    </span>
  );
}

/** Wall either side of the opening, and a shortcut to centre it. */
function Clearances({ level, opening, onCentre }: { level: Level; opening: Opening; onCentre: () => void }) {
  const geometry = deriveLevelGeometry(level);
  const [lo, hi] = openingHostInterval(geometry, opening) ?? [0, opening.offset + opening.width];
  const before = opening.offset - lo;
  const after = hi - opening.offset - opening.width;
  const centred = Math.abs(before - after) < 0.002;
  return (
    <div className="position-readout">
      <span>{mm(before)} mm</span>
      <button type="button" className="link-btn" disabled={centred} onClick={onCentre} data-testid="opening-centre">
        {centred ? "Centred" : "Centre"}
      </button>
      <span>{mm(after)} mm</span>
    </div>
  );
}

/**
 * Slides the opening within its stretch of wall. Sliding previews like a
 * canvas drag and commits a single history entry on release. The slider
 * runs left → right (or bottom → top) on screen, whichever way the wall
 * was drawn; the readout is the distance from that end.
 */
function PositionControl({ level, opening }: { level: Level; opening: Opening }) {
  const geometry = deriveLevelGeometry(level);
  const axis = geometry.axes.get(opening.wallId);
  const [lo, hi] = openingHostInterval(geometry, opening) ?? [0, opening.offset + opening.width];
  const max = Math.max(lo, hi - opening.width);
  const reversed = !!axis && (axis.orientation === "vertical" ? axis.dir.y < 0 : axis.dir.x < 0);
  const toSlider = (offset: number) => (reversed ? lo + max - offset : offset);
  const startGap = opening.offset - lo;
  const endGap = hi - opening.offset - opening.width;
  const [before, after] = reversed ? [endGap, startGap] : [startGap, endGap];
  const slide = (value: number) =>
    editor.preview({ type: "updateOpening", openingId: opening.id, changes: { offset: roundToPrecision(toSlider(value)) } });
  const commit = () => editor.commitPreview();
  return (
    <div className="position-control">
      <span className="field-label" id={`${opening.id}-position`}>
        Position along wall
      </span>
      <div className="position-row">
        <input
          type="range"
          min={lo}
          max={max}
          step={0.005}
          value={toSlider(Math.min(Math.max(opening.offset, lo), max))}
          disabled={max - lo < 0.001}
          aria-labelledby={`${opening.id}-position`}
          aria-valuetext={`${mm(before)} mm from one side, ${mm(after)} mm from the other`}
          data-testid="opening-position"
          onChange={(e) => slide(Number(e.currentTarget.value))}
          onPointerUp={commit}
          onKeyUp={commit}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === "Escape") {
              // Cancel the slide here rather than letting Escape clear the selection.
              e.stopPropagation();
              editor.cancelPreview();
              e.currentTarget.blur();
            }
          }}
        />
        <output className="position-value" data-testid="opening-position-value">
          {lengthText(Math.max(before, 0), 3)}
        </output>
      </div>
    </div>
  );
}
