import { describe, expect, it } from "vitest";
import { FLOOR_MATERIALS } from "@/domain/plan/schema";
import type { Point2 } from "@/domain/plan/types";
import { patternDensity } from "@/editor/rendering/konva/patterns";
import { FINISH_OF_MATERIAL, FINISH_TONE, finishTile, roomFinish, type FinishId, type FinishPart } from "@/editor/rendering/scene/finishes";
import { paintTile, tilePixels, type FinishContext } from "@/editor/rendering/scene/paintFinish";

const FINISHES = Object.keys(FINISH_TONE) as FinishId[];
const PIECED: FinishId[] = ["herringbone", "boards", "vinyl", "stone"];

const inside = (ring: Point2[], p: Point2) => {
  const xs = ring.map((q) => q.x);
  const ys = ring.map((q) => q.y);
  return p.x > Math.min(...xs) && p.x < Math.max(...xs) && p.y > Math.min(...ys) && p.y < Math.max(...ys);
};

const shifted = (ring: Point2[], dx: number, dy: number) => ring.map((p) => ({ x: +(p.x + dx).toFixed(6), y: +(p.y + dy).toFixed(6) }));
const key = (part: FinishPart, dx = 0, dy = 0) => JSON.stringify([shifted(part.ring!, dx, dy), part.fill]);

describe("floor finishes", () => {
  it("draws every floor material, and rooms with a use but no finish the way that use usually is", () => {
    for (const m of FLOOR_MATERIALS) expect(FINISHES).toContain(FINISH_OF_MATERIAL[m]);
    expect(roomFinish({ floorMaterial: "carpet", type: "kitchen" })).toBe("carpet");
    expect(roomFinish({ floorMaterial: null, type: "bathroom" })).toBe("tile");
    expect(roomFinish({ floorMaterial: undefined, type: "living" })).toBe("herringbone");
    expect(roomFinish({ floorMaterial: null, type: "unspecified" })).toBeNull();
  });

  it("is the same every time", () => {
    for (const id of FINISHES) expect(JSON.stringify(finishTile(id))).toBe(JSON.stringify(finishTile(id)));
  });

  it("covers each tile with planks or stones exactly once", () => {
    for (const id of PIECED) {
      const tile = finishTile(id);
      const rings = tile.parts.filter((p) => p.ring).map((p) => p.ring!);
      for (let i = 0; i < 40; i++) {
        for (let j = 0; j < 40; j++) {
          // Off-grid samples, never on a joint.
          const p = { x: ((i + 0.37) / 40) * tile.width, y: ((j + 0.61) / 40) * tile.height };
          expect(rings.filter((r) => inside(r, p)).length, `${id} at ${p.x.toFixed(3)}, ${p.y.toFixed(3)}`).toBe(1);
        }
      }
    }
  });

  it("meets itself at every edge: a piece cut by one edge carries on, the same colour, across the other", () => {
    for (const id of PIECED) {
      const tile = finishTile(id);
      const parts = tile.parts.filter((p) => p.ring);
      const all = new Set(parts.map((p) => key(p)));
      for (const part of parts) {
        const xs = part.ring!.map((p) => p.x);
        const ys = part.ring!.map((p) => p.y);
        if (Math.min(...xs) < -1e-9) expect(all.has(key(part, tile.width, 0)), `${id}: left edge`).toBe(true);
        if (Math.max(...xs) > tile.width + 1e-9) expect(all.has(key(part, -tile.width, 0)), `${id}: right edge`).toBe(true);
        if (Math.min(...ys) < -1e-9) expect(all.has(key(part, 0, tile.height)), `${id}: top edge`).toBe(true);
        if (Math.max(...ys) > tile.height + 1e-9) expect(all.has(key(part, 0, -tile.height)), `${id}: bottom edge`).toBe(true);
      }
    }
  });

  it("paints a tile at whole pixels, so it repeats without a seam at any density", () => {
    // Herringbone: 1.44 m at 32 px/m is 46.08 px, so it's drawn at exactly 46.
    const calls: string[] = [];
    const ctx = new Proxy(
      {},
      {
        get: (_target, prop: string) => {
          if (prop === "createRadialGradient") return () => ({ addColorStop: () => undefined });
          return (...args: unknown[]) => calls.push(`${prop}(${args.map((a) => (typeof a === "number" ? +a.toFixed(4) : a)).join(",")})`);
        },
        set: () => true,
      },
    ) as unknown as FinishContext;
    const tile = finishTile("herringbone");
    paintTile(ctx, tile, 32);
    const px = tilePixels(tile, 32);
    expect(px).toEqual({ width: 46, height: 46 });
    expect(calls).toContain(`scale(${+(46 / 1.44).toFixed(4)},${+(46 / 1.44).toFixed(4)})`);
    expect(calls.filter((c) => c === "fill()").length).toBeGreaterThan(20);
    for (const id of FINISHES) expect(() => paintTile(ctx, finishTile(id), 64)).not.toThrow();
  });

  it("follows the zoom in powers of two, within limits", () => {
    expect(patternDensity(60)).toBe(64);
    expect(patternDensity(60, 2)).toBe(128);
    expect(patternDensity(5)).toBe(32);
    expect(patternDensity(4000)).toBe(512);
  });
});
