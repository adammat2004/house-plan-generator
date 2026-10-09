import { analyzeEnvelope } from "../geometry/envelope";
import { OPPOSITE_SIDE } from "../geometry/outline";
import type { Level, RoomType } from "../plan/types";
import { roomBounds, roomConnections, roomRegion, type Side } from "./analysis";

/**
 * A plain-text description of a plan: the house, its doors to outside and,
 * room by room, its size, what its doors lead to and which way its windows
 * face. Golden snapshots and `npm run plans:render` use it, so a planner
 * change reads as a diff of rooms and doors rather than a changed hash.
 */

const ORDER: readonly RoomType[] = [
  "hall",
  "living",
  "kitchen_dining",
  "kitchen",
  "dining",
  "office",
  "utility",
  "garage",
  "primary_bedroom",
  "bedroom",
  "ensuite",
  "bathroom",
  "wc",
  "storage",
  "other",
  "unspecified",
];
const LETTER: Record<Side, string> = { north: "N", south: "S", east: "E", west: "W" };
const m = (x: number) => x.toFixed(1);

export function describePlan(level: Level): string[] {
  const env = analyzeEnvelope(level);
  const rearSide = env.ok && level.rearWallId ? env.info.sideOfWall[level.rearWallId] : undefined;
  const rooms = Object.values(level.rooms)
    .map((room) => ({ room, area: roomRegion(level, room.id)?.clearArea ?? 0 }))
    .sort((a, b) => ORDER.indexOf(a.room.type) - ORDER.indexOf(b.room.type) || a.room.name.localeCompare(b.room.name));
  const total = rooms.reduce((sum, r) => sum + r.area, 0);
  const hall = rooms.filter((r) => r.room.type === "hall").reduce((sum, r) => sum + r.area, 0);

  const lines: string[] = [];
  const shape = env.ok ? `${m(env.info.width)} × ${m(env.info.depth)} m ${env.info.family}` : "invalid outline";
  lines.push(`house: ${shape}, ${m(total)} m² of rooms, hall ${m(hall)} m² (${total > 0 ? Math.round((hall / total) * 100) : 0}%)`);
  const out: string[] = [];
  for (const { room } of rooms) {
    for (const c of roomConnections(level, room.id)) {
      if (c.kind === "door" && c.target.kind !== "room") out.push(`${LETTER[c.side]}→${room.name}${c.target.kind === "garden" ? " (garden)" : ""}`);
    }
  }
  const street = rearSide ? `, street ${LETTER[OPPOSITE_SIDE[rearSide]]}` : "";
  lines.push(`doors out: ${out.length ? out.sort().join(", ") : "none"}${street}`);
  for (const { room, area } of rooms) {
    const bounds = roomBounds(level, room.id);
    const w = bounds ? bounds.maxX - bounds.minX : 0;
    const d = bounds ? bounds.maxY - bounds.minY : 0;
    // A room that fills noticeably less than its bounding box isn't a rectangle (an L around an ensuite).
    const notRect = bounds && area < w * d * 0.97 ? " (not rectangular)" : "";
    const connections = roomConnections(level, room.id);
    const doors = connections
      .filter((c) => c.kind === "door")
      .map((c) => (c.target.kind === "room" ? c.target.name : c.target.kind))
      .sort();
    const windows = connections
      .filter((c) => c.kind === "window")
      .map((c) => LETTER[c.side] + (c.target.kind === "garden" ? "(garden)" : ""))
      .sort();
    lines.push(
      `  ${room.name.padEnd(26)} ${room.type.padEnd(16)} ${m(area).padStart(5)} m²  ${m(w)}×${m(d)}${notRect}  doors: ${doors.join(", ") || "none"}  windows: ${windows.join(" ") || "none"}`,
    );
  }
  return lines;
}

/** Lines that differ between two descriptions: "+" for new, "-" for gone. */
export function describeChanges(before: Level, after: Level): string[] {
  const a = describePlan(before);
  const b = describePlan(after);
  const was = new Set(a);
  const now = new Set(b);
  return [...a.filter((l) => !now.has(l)).map((l) => `- ${l.trim()}`), ...b.filter((l) => !was.has(l)).map((l) => `+ ${l.trim()}`)];
}
