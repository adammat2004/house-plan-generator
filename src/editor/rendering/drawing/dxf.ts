import type { MultiPolygon, Ring } from "@/domain/geometry/polygons";
import type { PlanDocument, Point2 } from "@/domain/plan/types";
import { buildPlanScene } from "../scene/planScene";

/**
 * The plan as a DXF drawing (AutoCAD R12 ASCII, which every CAD program
 * opens), in metres. Each floor is drawn side by side, named above. Layers
 * follow the usual architectural names: walls (with their door and window
 * openings cut), doors and their swings, windows, room outlines, and room
 * names with areas.
 */

const LAYERS = [
  { name: "A-WALL", colour: 7 },
  { name: "A-DOOR", colour: 3 },
  { name: "A-GLAZ", colour: 5 },
  { name: "A-AREA", colour: 8 },
  { name: "A-ANNO", colour: 2 },
] as const;

type Layer = (typeof LAYERS)[number]["name"];

/** Space between floors drawn side by side, m. */
const FLOOR_GAP = 4;

const n = (v: number) => (Math.round(v * 1e6) / 1e6).toString();

class Writer {
  private out: string[] = [];
  pair(code: number, value: string | number) {
    this.out.push(String(code), typeof value === "number" ? n(value) : value);
  }
  line(layer: Layer, a: Point2, b: Point2) {
    this.pair(0, "LINE");
    this.pair(8, layer);
    this.pair(10, a.x);
    this.pair(20, a.y);
    this.pair(30, 0);
    this.pair(11, b.x);
    this.pair(21, b.y);
    this.pair(31, 0);
  }
  polyline(layer: Layer, points: readonly Point2[], closed: boolean) {
    if (points.length < 2) return;
    this.pair(0, "POLYLINE");
    this.pair(8, layer);
    this.pair(66, 1);
    this.pair(10, 0);
    this.pair(20, 0);
    this.pair(30, 0);
    this.pair(70, closed ? 1 : 0);
    for (const p of points) {
      this.pair(0, "VERTEX");
      this.pair(8, layer);
      this.pair(10, p.x);
      this.pair(20, p.y);
      this.pair(30, 0);
    }
    this.pair(0, "SEQEND");
    this.pair(8, layer);
  }
  text(layer: Layer, at: Point2, height: number, value: string) {
    this.pair(0, "TEXT");
    this.pair(8, layer);
    this.pair(10, at.x);
    this.pair(20, at.y);
    this.pair(30, 0);
    this.pair(40, height);
    // Plain ASCII: R12 has no Unicode, so m² is written m2.
    this.pair(1, value.replace(/²/g, "2").replace(/[^\x20-\x7e]/g, "-"));
    // Centred on the point.
    this.pair(72, 1);
    this.pair(11, at.x);
    this.pair(21, at.y);
    this.pair(31, 0);
    this.pair(73, 2);
  }
  toString() {
    return this.out.join("\n") + "\n";
  }
}

function header(w: Writer, min: Point2, max: Point2) {
  w.pair(0, "SECTION");
  w.pair(2, "HEADER");
  w.pair(9, "$ACADVER");
  w.pair(1, "AC1009");
  w.pair(9, "$INSUNITS");
  w.pair(70, 6);
  w.pair(9, "$EXTMIN");
  w.pair(10, min.x);
  w.pair(20, min.y);
  w.pair(30, 0);
  w.pair(9, "$EXTMAX");
  w.pair(10, max.x);
  w.pair(20, max.y);
  w.pair(30, 0);
  w.pair(0, "ENDSEC");
  w.pair(0, "SECTION");
  w.pair(2, "TABLES");
  w.pair(0, "TABLE");
  w.pair(2, "LAYER");
  w.pair(70, LAYERS.length);
  for (const layer of LAYERS) {
    w.pair(0, "LAYER");
    w.pair(2, layer.name);
    w.pair(70, 0);
    w.pair(62, layer.colour);
    w.pair(6, "CONTINUOUS");
  }
  w.pair(0, "ENDTAB");
  w.pair(0, "ENDSEC");
}

const ringBounds = (rings: readonly Ring[]) => {
  const pts = rings.flat();
  return {
    minX: Math.min(...pts.map((p) => p.x)),
    maxX: Math.max(...pts.map((p) => p.x)),
    minY: Math.min(...pts.map((p) => p.y)),
    maxY: Math.max(...pts.map((p) => p.y)),
  };
};

const ringsOf = (mp: MultiPolygon): Ring[] => mp.flatMap((p) => [p.outer, ...p.holes]);

/** The plan of every floor as one DXF file. */
export function planToDxf(plan: PlanDocument): string {
  const body = new Writer();
  let offsetX = 0;
  let min = { x: Infinity, y: Infinity };
  let max = { x: -Infinity, y: -Infinity };
  for (const level of plan.levels) {
    const scene = buildPlanScene(level);
    const walls = ringsOf(scene.wallMass);
    if (!walls.length) continue;
    const b = ringBounds(walls);
    const dx = offsetX - b.minX;
    const move = (p: Point2): Point2 => ({ x: p.x + dx, y: p.y });
    for (const ring of walls) body.polyline("A-WALL", ring.map(move), true);
    for (const o of scene.openings) {
      if (o.kind === "door") {
        if (o.leaf) body.line("A-DOOR", move(o.leaf[0]), move(o.leaf[1]));
        if (o.arc) body.polyline("A-DOOR", o.arc.map(move), false);
        for (const s of o.sliders ?? []) body.polyline("A-DOOR", s.map(move), true);
      } else {
        if (o.frame) body.polyline("A-GLAZ", o.frame.map(move), true);
        for (const [a, c] of o.glazing ?? []) body.line("A-GLAZ", move(a), move(c));
      }
      for (const [a, c] of o.jambs) body.line(o.kind === "door" ? "A-DOOR" : "A-GLAZ", move(a), move(c));
    }
    for (const room of scene.rooms) {
      for (const polygon of room.clear) body.polyline("A-AREA", polygon.outer.map(move), true);
      const at = move(room.label);
      body.text("A-ANNO", { x: at.x, y: at.y + 0.18 }, 0.25, room.name);
      body.text("A-ANNO", { x: at.x, y: at.y - 0.18 }, 0.18, `${room.clearArea.toFixed(1)} m2`);
    }
    if (plan.levels.length > 1) body.text("A-ANNO", { x: offsetX + (b.maxX - b.minX) / 2, y: b.maxY + 1.2 }, 0.4, level.name);
    min = { x: Math.min(min.x, offsetX), y: Math.min(min.y, b.minY) };
    max = { x: Math.max(max.x, offsetX + b.maxX - b.minX), y: Math.max(max.y, b.maxY) };
    offsetX += b.maxX - b.minX + FLOOR_GAP;
  }
  const w = new Writer();
  header(w, Number.isFinite(min.x) ? min : { x: 0, y: 0 }, Number.isFinite(max.x) ? max : { x: 0, y: 0 });
  return `${w.toString()}0\nSECTION\n2\nENTITIES\n${body.toString()}0\nENDSEC\n0\nEOF\n`;
}
