import { deriveLevelGeometry, deriveRoomRegions, deriveWallMass, openingPlacement, roomFaceIndices } from "@/domain/geometry/derive";
import type { Ring } from "@/domain/geometry/polygons";
import type { Level, RoomType } from "@/domain/plan/types";

/** A plain SVG of a level for reviewing planner output: rooms tinted by type, walls, doors (red) and windows (blue). */

const FILL: Record<RoomType, string> = {
  living: "#f6d6a8",
  kitchen: "#f3b38a",
  kitchen_dining: "#f3b38a",
  dining: "#f1c9a0",
  office: "#d6c6ef",
  utility: "#d8d8d8",
  garage: "#bbbbbb",
  storage: "#cccccc",
  hall: "#eeeeee",
  primary_bedroom: "#9cc0ea",
  bedroom: "#b9d3f0",
  bathroom: "#a8e0d6",
  ensuite: "#a8e0d6",
  wc: "#a8e0d6",
  other: "#ffffff",
  unspecified: "#ff9a9a",
};

const SCALE = 40;

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

export function planSvg(level: Level): string {
  const mass = deriveWallMass(level);
  const xs = mass.flatMap((p) => p.outer.map((q) => q.x));
  const ys = mass.flatMap((p) => p.outer.map((q) => q.y));
  const [minX, maxX, minY, maxY] = [Math.min(...xs) - 0.5, Math.max(...xs) + 0.5, Math.min(...ys) - 0.5, Math.max(...ys) + 0.5];
  const width = (maxX - minX) * SCALE;
  const height = (maxY - minY) * SCALE;
  const tx = (x: number) => ((x - minX) * SCALE).toFixed(1);
  const ty = (y: number) => ((maxY - y) * SCALE).toFixed(1);
  const points = (ring: Ring) => ring.map((p) => `${tx(p.x)},${ty(p.y)}`).join(" ");

  const parts: string[] = [`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">`];
  const regions = deriveRoomRegions(level);
  const faceOf = roomFaceIndices(level);
  const rooms = Object.values(level.rooms).map((room) => ({ room, region: regions[faceOf.get(room.id) ?? -1] }));
  for (const { room, region } of rooms) {
    for (const p of region?.clear ?? []) parts.push(`<polygon points="${points(p.outer)}" fill="${FILL[room.type]}"/>`);
  }
  for (const p of mass) parts.push(`<path d="${[p.outer, ...p.holes].map((r) => `M${points(r)}Z`).join(" ")}" fill="#222" fill-rule="evenodd"/>`);
  const geometry = deriveLevelGeometry(level);
  for (const opening of Object.values(level.openings)) {
    const at = openingPlacement(geometry, opening);
    if (!at) continue;
    const door = opening.kind === "door";
    parts.push(`<line x1="${tx(at.start.x)}" y1="${ty(at.start.y)}" x2="${tx(at.end.x)}" y2="${ty(at.end.y)}" stroke="${door ? "#d11" : "#16c"}" stroke-width="${door ? 7 : 5}"/>`);
  }
  for (const { room, region } of rooms) {
    if (!region) continue;
    const { x, y } = region.labelPoint;
    parts.push(`<text x="${tx(x)}" y="${ty(y)}" font-size="10" font-family="sans-serif" text-anchor="middle">${esc(room.name)}</text>`);
    parts.push(`<text x="${tx(x)}" y="${Number(ty(y)) + 12}" font-size="9" font-family="sans-serif" text-anchor="middle" fill="#555">${region.clearArea.toFixed(1)} m²</text>`);
  }
  parts.push("</svg>");
  return parts.join("\n");
}
