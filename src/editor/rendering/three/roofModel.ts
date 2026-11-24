import { offsetRing } from "@/domain/geometry/outline";
import { pointInRing, rectToPolygon, union, type MultiPolygon, type Ring } from "@/domain/geometry/polygons";
import type { Rect } from "@/domain/geometry/vector";

/**
 * Pitched roofs as plain data. A right-angle outline is covered by its
 * largest rectangles (they overlap); each gets a hipped roof at one pitch,
 * and the highest at each point is the roof. That is the outline's straight
 * skeleton, so hips, ridges and the valleys where wings meet all come from
 * drawing the pieces as solids that run into each other. No WebGL here.
 */

export type RoofForm = "hipped" | "gabled" | "flat";

export const ROOF_PITCH = (35 * Math.PI) / 180;
/** How far the eaves stand out past the outside faces. */
export const ROOF_OVERHANG = 0.4;
/** The fascia: the band of roof edge above the wall top before the slope starts. */
export const ROOF_FASCIA = 0.2;
/** A lean-to against an upper floor stays this far under that floor's window sills. */
const SILL_CLEARANCE = 0.75;
const LEAN_TO_PITCH = (20 * Math.PI) / 180;
const TINY = 1e-6;

export type RectSide = "minX" | "maxX" | "minY" | "maxY";
const SIDES: readonly RectSide[] = ["minX", "maxX", "minY", "maxY"];

/** One rectangle of roof: a fascia `skirt` tall from `z0`, then rising `slope` per metre in from each eave side; a side without an eave stands against a wall. */
export interface RoofPiece {
  rect: Rect;
  z0: number;
  skirt: number;
  slope: number;
  eaves: Record<RectSide, boolean>;
  /** Sides without an eave are gable ends: upright triangles of wall, flush with the wall below. */
  gable?: boolean;
}

/** Distance in from one side of the rectangle. */
const inFrom = (r: Rect, s: RectSide, x: number, y: number) => (s === "minX" ? x - r.minX : s === "maxX" ? r.maxX - x : s === "minY" ? y - r.minY : r.maxY - y);

/** Height of a piece's roof surface at a point inside it. */
export function roofHeight(piece: RoofPiece, x: number, y: number): number {
  const eaves = SIDES.filter((s) => piece.eaves[s]);
  const d = eaves.length ? Math.min(...eaves.map((s) => inFrom(piece.rect, s, x, y))) : 0;
  return piece.z0 + piece.skirt + piece.slope * Math.max(0, d);
}

/** The farthest any point of the rectangle lies from its nearest eave. */
function deepest(r: Rect, eaves: Record<RectSide, boolean>): number {
  const along = (lo: boolean, hi: boolean, size: number) => (lo && hi ? size / 2 : lo || hi ? size : Infinity);
  const d = Math.min(along(eaves.minX, eaves.maxX, r.maxX - r.minX), along(eaves.minY, eaves.maxY, r.maxY - r.minY));
  return Number.isFinite(d) ? d : 0;
}

/**
 * Every largest rectangle on the grid of the given lines whose cells are all
 * inside: none can grow by a row or column and stay inside.
 */
export function maximalRects(xs: readonly number[], ys: readonly number[], inside: (x: number, y: number) => boolean): Rect[] {
  const nx = xs.length - 1;
  const ny = ys.length - 1;
  const cell: boolean[][] = [];
  for (let i = 0; i < nx; i++) {
    cell.push([]);
    for (let j = 0; j < ny; j++) cell[i].push(inside((xs[i] + xs[i + 1]) / 2, (ys[j] + ys[j + 1]) / 2));
  }
  // Prefix sums, so "every cell in this block is inside" is constant time.
  const sum: number[][] = Array.from({ length: nx + 1 }, () => new Array<number>(ny + 1).fill(0));
  for (let i = 0; i < nx; i++) for (let j = 0; j < ny; j++) sum[i + 1][j + 1] = sum[i][j + 1] + sum[i + 1][j] - sum[i][j] + (cell[i][j] ? 1 : 0);
  const full = (i0: number, i1: number, j0: number, j1: number) =>
    i0 >= 0 && j0 >= 0 && i1 <= nx && j1 <= ny && sum[i1][j1] - sum[i0][j1] - sum[i1][j0] + sum[i0][j0] === (i1 - i0) * (j1 - j0);
  const out: Rect[] = [];
  for (let i0 = 0; i0 < nx; i0++)
    for (let i1 = i0 + 1; i1 <= nx; i1++)
      for (let j0 = 0; j0 < ny; j0++)
        for (let j1 = j0 + 1; j1 <= ny; j1++) {
          if (!full(i0, i1, j0, j1)) break;
          if (full(i0 - 1, i1, j0, j1) || full(i0, i1 + 1, j0, j1) || full(i0, i1, j0 - 1, j1) || full(i0, i1, j0, j1 + 1)) continue;
          out.push({ minX: xs[i0], maxX: xs[i1], minY: ys[j0], maxY: ys[j1] });
        }
  return out;
}

const lines = (rings: readonly Ring[], key: "x" | "y") => [...new Set(rings.flatMap((r) => r.map((p) => p[key])))].sort((a, b) => a - b);

/** A hipped roof over an outline (its outside faces), with the eaves at `z0`. */
export function hippedRoof(outline: Ring, z0: number): RoofPiece[] {
  const eaves = offsetRing(outline, ROOF_OVERHANG);
  const all = { minX: true, maxX: true, minY: true, maxY: true };
  return maximalRects(lines([eaves], "x"), lines([eaves], "y"), (x, y) => pointInRing(eaves, { x, y })).map((rect) => ({
    rect,
    z0,
    skirt: ROOF_FASCIA,
    slope: Math.tan(ROOF_PITCH),
    eaves: all,
  }));
}

/**
 * A gabled roof over an outline: each largest rectangle of the outline gets
 * a ridge along its length, eaves standing out on its long sides and gable
 * ends flush with the walls on its short ones (along the street when square).
 * Where wings cross, the higher roof shows, which makes the valleys.
 */
export function gabledRoof(outline: Ring, z0: number): RoofPiece[] {
  const rects = maximalRects(lines([outline], "x"), lines([outline], "y"), (x, y) => pointInRing(outline, { x, y }));
  return rects.map((r) => {
    const alongX = r.maxX - r.minX >= r.maxY - r.minY - TINY;
    const eaves = { minX: !alongX, maxX: !alongX, minY: alongX, maxY: alongX };
    const out = (s: RectSide) => (eaves[s] ? ROOF_OVERHANG : 0);
    return {
      rect: { minX: r.minX - out("minX"), maxX: r.maxX + out("maxX"), minY: r.minY - out("minY"), maxY: r.maxY + out("maxY") },
      z0,
      skirt: ROOF_FASCIA,
      slope: Math.tan(ROOF_PITCH),
      eaves,
      gable: true,
    };
  });
}

/** A pitched roof of either form over an outline. */
export const pitchedRoof = (form: "hipped" | "gabled", outline: Ring, z0: number): RoofPiece[] => (form === "gabled" ? gabledRoof(outline, z0) : hippedRoof(outline, z0));

/**
 * A lean-to over the part of a lower floor that the floor above leaves
 * open, rising toward the upper walls and kept under their windows: sides
 * against an upper wall have no eave. `upperFloor` is where the floor above
 * stands, so the roof stays clear of its sills.
 */
export function leanToRoof(lower: Ring, upper: Ring, z0: number, upperFloor: number): RoofPiece[] {
  const open = (x: number, y: number) => pointInRing(lower, { x, y }) && !pointInRing(upper, { x, y });
  const rects = maximalRects(lines([lower, upper], "x"), lines([lower, upper], "y"), open);
  const pieces = rects.map((r) => {
    const mid = { x: (r.minX + r.maxX) / 2, y: (r.minY + r.maxY) / 2 };
    const beyond: Record<RectSide, { x: number; y: number }> = {
      minX: { x: r.minX - 0.01, y: mid.y },
      maxX: { x: r.maxX + 0.01, y: mid.y },
      minY: { x: mid.x, y: r.minY - 0.01 },
      maxY: { x: mid.x, y: r.maxY + 0.01 },
    };
    const eaves = Object.fromEntries(SIDES.map((s) => [s, !pointInRing(upper, beyond[s])])) as Record<RectSide, boolean>;
    // Eaves on the outside faces stand out past them.
    const out = (s: RectSide) => (eaves[s] && !pointInRing(lower, beyond[s]) ? ROOF_OVERHANG : 0);
    const rect = { minX: r.minX - out("minX"), maxX: r.maxX + out("maxX"), minY: r.minY - out("minY"), maxY: r.maxY + out("maxY") };
    return { rect, eaves };
  });
  const depth = Math.max(TINY, ...pieces.map((p) => deepest(p.rect, p.eaves)));
  const room = Math.max(0.15, upperFloor + SILL_CLEARANCE - z0 - ROOF_FASCIA);
  const slope = Math.min(Math.tan(LEAN_TO_PITCH), room / depth);
  return pieces.map((p) => ({ ...p, z0, skirt: ROOF_FASCIA, slope }));
}

/** The highest point of any piece. */
export function roofTop(pieces: readonly RoofPiece[]): number {
  return Math.max(0, ...pieces.map((p) => p.z0 + p.skirt + p.slope * deepest(p.rect, p.eaves)));
}

export interface P3 {
  x: number;
  y: number;
  z: number;
}

type P2 = { x: number; y: number };

/** The part of a convex polygon where g ≥ 0, for g linear. */
function clip(poly: P2[], g: (p: P2) => number): P2[] {
  const out: P2[] = [];
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i];
    const b = poly[(i + 1) % poly.length];
    const ga = g(a);
    const gb = g(b);
    if (ga >= -TINY) out.push(a);
    if ((ga > TINY && gb < -TINY) || (ga < -TINY && gb > TINY)) {
      const t = ga / (ga - gb);
      out.push({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
    }
  }
  return out;
}

const area2 = (poly: readonly P2[]) => poly.reduce((s, p, i) => s + p.x * poly[(i + 1) % poly.length].y - poly[(i + 1) % poly.length].x * p.y, 0);

/** A convex polygon as triangles, fanned from its first corner. */
function fan(poly: readonly P3[], out: P3[][]) {
  for (let i = 1; i + 1 < poly.length; i++) out.push([poly[0], poly[i], poly[i + 1]]);
}

/**
 * A piece as a closed solid of triangles, in plan metres with z up, each
 * wound counterclockwise seen from outside: the sloped faces (one per eave
 * side, where that eave is the nearest), the four upright sides up to the
 * roof line, and the soffit underneath.
 */
export function roofTriangles(piece: RoofPiece): P3[][] {
  const r = piece.rect;
  const tris: P3[][] = [];
  const top = piece.z0 + piece.skirt;
  const corners: P2[] = [
    { x: r.minX, y: r.minY },
    { x: r.maxX, y: r.minY },
    { x: r.maxX, y: r.maxY },
    { x: r.minX, y: r.maxY },
  ];
  const eaves = SIDES.filter((s) => piece.eaves[s]);
  const lift = (p: P2): P3 => ({ x: p.x, y: p.y, z: roofHeight(piece, p.x, p.y) });

  // The slopes.
  if (!eaves.length) fan(corners.map((p) => ({ ...p, z: top })), tris);
  for (const s of eaves) {
    let region = corners;
    for (const t of eaves) if (t !== s) region = clip(region, (p) => inFrom(r, t, p.x, p.y) - inFrom(r, s, p.x, p.y));
    if (region.length < 3 || Math.abs(area2(region)) < TINY) continue;
    if (area2(region) < 0) region = [...region].reverse();
    fan(region.map(lift), tris);
  }

  // The sides: up from z0 to the roof line, which bends where the nearest eave changes.
  for (let k = 0; k < 4; k++) {
    const a = corners[k];
    const b = corners[(k + 1) % 4];
    const at = (t: number): P2 => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
    const ts = new Set([0, 1]);
    for (let i = 0; i < eaves.length; i++)
      for (let j = i + 1; j < eaves.length; j++) {
        const f = (t: number) => inFrom(r, eaves[i], at(t).x, at(t).y) - inFrom(r, eaves[j], at(t).x, at(t).y);
        const f0 = f(0);
        const f1 = f(1);
        if (Math.abs(f1 - f0) > TINY) {
          const t = f0 / (f0 - f1);
          if (t > TINY && t < 1 - TINY) ts.add(t);
        }
      }
    const profile = [...ts].sort((p, q) => q - p).map((t) => lift(at(t)));
    fan([{ ...a, z: piece.z0 }, { ...b, z: piece.z0 }, ...profile], tris);
  }

  // The soffit, facing down.
  fan([...corners].reverse().map((p) => ({ ...p, z: piece.z0 })), tris);
  return tris;
}

/** A plane of roof, z = a·x + b·y + c, and the parts of it to draw. */
export interface RoofSlope {
  a: number;
  b: number;
  c: number;
  polygons: MultiPolygon;
}

/** An upright strip from `a` to `b` (outside on the right going a→b, seen from above), z0 to z1. */
export interface RoofStrip {
  a: P2;
  b: P2;
  z0: number;
  z1: number;
}

export interface RoofSurfaces {
  slopes: RoofSlope[];
  /** The fascias along the eaves. */
  fascias: RoofStrip[];
  /** Undersides, by height. */
  soffits: Array<{ z: number; polygons: MultiPolygon }>;
  /** Where a lean-to stands against a wall: its upright end faces. */
  ends: P3[][];
  /** Gable ends: upright triangles in the wall finish. */
  gables: P3[][];
}

const key = (...xs: number[]) => xs.map((x) => Math.round(x * 1e6)).join(",");

/** Snaps a point to a tenth of a millimetre: outlines offset by the overhang carry float noise (5.199999…) that trips the union. */
const snap = (p: P2): P2 => ({ x: Math.round(p.x * 1e4) / 1e4, y: Math.round(p.y * 1e4) / 1e4 });

/** Whether a point lies inside or on a convex polygon wound either way. */
function inConvex(poly: readonly P2[], p: P2): boolean {
  let sign = 0;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i];
    const b = poly[(i + 1) % poly.length];
    const cross = (b.x - a.x) * (p.y - a.y) - (b.y - a.y) * (p.x - a.x);
    if (Math.abs(cross) < 1e-7) continue;
    if (sign && Math.sign(cross) !== sign) return false;
    sign = Math.sign(cross);
  }
  return true;
}

/**
 * Faces merged into one shape. Every face is convex (a rectangle cut by its
 * neighbours' slopes), so one lying inside another is dropped first: such
 * faces share an edge exactly, which the union can't take. If the union
 * still fails, the faces are drawn as they are, which may shimmer where two
 * overlap but never stops the house from drawing.
 */
function merged(parts: P2[][]): MultiPolygon {
  const bySize = parts.map((outer) => outer.map(snap)).sort((a, b) => Math.abs(area2(b)) - Math.abs(area2(a)));
  const kept: P2[][] = [];
  for (const part of bySize) if (!kept.some((k) => part.every((p) => inConvex(k, p)))) kept.push(part);
  const polygons = kept.map((outer) => ({ outer, holes: [] as P2[][] }));
  try {
    return union(polygons);
  } catch {
    return polygons;
  }
}

/** The plane a piece's slope from one side lies in. */
function planeOf(piece: RoofPiece, s: RectSide): { a: number; b: number; c: number; line: number } {
  const r = piece.rect;
  const h = piece.z0 + piece.skirt;
  const k = piece.slope;
  if (s === "minX") return { a: k, b: 0, c: h - k * r.minX, line: r.minX };
  if (s === "maxX") return { a: -k, b: 0, c: h + k * r.maxX, line: r.maxX };
  if (s === "minY") return { a: 0, b: k, c: h - k * r.minY, line: r.minY };
  return { a: 0, b: -k, c: h + k * r.maxY, line: r.maxY };
}

/**
 * The pieces' faces to draw, with faces that share a plane merged: two
 * wings' slopes over the same eave would otherwise lie on top of each
 * other and flicker. Faces of different planes still run into each other,
 * and the higher shows, which is what makes the valleys.
 */
export function roofSurfaces(pieces: readonly RoofPiece[]): RoofSurfaces {
  const slopes = new Map<string, { a: number; b: number; c: number; parts: P2[][] }>();
  const strips = new Map<string, { side: RectSide; line: number; z0: number; z1: number; spans: Array<[number, number]> }>();
  const soffits = new Map<number, Rect[]>();
  const ends: P3[][] = [];
  const gables: P3[][] = [];
  for (const piece of pieces) {
    const r = piece.rect;
    const corners: P2[] = [
      { x: r.minX, y: r.minY },
      { x: r.maxX, y: r.minY },
      { x: r.maxX, y: r.maxY },
      { x: r.minX, y: r.maxY },
    ];
    const eaves = SIDES.filter((s) => piece.eaves[s]);
    if (!eaves.length) {
      const k = key(0, 0, piece.z0 + piece.skirt);
      if (!slopes.has(k)) slopes.set(k, { a: 0, b: 0, c: piece.z0 + piece.skirt, parts: [] });
      slopes.get(k)!.parts.push(corners);
    }
    for (const s of eaves) {
      let region = corners;
      for (const t of eaves) if (t !== s) region = clip(region, (p) => inFrom(r, t, p.x, p.y) - inFrom(r, s, p.x, p.y));
      if (region.length < 3 || Math.abs(area2(region)) < TINY) continue;
      const plane = planeOf(piece, s);
      const k = key(plane.a, plane.b, plane.c);
      if (!slopes.has(k)) slopes.set(k, { a: plane.a, b: plane.b, c: plane.c, parts: [] });
      slopes.get(k)!.parts.push(area2(region) < 0 ? [...region].reverse() : region);
      // The fascia under this eave.
      const along: [number, number] = s === "minX" || s === "maxX" ? [r.minY, r.maxY] : [r.minX, r.maxX];
      const sk = key(SIDES.indexOf(s), plane.line, piece.z0, piece.skirt);
      if (!strips.has(sk)) strips.set(sk, { side: s, line: plane.line, z0: piece.z0, z1: piece.z0 + piece.skirt, spans: [] });
      strips.get(sk)!.spans.push(along);
    }
    // Sides without an eave stand against a wall: drawn as they are.
    for (let i = 0; i < 4; i++) {
      const side: RectSide = (["minY", "maxX", "maxY", "minX"] as const)[i];
      if (piece.eaves[side]) continue;
      for (const tri of roofTriangles(piece)) {
        const onSide = tri.every((p) => Math.abs(side === "minX" || side === "maxX" ? p.x - r[side] : p.y - r[side]) < TINY);
        if (onSide) (piece.gable ? gables : ends).push(tri);
      }
    }
    if (!soffits.has(piece.z0)) soffits.set(piece.z0, []);
    soffits.get(piece.z0)!.push(r);
  }

  const fascias: RoofStrip[] = [];
  for (const { side, line, z0, z1, spans } of strips.values()) {
    spans.sort((p, q) => p[0] - q[0]);
    const merged: Array<[number, number]> = [];
    for (const [lo, hi] of spans) {
      const last = merged[merged.length - 1];
      if (last && lo <= last[1] + TINY) last[1] = Math.max(last[1], hi);
      else merged.push([lo, hi]);
    }
    for (const [lo, hi] of merged) {
      // Outside on the right going a→b: along +x on the minY side, +y on maxX, −x on maxY, −y on minX.
      const strip =
        side === "minY" ? { a: { x: lo, y: line }, b: { x: hi, y: line } }
        : side === "maxX" ? { a: { x: line, y: lo }, b: { x: line, y: hi } }
        : side === "maxY" ? { a: { x: hi, y: line }, b: { x: lo, y: line } }
        : { a: { x: line, y: hi }, b: { x: line, y: lo } };
      fascias.push({ ...strip, z0, z1 });
    }
  }
  return {
    slopes: [...slopes.values()].map(({ a, b, c, parts }) => ({ a, b, c, polygons: merged(parts) })),
    fascias,
    soffits: [...soffits.entries()].map(([z, rects]) => ({ z, polygons: merged(rects.map((r) => rectToPolygon(r).outer)) })),
    ends,
    gables,
  };
}
