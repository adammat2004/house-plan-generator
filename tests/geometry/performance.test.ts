import { describe, expect, it } from "vitest";
import { applyCommand } from "@/domain/commands";
import { deriveLevelGeometry, deriveRoomRegions, deriveWallMass } from "@/domain/geometry/derive";
import { buildLargePlan } from "../fixtures/largePlan";
import { level } from "../helpers";

describe("100-wall plan", () => {
  const doc = buildLargePlan();
  const lvl = level(doc);

  it("builds a representative plan of at least 100 walls", () => {
    expect(Object.keys(lvl.walls).length).toBeGreaterThanOrEqual(100);
    expect(deriveLevelGeometry(lvl).faces.length).toBeGreaterThan(40);
  });

  it("validates a drag step quickly and derives rendering geometry once per document", () => {
    deriveRoomRegions(lvl);
    deriveWallMass(lvl);
    const wallId = Object.values(lvl.walls).find((w) => w.role === "internal")!.id;
    const t0 = performance.now();
    const steps = 20;
    for (let i = 1; i <= steps; i++) {
      const result = applyCommand(doc, { type: "moveWall", wallId, delta: (i % 2 ? 1 : -1) * 0.05, idPrefix: `p${i}` });
      expect(result.ok).toBe(true);
    }
    const perStep = (performance.now() - t0) / steps;
    // A drag preview must leave headroom inside a 60 fps frame budget on CI hardware.
    console.info(`100-wall drag step: ${perStep.toFixed(2)} ms`);
    expect(perStep).toBeLessThan(40);

    const t1 = performance.now();
    deriveRoomRegions(lvl);
    deriveWallMass(lvl);
    expect(performance.now() - t1).toBeLessThan(1);
  });
});
