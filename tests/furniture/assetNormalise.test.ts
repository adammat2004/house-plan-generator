import { Document } from "@gltf-transform/core";
import { describe, expect, it } from "vitest";
import { applyMatrix, bounds, chooseTurns, collectPoints, footprintYaw, gltfIO, normaliseGlb, rotateY, solvePlacement, type Points, type Target } from "../../scripts/assets/normalise";

/** Points filling a box: [x0, x1, y0, y1, z0, z1]. */
function box([x0, x1, y0, y1, z0, z1]: number[], n = 6): number[] {
  const out: number[] = [];
  for (let i = 0; i <= n; i++)
    for (let j = 0; j <= n; j++)
      for (let k = 0; k <= n; k++) out.push(x0 + ((x1 - x0) * i) / n, y0 + ((y1 - y0) * j) / n, z0 + ((z1 - z0) * k) / n);
  return out;
}

/** A box as 12 triangles, unindexed. */
function boxTriangles([x0, x1, y0, y1, z0, z1]: number[]): number[] {
  const c = (i: number) => [i & 1 ? x1 : x0, i & 2 ? y1 : y0, i & 4 ? z1 : z0];
  const faces = [
    [0, 2, 3, 1],
    [4, 5, 7, 6],
    [0, 1, 5, 4],
    [2, 6, 7, 3],
    [0, 4, 6, 2],
    [1, 3, 7, 5],
  ];
  return faces.flatMap(([a, b, d, e]) => [a, b, d, a, d, e].flatMap(c));
}

/** A sofa squared up the way the app wants it: 2.1 wide, 0.9 deep, back (tall) at -Z. */
const SOFA = Float64Array.from([...box([-1.05, 1.05, 0, 0.45, -0.45, 0.45]), ...box([-1.05, 1.05, 0.45, 0.85, -0.45, -0.25])]);
const SOFA_TARGET: Target = { width: 2.1, depth: 0.9, height: 0.85, fit: "stretch", placement: "wall" };

/** The model as a service might send it: turned, moved, and in its own units. */
function scrambled(points: Points, angle: number, scale: number, offset: [number, number, number]): Points {
  const turned = rotateY(points, angle);
  return turned.map((v, i) => v * scale + offset[i % 3]);
}

/** The 90th-percentile height in the back and front strips. */
function backFront(points: Points) {
  const { min, max, size } = bounds(points);
  const back: number[] = [];
  const front: number[] = [];
  for (let i = 0; i < points.length; i += 3) {
    if (points[i + 2] < min[2] + 0.3 * size[2]) back.push(points[i + 1]);
    if (points[i + 2] > max[2] - 0.3 * size[2]) front.push(points[i + 1]);
  }
  const top = (v: number[]) => v.sort((a, b) => a - b)[Math.floor(v.length * 0.9)];
  return { back: top(back), front: top(front) };
}

describe("squaring a model up", () => {
  it("finds a small skew in the footprint", () => {
    const yaw = footprintYaw(rotateY(SOFA, (20 * Math.PI) / 180));
    expect((yaw * 180) / Math.PI).toBeCloseTo(-20, 0);
    expect(footprintYaw(SOFA)).toBe(0);
  });

  it.each([0, 90, 180, 270, 110, -160])("puts the sofa's back at -Z whichever way it came (%i°)", (deg) => {
    const points = scrambled(SOFA, (deg * Math.PI) / 180, 0.4, [3, -1, 2]);
    const placed = solvePlacement(points, SOFA_TARGET);
    const result = applyMatrix(points, placed.matrix);
    const b = bounds(result);
    expect(b.size[0]).toBeCloseTo(2.1, 2);
    expect(b.size[1]).toBeCloseTo(0.85, 2);
    expect(b.size[2]).toBeCloseTo(0.9, 2);
    expect(b.min[1]).toBeCloseTo(0, 6);
    expect((b.min[0] + b.max[0]) / 2).toBeCloseTo(0, 6);
    expect((b.min[2] + b.max[2]) / 2).toBeCloseTo(0, 6);
    const { back, front } = backFront(result);
    expect(back).toBeGreaterThan(front);
    expect(placed.orientation.confidence).toBeGreaterThan(0.3);
    expect(placed.distortion.every((d) => Math.abs(d - 1) < 0.01)).toBe(true);
  });

  it("says when it has guessed: a table has no back", () => {
    const table = Float64Array.from(box([-0.55, 0.55, 0, 0.42, -0.3, 0.3]));
    const chosen = chooseTurns(table, { width: 1.1, depth: 0.6, height: 0.42, fit: "stretch", placement: "free" });
    expect(chosen.confidence).toBe(0);
    expect(chosen.turns).toBe(0);
  });

  it("keeps a long piece long: width goes across X", () => {
    const sideways = rotateY(Float64Array.from(box([-0.55, 0.55, 0, 0.42, -0.3, 0.3])), Math.PI / 2);
    const placed = solvePlacement(sideways, { width: 1.1, depth: 0.6, height: 0.42, fit: "stretch", placement: "free" });
    const b = bounds(applyMatrix(sideways, placed.matrix));
    expect(b.size[0]).toBeCloseTo(1.1, 2);
    expect(b.size[2]).toBeCloseTo(0.6, 2);
  });

  it("reports how far a model had to be stretched", () => {
    // A sofa made twice as deep as it should be.
    const deep = SOFA.map((v, i) => (i % 3 === 2 ? v * 2 : v));
    const placed = solvePlacement(deep, SOFA_TARGET);
    expect(placed.distortion[1]).toBeLessThan(0.8);
  });

  it("scales evenly to fit when asked, and keeps the proportions", () => {
    const car = Float64Array.from(box([-0.9, 0.9, 0, 1.4, -2.2, 2.2]));
    const placed = solvePlacement(car, { width: 1.85, depth: 4.5, height: 1.5, fit: "fit", placement: "free" });
    expect(placed.dims[0] / placed.dims[1]).toBeCloseTo(1.8 / 4.4, 3);
    expect(placed.dims[1]).toBeLessThanOrEqual(4.5 + 1e-9);
  });

  it("takes a turn from the review over its own guess", () => {
    const placed = solvePlacement(SOFA, SOFA_TARGET, { turns: 2 });
    expect(placed.orientation).toMatchObject({ turns: 2, source: "override" });
    const { back, front } = backFront(applyMatrix(SOFA, placed.matrix));
    expect(back).toBeLessThan(front);
  });
});

describe("normalising a GLB", () => {
  it("bakes node transforms, squares up, and writes a meshopt-compressed GLB", async () => {
    const doc = new Document();
    const buffer = doc.createBuffer();
    const triangles = Float32Array.from([...boxTriangles([-1.05, 1.05, 0, 0.45, -0.45, 0.45]), ...boxTriangles([-1.05, 1.05, 0.45, 0.85, -0.45, -0.25])].map((v) => v * 0.5));
    const position = doc.createAccessor().setType("VEC3").setArray(triangles).setBuffer(buffer);
    const prim = doc.createPrimitive().setAttribute("POSITION", position);
    const mesh = doc.createMesh().addPrimitive(prim);
    // A node turned a quarter, moved and nested, as services' exports often are.
    const node = doc.createNode().setMesh(mesh).setRotation([0, Math.SQRT1_2, 0, Math.SQRT1_2]).setTranslation([2, 1, 0]);
    const parent = doc.createNode().addChild(node).setScale([2, 2, 2]);
    doc.createScene().addChild(parent);
    const glb = await (await gltfIO()).writeBinary(doc);

    const { glb: out, result } = await normaliseGlb(glb, SOFA_TARGET, { tris: 25_000, textureSize: 1024 });
    expect(result.dims[0]).toBeCloseTo(2.1, 2);
    expect(result.dims[1]).toBeCloseTo(0.9, 2);
    expect(result.dims[2]).toBeCloseTo(0.85, 2);
    const back = await (await gltfIO()).readBinary(out);
    expect(back.getRoot().listExtensionsUsed().map((e) => e.extensionName)).toContain("EXT_meshopt_compression");
    const b = bounds(collectPoints(back));
    // Quantised positions come back through the node's dequantising transform, so check proportions.
    expect(b.size[0] / b.size[2]).toBeCloseTo(2.1 / 0.9, 1);
  });
});
