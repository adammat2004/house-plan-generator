import type { Id, Level } from "../plan/types";
import { EPS } from "./numeric";
import type { Rect } from "./vector";
import { wallAxis, type WallAxis } from "./walls";

export type EnvelopeSide = "south" | "east" | "north" | "west";

/** Derived description of the locked rectangular envelope. */
export interface EnvelopeInfo {
  /** Rectangle through the external wall centrelines. */
  axisRect: Rect;
  /** Rectangle through the outside faces of the external walls. */
  outsideRect: Rect;
  /** Outside-face to outside-face dimensions. */
  width: number;
  depth: number;
  sides: Record<EnvelopeSide, Id>;
  sideOfWall: Record<Id, EnvelopeSide>;
  thickness: Record<EnvelopeSide, number>;
}

export type EnvelopeResult = { ok: true; info: EnvelopeInfo } | { ok: false; message: string; wallIds: Id[] };

/**
 * Checks that the envelope walls form a closed, counterclockwise,
 * axis-aligned rectangle and describes it.
 */
export function analyzeEnvelope(level: Level): EnvelopeResult {
  const ids = level.envelope.wallIds;
  if (new Set(ids).size !== 4) return { ok: false, message: "Envelope must reference four distinct walls.", wallIds: [...ids] };
  const axes: WallAxis[] = [];
  for (const id of ids) {
    const wall = level.walls[id];
    if (!wall) return { ok: false, message: `Envelope wall ${id} does not exist.`, wallIds: [id] };
    if (wall.role !== "external") return { ok: false, message: "Envelope walls must be external.", wallIds: [id] };
    const axis = wallAxis(level, wall);
    if (!axis || (axis.orientation !== "horizontal" && axis.orientation !== "vertical")) {
      return { ok: false, message: "Envelope walls must be horizontal or vertical.", wallIds: [id] };
    }
    axes.push(axis);
  }
  for (let i = 0; i < 4; i++) {
    const a = level.walls[ids[i]];
    const b = level.walls[ids[(i + 1) % 4]];
    if (a.endVertexId !== b.startVertexId) {
      return { ok: false, message: "Envelope walls must connect end to start.", wallIds: [a.id, b.id] };
    }
    if (axes[i].orientation === axes[(i + 1) % 4].orientation) {
      return { ok: false, message: "Envelope walls must alternate horizontal and vertical.", wallIds: [a.id, b.id] };
    }
  }
  let area = 0;
  for (const axis of axes) area += axis.start.x * axis.end.y - axis.end.x * axis.start.y;
  if (area <= EPS) return { ok: false, message: "Envelope walls must run counterclockwise.", wallIds: [...ids] };

  const horizontal = axes.filter((a) => a.orientation === "horizontal").sort((a, b) => a.line - b.line);
  const vertical = axes.filter((a) => a.orientation === "vertical").sort((a, b) => a.line - b.line);
  const [south, north] = horizontal;
  const [west, east] = vertical;
  const axisRect: Rect = { minX: west.line, maxX: east.line, minY: south.line, maxY: north.line };
  const thickness = {
    south: south.wall.thickness,
    east: east.wall.thickness,
    north: north.wall.thickness,
    west: west.wall.thickness,
  };
  const outsideRect: Rect = {
    minX: axisRect.minX - thickness.west / 2,
    maxX: axisRect.maxX + thickness.east / 2,
    minY: axisRect.minY - thickness.south / 2,
    maxY: axisRect.maxY + thickness.north / 2,
  };
  const sides = { south: south.wallId, east: east.wallId, north: north.wallId, west: west.wallId };
  return {
    ok: true,
    info: {
      axisRect,
      outsideRect,
      width: outsideRect.maxX - outsideRect.minX,
      depth: outsideRect.maxY - outsideRect.minY,
      sides,
      sideOfWall: {
        [sides.south]: "south",
        [sides.east]: "east",
        [sides.north]: "north",
        [sides.west]: "west",
      },
      thickness,
    },
  };
}
