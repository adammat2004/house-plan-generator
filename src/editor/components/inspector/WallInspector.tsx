"use client";

import { deriveLevelGeometry } from "@/domain/geometry/derive";
import { analyzeEnvelope } from "@/domain/geometry/envelope";
import { SIDE_NORMAL } from "@/domain/geometry/outline";
import type { Level } from "@/domain/plan/types";
import { Button, NumberField, ReadoutRow } from "@/components/ui/controls";
import { ChevronRightIcon, DoorIcon, TrashIcon, WindowIcon } from "@/components/ui/icons";
import { addOpeningHere } from "../shell/planActions";
import { InspectorFrame, MM_FIELD, MoreSettings, mm, run, Section } from "./frame";
import { friendlyName } from "./names";
import { lengthText } from "@/components/units";

/** Walls are reshaped by dragging them and their end handles; this card adds doors and windows to them and sets exact sizes. */
export function WallInspector({ level, wallId }: { level: Level; wallId: string }) {
  const wall = level.walls[wallId];
  const axis = deriveLevelGeometry(level).axes.get(wallId);
  const env = analyzeEnvelope(level);
  if (!axis) return null;
  const external = wall.role === "external";
  const horizontal = axis.orientation === "horizontal";
  const isRear = level.rearWallId === wallId;
  const hosted = Object.values(level.openings).filter((o) => o.wallId === wallId).length;

  const commitLength = (length: number): true | string => {
    if (external && env.ok && !env.info.isRectangle) {
      // Moves the wall at this one's end, out or in, so this wall's start stays put.
      const ids = level.envelope.wallIds;
      const next = env.info.edges[(ids.indexOf(wallId) + 1) % ids.length];
      const n = SIDE_NORMAL[next.facing];
      const sign = n.x * axis.dir.x + n.y * axis.dir.y;
      return run({ type: "moveOutlineEdge", wallId: next.wallId, outward: (length - axis.length) * sign });
    }
    if (external && env.ok) {
      const t = env.info.thickness;
      return horizontal
        ? run({ type: "resizeFootprint", width: length + (t.west + t.east) / 2 })
        : run({ type: "resizeFootprint", depth: length + (t.south + t.north) / 2 });
    }
    const sign = horizontal ? Math.sign(axis.dir.x) : Math.sign(axis.dir.y);
    const start = horizontal ? axis.start.x : axis.start.y;
    return run({ type: "moveWallEndpoint", wallId, end: "end", position: start + sign * length });
  };

  return (
    <InspectorFrame
      title={friendlyName(level, wallId)}
      summary={`${lengthText(axis.length, 3)} · ${mm(wall.thickness)} mm thick`}
    >
      <Section title="Quick actions">
        <div className="quick-actions">
          <button type="button" className="quick-action" onClick={() => addOpeningHere(wallId, "door")} data-testid="wall-add-door">
            <DoorIcon width={18} height={18} />
            <span>Add a door here</span>
            <ChevronRightIcon width={16} height={16} />
          </button>
          <button type="button" className="quick-action" onClick={() => addOpeningHere(wallId, "window")} data-testid="wall-add-window">
            <WindowIcon width={18} height={18} />
            <span>Add a window here</span>
            <ChevronRightIcon width={16} height={16} />
          </button>
        </div>
      </Section>
      <Section title="Size">
        <NumberField
          label="Length"
          value={axis.length}
          testId="wall-length"
          hint={external ? (env.ok && !env.info.isRectangle ? "Moves the wall at this one's end." : "Changes the house's outside size.") : undefined}
          onCommit={commitLength}
        />
        <div className="field-row">
          <NumberField label="Thickness" value={wall.thickness} {...MM_FIELD} disabled={external} testId="wall-thickness" onCommit={(thickness) => run({ type: "updateWall", wallId, thickness })} />
          <NumberField label="Height" value={wall.height} {...MM_FIELD} testId="wall-height" onCommit={(height) => run({ type: "updateWall", wallId, height })} />
        </div>
      </Section>
      {external && (
        <Section title="Garden side">
          {isRear ? (
            <div className="rear-row">
              <span className="badge badge-rear">Garden side</span>
              <Button variant="ghost" onClick={() => run({ type: "setRearWall", wallId: null })}>
                Clear
              </Button>
            </div>
          ) : (
            <Button data-testid="mark-rear" onClick={() => run({ type: "setRearWall", wallId })}>
              Mark as the garden side
            </Button>
          )}
          <p className="field-hint">The rear wall faces the garden. One external wall can be the rear.</p>
        </Section>
      )}
      <MoreSettings>
        {!external && (
          <NumberField
            label={horizontal ? "Centreline y" : "Centreline x"}
            value={axis.line}
            testId="wall-position"
            hint="From the outside south-west corner. Connected walls stretch to follow."
            onCommit={(v) => run({ type: "moveWall", wallId, delta: v - axis.line })}
          />
        )}
        <ReadoutRow label="Length is measured" value="on the centreline" />
        <ReadoutRow label="Doors and windows" value={String(hosted)} />
      </MoreSettings>
      {!external && (
        <div className="card-footer">
          <Button variant="danger" className="btn-block" onClick={() => run({ type: "deleteWall", wallId })} data-testid="delete-wall">
            <TrashIcon width={16} height={16} /> Delete wall{hosted ? ` and ${hosted} opening${hosted > 1 ? "s" : ""}` : ""}
          </Button>
        </div>
      )}
    </InspectorFrame>
  );
}
