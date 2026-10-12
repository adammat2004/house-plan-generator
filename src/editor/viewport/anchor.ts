import { roomBounds } from "@/domain/design/analysis";
import { furnitureRect } from "@/domain/furniture/geometry";
import { deriveLevelGeometry } from "@/domain/geometry/derive";
import { staircasePlan } from "@/domain/geometry/stairs";
import type { Rect } from "@/domain/geometry/vector";
import { pointAtParam } from "@/domain/geometry/walls";
import type { Level, PlanDocument } from "@/domain/plan/types";
import type { Selection } from "../state/stores";
import { worldToScreen, type Viewport } from "./viewport";

/** What a selection covers on the plan, in world metres: a room, a wall's length, a door, a piece, the stairs. */
export function selectionBounds(level: Level, plan: PlanDocument, selection: Selection): Rect | null {
  if (!selection) return null;
  switch (selection.kind) {
    case "room":
      return level.rooms[selection.id] ? roomBounds(level, selection.id) : null;
    case "furniture": {
      const item = level.furniture[selection.id];
      return item ? furnitureRect(item) : null;
    }
    case "wall": {
      const axis = deriveLevelGeometry(level).axes.get(selection.id);
      if (!axis) return null;
      const h = axis.wall.thickness / 2;
      return { minX: Math.min(axis.start.x, axis.end.x) - h, minY: Math.min(axis.start.y, axis.end.y) - h, maxX: Math.max(axis.start.x, axis.end.x) + h, maxY: Math.max(axis.start.y, axis.end.y) + h };
    }
    case "opening": {
      const opening = level.openings[selection.id];
      const axis = opening && deriveLevelGeometry(level).axes.get(opening.wallId);
      if (!opening || !axis) return null;
      const a = pointAtParam(axis, opening.offset);
      const b = pointAtParam(axis, opening.offset + opening.width);
      const h = axis.wall.thickness / 2;
      return { minX: Math.min(a.x, b.x) - h, minY: Math.min(a.y, b.y) - h, maxX: Math.max(a.x, b.x) + h, maxY: Math.max(a.y, b.y) + h };
    }
    case "stairs": {
      const s = plan.staircases?.[selection.id];
      return s ? staircasePlan(plan, s).bounds : null;
    }
    case "house":
      return null;
  }
}

/** Height of a floating selection toolbar, px, and its gap from what it's about. */
const BAR_HEIGHT = 44;
const GAP = 14;

/**
 * Where a toolbar about the selection goes on screen: centred above it, or
 * below it when there's no room above, and always inside the canvas.
 */
export function selectionAnchor(bounds: Rect, viewport: Viewport, barWidth: number): { left: number; top: number; below: boolean } {
  const topLeft = worldToScreen(viewport, { x: bounds.minX, y: bounds.maxY });
  const bottomRight = worldToScreen(viewport, { x: bounds.maxX, y: bounds.minY });
  const centre = (topLeft.x + bottomRight.x) / 2;
  const margin = 8;
  const below = topLeft.y - GAP - BAR_HEIGHT < margin;
  const top = below ? Math.min(bottomRight.y + GAP, viewport.height - BAR_HEIGHT - margin) : topLeft.y - GAP - BAR_HEIGHT;
  const left = Math.min(Math.max(centre - barWidth / 2, margin), Math.max(margin, viewport.width - barWidth - margin));
  return { left, top, below };
}
