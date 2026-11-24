import { analyzeEnvelope } from "@/domain/geometry/envelope";
import { slabPartition } from "@/domain/geometry/outline";
import { difference, pointInRing, rectToPolygon, type Ring } from "@/domain/geometry/polygons";
import { levelStairs, type StairPlan } from "@/domain/geometry/stairs";
import type { Rect } from "@/domain/geometry/vector";
import { floorThicknessOf, floorToFloor, levelIndex } from "@/domain/plan/levels";
import { CURRENT_SCHEMA_VERSION } from "@/domain/plan/schema";
import type { Id, Level, PlanDocument } from "@/domain/plan/types";
import { buildHouseModel, CUTAWAY_HEIGHT, parapets, ROOF_SLAB, type Box, type DimensionLabel, type FloorPiece, type FurniturePlacement, type HouseModel, type HouseModelOptions } from "./houseModel";
import { leanToRoof, pitchedRoof, roofTop, type RoofPiece } from "./roofModel";
import { lengthText } from "@/components/units";

/**
 * The whole house in 3D: every floor's model from `buildHouseModel`, raised
 * to its elevation, with the floor structure between storeys (open where
 * stairs come up), the stairs themselves, a rail round each stairwell, and a
 * flat roof over whatever no floor above covers, such as a single-storey
 * extension. Heights are baked into the data rather than group transforms,
 * so exports keep them. A house of one floor is exactly `buildHouseModel`.
 */

export interface BuildingModelOptions extends HouseModelOptions {
  /** Show floors up to this one and leave off those above; the cutaway cuts this one. Every floor when absent. */
  upTo?: Id | null;
}

const RAIL_HEIGHT = 0.9;
const RAIL = 0.05;
const TINY = 1e-6;

const lone = new WeakMap<Level, PlanDocument>();

/** A floor on its own as a plan of one floor, the same object each time, for callers that still hold a Level. */
export function planOf(source: Level | PlanDocument): PlanDocument {
  if ("levels" in source) return source;
  let doc = lone.get(source);
  if (!doc) lone.set(source, (doc = { schemaVersion: CURRENT_SCHEMA_VERSION, id: source.id, name: source.name, units: "m", levels: [source] }));
  return doc;
}

const cache = new WeakMap<PlanDocument, Map<string, HouseModel>>();

export function buildBuildingModel(doc: PlanDocument, options: BuildingModelOptions): HouseModel {
  const { upTo, ...base } = options;
  if (doc.levels.length === 1) return buildHouseModel(doc.levels[0], base);
  const shown = upTo ? levelIndex(doc, upTo) : -1;
  const top = shown < 0 ? doc.levels.length - 1 : shown;
  const key = JSON.stringify([base, top]);
  const cached = cache.get(doc)?.get(key);
  if (cached) return cached;
  const model = build(doc, base, top);
  if (!cache.has(doc)) cache.set(doc, new Map());
  cache.get(doc)!.set(key, model);
  return model;
}

/** The rectangles left of `rects` once every hole is cut out. */
export function subtractRects(rects: readonly Rect[], holes: readonly Rect[]): Rect[] {
  let out = [...rects];
  for (const h of holes) {
    out = out.flatMap((r) => {
      if (h.minX >= r.maxX - TINY || h.maxX <= r.minX + TINY || h.minY >= r.maxY - TINY || h.maxY <= r.minY + TINY) return [r];
      const pieces: Rect[] = [];
      const y0 = Math.max(r.minY, h.minY);
      const y1 = Math.min(r.maxY, h.maxY);
      if (h.minY > r.minY + TINY) pieces.push({ ...r, maxY: h.minY });
      if (h.maxY < r.maxY - TINY) pieces.push({ ...r, minY: h.maxY });
      if (h.minX > r.minX + TINY) pieces.push({ minX: r.minX, maxX: h.minX, minY: y0, maxY: y1 });
      if (h.maxX < r.maxX - TINY) pieces.push({ minX: h.maxX, maxX: r.maxX, minY: y0, maxY: y1 });
      return pieces;
    });
  }
  return out.filter((r) => r.maxX - r.minX > TINY && r.maxY - r.minY > TINY);
}

const rectBox = (kind: Box["kind"], r: Rect, z0: number, height: number): Box => ({
  kind,
  center: { x: (r.minX + r.maxX) / 2, y: (r.minY + r.maxY) / 2 },
  z0,
  length: r.maxX - r.minX,
  depth: r.maxY - r.minY,
  height,
  angle: 0,
});

/** The parts of a parapet no floor above stands on. */
function exposedParapets(outline: Ring, z0: number, above: Ring | null): Box[] {
  const all = parapets(outline, z0);
  if (!above) return all;
  const out: Box[] = [];
  for (const p of all) {
    const horizontal = Math.abs(p.angle) < 1e-9;
    const c = horizontal ? p.center.x : p.center.y;
    const cuts = [c - p.length / 2, ...above.map((q) => (horizontal ? q.x : q.y)).filter((v) => v > c - p.length / 2 && v < c + p.length / 2), c + p.length / 2].sort((a, b) => a - b);
    for (let k = 0; k + 1 < cuts.length; k++) {
      const [a, b] = [cuts[k], cuts[k + 1]];
      if (b - a < TINY) continue;
      const mid = (a + b) / 2;
      if (pointInRing(above, horizontal ? { x: mid, y: p.center.y } : { x: p.center.x, y: mid })) continue;
      out.push({ ...p, length: b - a, center: horizontal ? { x: mid, y: p.center.y } : { x: p.center.x, y: mid } });
    }
  }
  return out;
}

/** A rail round a stairwell, open where you step off (and, where the stairs go on up, where you step on). */
function rails(plan: StairPlan, through: boolean, z0: number): Box[] {
  const b = plan.bounds;
  const gaps = [plan.arrival, ...(through ? [plan.departure] : [])];
  const edges: Array<{ horizontal: boolean; line: number; lo: number; hi: number }> = [
    { horizontal: true, line: b.minY, lo: b.minX, hi: b.maxX },
    { horizontal: true, line: b.maxY, lo: b.minX, hi: b.maxX },
    { horizontal: false, line: b.minX, lo: b.minY, hi: b.maxY },
    { horizontal: false, line: b.maxX, lo: b.minY, hi: b.maxY },
  ];
  const out: Box[] = [];
  for (const e of edges) {
    let spans: Array<[number, number]> = [[e.lo, e.hi]];
    for (const g of gaps) {
      const [across0, across1] = e.horizontal ? [g.minY, g.maxY] : [g.minX, g.maxX];
      if (across0 > e.line + TINY || across1 < e.line - TINY) continue;
      const [g0, g1] = e.horizontal ? [g.minX, g.maxX] : [g.minY, g.maxY];
      spans = spans.flatMap(([a, c]): Array<[number, number]> => (g1 <= a || g0 >= c ? [[a, c]] : ([[a, g0], [g1, c]] as Array<[number, number]>).filter(([x, y]) => y - x > 0.05)));
    }
    for (const [a, c] of spans) {
      const r = e.horizontal ? { minX: a, maxX: c, minY: e.line - RAIL / 2, maxY: e.line + RAIL / 2 } : { minX: e.line - RAIL / 2, maxX: e.line + RAIL / 2, minY: a, maxY: c };
      out.push(rectBox("balustrade", r, z0, RAIL_HEIGHT));
    }
  }
  return out;
}

function build(doc: PlanDocument, base: HouseModelOptions, top: number): HouseModel {
  const n = doc.levels.length;
  const outlines: Ring[] = doc.levels.map((l) => {
    const env = analyzeEnvelope(l);
    return env.ok ? env.info.outsideRing : [];
  });
  /** Where stairs come up through a floor. */
  const openings = (i: number) => levelStairs(doc, doc.levels[i].id).filter((s) => s.role !== "start").flatMap((s) => s.plan.footprint);
  const boxes: Box[] = [];
  const floors: FloorPiece[] = [];
  const labels: DimensionLabel[] = [];
  const ceilings: Array<{ rect: Rect; z: number }> = [];
  const furniture: FurniturePlacement[] = [];
  let ground: HouseModel | null = null;
  let height = 0;
  const wallTops: number[] = [];

  for (let i = 0; i <= top; i++) {
    const level = doc.levels[i];
    const z = level.elevation;
    const isTop = i === top;
    const cut = base.cutaway && isTop;
    const m = buildHouseModel(level, { ...base, cutaway: cut, roof: false, dimensions: false, landscape: base.landscape && i === 0, roomLabels: base.roomLabels && isTop });
    if (i === 0) ground = m;
    for (const b of m.boxes) boxes.push(z ? { ...b, z0: b.z0 + z } : b);
    for (const f of m.furniture ?? []) furniture.push({ ...f, z: f.z + z });
    const holes = i > 0 ? openings(i) : [];
    for (const f of m.floors) {
      if (i === 0) {
        floors.push(f);
        continue;
      }
      const polygons = holes.length ? f.polygons.flatMap((p) => difference(p, holes.map(rectToPolygon))) : f.polygons;
      floors.push({ ...f, polygons, z, levelId: level.id });
    }
    for (const l of m.labels) labels.push(z ? { ...l, z: l.z + z } : l);
    wallTops.push(z + m.wallHeight);
    height = Math.max(height, z + m.wallHeight);

    // The floor this one stands on, open where the stairs come up.
    if (i > 0) {
      const t = floorThicknessOf(doc, i);
      for (const r of subtractRects(slabPartition(outlines[i]), holes)) boxes.push(rectBox("slab", r, z - t, t));
      for (const s of levelStairs(doc, level.id)) if (s.role !== "start") boxes.push(...rails(s.plan, s.role === "through", z));
    }
    // The ceiling, open where the stairs go on up.
    const above = i + 1 < n ? openings(i + 1) : [];
    for (const r of subtractRects(slabPartition(outlines[i]), above)) ceilings.push({ rect: r, z: z + level.defaultWallHeight });

    // The stairs climbing from this floor: solid steps, each as high as its tread.
    const cap = cut ? CUTAWAY_HEIGHT : Infinity;
    for (const s of levelStairs(doc, level.id)) {
      if (s.role === "end") continue;
      const rise = floorToFloor(doc, i) / s.plan.risers;
      for (const t of s.plan.treads) {
        const h = Math.min(t.step * rise, cap);
        if (h > TINY) boxes.push(rectBox("stair", t.rect, z, h));
      }
    }
  }

  // A roof over every part of a floor that no floor above covers: hipped or
  // gabled over the top floor and a lean-to against the walls above, or flat throughout.
  // A floor shown with the ones above it left off stays open, like a dollhouse.
  const roofs: RoofPiece[] = [];
  const pitched = base.roofForm === "hipped" || base.roofForm === "gabled" ? base.roofForm : null;
  if (base.roof && !base.cutaway && pitched) {
    for (let i = 0; i <= top; i++) {
      if (i === top && top < n - 1) continue;
      if (!outlines[i].length) continue;
      if (i === top) roofs.push(...pitchedRoof(pitched, outlines[i], wallTops[i]));
      else roofs.push(...leanToRoof(outlines[i], outlines[i + 1], wallTops[i], doc.levels[i + 1].elevation));
    }
  } else if (base.roof && !base.cutaway) {
    for (let i = 0; i <= top; i++) {
      if (i === top && top < n - 1) continue;
      const above = i < top ? outlines[i + 1] : null;
      const rects = above ? subtractRects(slabPartition(outlines[i]), slabPartition(above)) : slabPartition(outlines[i]);
      for (const r of rects) boxes.push(rectBox("roof", r, wallTops[i], ROOF_SLAB));
      if (rects.length) boxes.push(...exposedParapets(outlines[i], wallTops[i] + ROOF_SLAB, above));
    }
  }

  const g = ground!;
  if (base.dimensions && g.outside) {
    const env = analyzeEnvelope(doc.levels[0]);
    const o = g.outside;
    const z = (base.cutaway ? doc.levels[top].elevation + CUTAWAY_HEIGHT : height) + 0.4;
    if (env.ok) {
      labels.push(
        { text: lengthText(env.info.width, 3), at: { x: (o.minX + o.maxX) / 2, y: o.maxY + 0.6 }, z },
        { text: lengthText(env.info.depth, 3), at: { x: o.minX - 0.6, y: (o.minY + o.maxY) / 2 }, z },
      );
    }
  }
  const flatTop = base.roof && !base.cutaway && top === n - 1 ? ROOF_SLAB + 0.3 : 0;
  return { boxes, floors, outside: g.outside, outline: g.outline, slabs: [], wallHeight: height, labels, site: g.site, ceilings, furniture, ...(roofs.length ? { roofs } : {}), top: roofs.length ? Math.max(height, roofTop(roofs)) : height + flatTop };
}
