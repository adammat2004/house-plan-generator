import type { Id, Point2 } from "../plan/types";
import { EPS } from "./numeric";
import {
  pointInPolygon,
  pointInRing,
  ringSignedArea,
  simplifyRing,
  type PolygonWithHoles,
  type Ring,
} from "./polygons";
import type { ContactMap } from "./topology";
import { pointKey, rectFromPoints, type Rect } from "./vector";
import { pointAtParam, type WallAxis } from "./walls";

/** An enclosed region bounded by wall axes. */
export interface Face {
  /** Counterclockwise outer ring with holes (clockwise), wall-axis based. */
  polygon: PolygonWithHoles;
  /** Net axis area (outer minus holes), m². */
  axisArea: number;
  bounds: Rect;
  /** Walls whose axes bound this face. */
  boundaryWallIds: Id[];
}

interface Node {
  key: string;
  p: Point2;
  neighbours: string[];
}

interface Edge {
  a: string;
  b: string;
  wallId: Id;
}

const edgeKey = (a: string, b: string) => (a < b ? `${a}|${b}` : `${b}|${a}`);

/**
 * Derives enclosed faces from the planar graph of wall axes. Axes are split
 * at every contact (corners, tees, crossings); dangling filaments and bridges
 * are removed; freestanding components become holes of the face containing
 * them. The result is deterministic for a given set of axes.
 */
export function computeFaces(axes: Map<Id, WallAxis>, contacts: ContactMap): Face[] {
  const points = new Map<string, Point2>();
  const edges = new Map<string, Edge>();

  for (const axis of axes.values()) {
    if (axis.orientation !== "horizontal" && axis.orientation !== "vertical") continue;
    const params = [0, axis.length, ...(contacts.get(axis.wallId) ?? []).map((c) => c.s)].sort((a, b) => a - b);
    const unique: number[] = [];
    for (const s of params) if (unique.length === 0 || s - unique[unique.length - 1] > EPS) unique.push(s);
    let prevKey: string | null = null;
    for (const s of unique) {
      const p = pointAtParam(axis, s);
      const key = pointKey(p);
      if (!points.has(key)) points.set(key, p);
      if (prevKey && prevKey !== key) edges.set(edgeKey(prevKey, key), { a: prevKey, b: key, wallId: axis.wallId });
      prevKey = key;
    }
  }

  const active = new Map(edges);
  let traced: Traced;
  for (;;) {
    pruneFilaments(points, active);
    traced = traceAll(points, active);
    const bridges = findBridges(traced.halfEdgeFace, active);
    if (bridges.length === 0) break;
    for (const key of bridges) active.delete(key);
  }

  const { cycles } = traced;
  const nodeComponent = components(points, active);

  type Bounded = { ring: string[]; area: number; component: number; holes: Ring[] };
  const bounded: Bounded[] = [];
  const outers: Array<{ ring: string[]; component: number }> = [];
  for (const cycle of cycles) {
    const ring = cycle.map((k) => points.get(k)!);
    const area = ringSignedArea(ring);
    const component = nodeComponent.get(cycle[0]) ?? -1;
    if (area > EPS * EPS) bounded.push({ ring: cycle, area, component, holes: [] });
    else if (area < -EPS * EPS) outers.push({ ring: cycle, component });
  }

  // Attach each component's outer boundary as a hole of the smallest containing face.
  for (const outer of outers) {
    const probe = points.get(outer.ring[0])!;
    let best: Bounded | null = null;
    for (const face of bounded) {
      if (face.component === outer.component) continue;
      const ring = face.ring.map((k) => points.get(k)!);
      if (!pointInRing(ring, probe)) continue;
      if (!best || face.area < best.area) best = face;
    }
    if (best) best.holes.push(simplifyRing(outer.ring.map((k) => points.get(k)!)));
  }

  const faces: Face[] = bounded.map((face) => {
    const outer = simplifyRing(face.ring.map((k) => points.get(k)!));
    const wallIds = new Set<Id>();
    for (let i = 0; i < face.ring.length; i++) {
      const e = active.get(edgeKey(face.ring[i], face.ring[(i + 1) % face.ring.length]));
      if (e) wallIds.add(e.wallId);
    }
    const holeArea = face.holes.reduce((sum, h) => sum + Math.abs(ringSignedArea(h)), 0);
    return {
      polygon: { outer, holes: face.holes },
      axisArea: face.area - holeArea,
      bounds: rectFromPoints(outer),
      boundaryWallIds: [...wallIds].sort(),
    };
  });

  faces.sort(
    (a, b) =>
      a.bounds.minY - b.bounds.minY ||
      a.bounds.minX - b.bounds.minX ||
      a.bounds.maxY - b.bounds.maxY ||
      a.bounds.maxX - b.bounds.maxX ||
      a.axisArea - b.axisArea,
  );
  return faces;
}

function buildNodes(points: Map<string, Point2>, edges: Map<string, Edge>): Map<string, Node> {
  const nodes = new Map<string, Node>();
  for (const e of edges.values()) {
    for (const k of [e.a, e.b]) {
      if (!nodes.has(k)) nodes.set(k, { key: k, p: points.get(k)!, neighbours: [] });
    }
    nodes.get(e.a)!.neighbours.push(e.b);
    nodes.get(e.b)!.neighbours.push(e.a);
  }
  for (const node of nodes.values()) {
    node.neighbours.sort((u, v) => angle(node.p, points.get(u)!) - angle(node.p, points.get(v)!));
  }
  return nodes;
}

const angle = (from: Point2, to: Point2) => Math.atan2(to.y - from.y, to.x - from.x);

function pruneFilaments(points: Map<string, Point2>, edges: Map<string, Edge>): void {
  for (;;) {
    const degree = new Map<string, number>();
    for (const e of edges.values()) {
      degree.set(e.a, (degree.get(e.a) ?? 0) + 1);
      degree.set(e.b, (degree.get(e.b) ?? 0) + 1);
    }
    let removed = false;
    for (const [key, e] of edges) {
      if ((degree.get(e.a) ?? 0) <= 1 || (degree.get(e.b) ?? 0) <= 1) {
        edges.delete(key);
        removed = true;
      }
    }
    if (!removed) return;
  }
}

interface Traced {
  cycles: string[][];
  halfEdgeFace: Map<string, number>;
}

/** Traces all faces; bounded faces come out counterclockwise. */
function traceAll(points: Map<string, Point2>, edges: Map<string, Edge>): Traced {
  const nodes = buildNodes(points, edges);
  const halfEdgeFace = new Map<string, number>();
  const cycles: string[][] = [];
  const orderedNodes = [...nodes.keys()].sort();
  for (const start of orderedNodes) {
    for (const firstNext of nodes.get(start)!.neighbours) {
      if (halfEdgeFace.has(`${start}>${firstNext}`)) continue;
      const faceIndex = cycles.length;
      const cycle: string[] = [];
      let u = start;
      let v = firstNext;
      let guard = 0;
      while (!halfEdgeFace.has(`${u}>${v}`) && guard++ < 100000) {
        halfEdgeFace.set(`${u}>${v}`, faceIndex);
        cycle.push(u);
        const around = nodes.get(v)!.neighbours;
        const idx = around.indexOf(u);
        const w = around[(idx - 1 + around.length) % around.length];
        u = v;
        v = w;
      }
      cycles.push(cycle);
    }
  }
  return { cycles, halfEdgeFace };
}

function findBridges(halfEdgeFace: Map<string, number>, edges: Map<string, Edge>): string[] {
  const bridges: string[] = [];
  for (const [key, e] of edges) {
    const f1 = halfEdgeFace.get(`${e.a}>${e.b}`);
    const f2 = halfEdgeFace.get(`${e.b}>${e.a}`);
    if (f1 !== undefined && f1 === f2) bridges.push(key);
  }
  return bridges;
}

function components(points: Map<string, Point2>, edges: Map<string, Edge>): Map<string, number> {
  const adjacency = new Map<string, string[]>();
  for (const e of edges.values()) {
    if (!adjacency.has(e.a)) adjacency.set(e.a, []);
    if (!adjacency.has(e.b)) adjacency.set(e.b, []);
    adjacency.get(e.a)!.push(e.b);
    adjacency.get(e.b)!.push(e.a);
  }
  const component = new Map<string, number>();
  let next = 0;
  for (const start of [...adjacency.keys()].sort()) {
    if (component.has(start)) continue;
    const stack = [start];
    component.set(start, next);
    while (stack.length) {
      const k = stack.pop()!;
      for (const n of adjacency.get(k)!) {
        if (!component.has(n)) {
          component.set(n, next);
          stack.push(n);
        }
      }
    }
    next++;
  }
  return component;
}

export function findFaceIndexContaining(faces: readonly Face[], p: Point2): number {
  for (let i = 0; i < faces.length; i++) {
    const b = faces[i].bounds;
    if (p.x < b.minX || p.x > b.maxX || p.y < b.minY || p.y > b.maxY) continue;
    if (pointInPolygon(faces[i].polygon, p)) return i;
  }
  return -1;
}
