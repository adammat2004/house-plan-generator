"use client";

import { describeEntity, type FurnitureChanges } from "@/domain/commands";
import { roomAtPoint } from "@/domain/design/analysis";
import { FURNITURE_CATALOG } from "@/domain/furniture/catalog";
import { backDirection } from "@/domain/furniture/geometry";
import { FURNITURE_PROBLEM_TEXT, furnitureIssues } from "@/domain/furniture/issues";
import type { Furniture, Level } from "@/domain/plan/types";
import { Button, MenuItem, NumberField } from "@/components/ui/controls";
import { CopyIcon, RefreshIcon, TrashIcon } from "@/components/ui/icons";
import { editor } from "../../state/editor";
import { FurnitureArt } from "../furniture/FurnitureArt";
import { InspectorFrame, MM_FIELD, mm, run, Section } from "./frame";

const FACING = ["south", "east", "north", "west"] as const;

/** Which way the front of a piece faces: the opposite of its back. */
function facing(item: Furniture): string {
  const back = backDirection(item.rotation);
  if (back.y > 0) return FACING[0];
  if (back.x < 0) return FACING[1];
  if (back.y < 0) return FACING[2];
  return FACING[3];
}

/**
 * Furniture is moved by dragging it, and settles against walls on its own;
 * this card gives its exact size, turns it, and says if it's in the way.
 */
export function FurnitureInspector({ level, item }: { level: Level; item: Furniture }) {
  const id = item.id;
  const spec = FURNITURE_CATALOG[item.kind];
  const update = (changes: FurnitureChanges) => run({ type: "updateFurniture", furnitureId: id, changes });
  const roomId = roomAtPoint(level, item.position);
  const problem = furnitureIssues(level).get(id);
  return (
    <InspectorFrame
      title={describeEntity(level, id)}
      summary={roomId ? `In ${level.rooms[roomId].name}` : "Outside the rooms"}
      menu={
        <>
          <MenuItem onSelect={() => editor.duplicateFurniture(id)} data-testid="duplicate-furniture">
            <span className="menu-item-main">
              <CopyIcon width={16} height={16} /> Duplicate
            </span>
            <small>⌘D</small>
          </MenuItem>
          <MenuItem onSelect={() => update({ width: spec.width, depth: spec.depth, height: spec.height })}>Reset to standard size</MenuItem>
        </>
      }
    >
      <div className="product-row">
        <span className="product-thumb">
          <FurnitureArt kind={item.kind} width={item.width} depth={item.depth} size={72} />
        </span>
        <div className="product-info">
          <strong data-testid="furniture-size">
            {mm(item.width)} × {mm(item.depth)} mm
          </strong>
          <span className="field-hint">Facing {facing(item)}</span>
        </div>
      </div>
      {problem && (
        <p className="furniture-problem" role="status" data-testid="furniture-problem">
          {FURNITURE_PROBLEM_TEXT[problem]} Drag it clear, or use Furnish room to lay the room out again.
        </p>
      )}
      <Section>
        <div className="field-row">
          <NumberField label="Width" value={item.width} {...MM_FIELD} testId="furniture-width" onCommit={(width) => update({ width })} />
          <NumberField label="Depth" value={item.depth} {...MM_FIELD} testId="furniture-depth" onCommit={(depth) => update({ depth })} />
        </div>
        <NumberField label="Height" value={item.height} {...MM_FIELD} testId="furniture-height" onCommit={(height) => update({ height })} />
      </Section>
      <Section title="Turn">
        <div className="button-row">
          <Button onClick={() => editor.rotateFurniture(id, 1)} data-testid="furniture-rotate-left">
            <RefreshIcon width={16} height={16} style={{ transform: "scaleX(-1)" }} /> Left
          </Button>
          <Button onClick={() => editor.rotateFurniture(id, -1)} data-testid="furniture-rotate-right">
            <RefreshIcon width={16} height={16} /> Right
          </Button>
        </div>
        <p className="field-hint">Shift+R turns it; arrow keys nudge it 50 mm (Shift for 500 mm).</p>
      </Section>
      <div className="card-footer">
        <Button variant="danger" className="btn-block" onClick={() => run({ type: "deleteFurniture", furnitureId: id })} data-testid="delete-furniture">
          <TrashIcon width={18} height={18} /> Delete
        </Button>
      </div>
    </InspectorFrame>
  );
}
