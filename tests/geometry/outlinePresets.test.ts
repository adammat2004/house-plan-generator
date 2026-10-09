import { describe, expect, it } from "vitest";
import { applyCommand, validateDocument } from "@/domain/commands";
import { analyzeEnvelope } from "@/domain/geometry/envelope";
import { defaultShapeParams, presetOutline, presetProblem, SHAPE_DEFAULT_SIZE, SHAPE_PRESETS, type ShapeParams } from "@/domain/geometry/outlinePresets";
import { level, newHouse } from "../helpers";

const build = (outline: ReturnType<typeof presetOutline>) => applyCommand(newHouse(), { type: "createOutline", outline, externalThickness: 0.3, wallHeight: 2.4 });

describe("shape presets", () => {
  it("make valid houses of their family at their typical size", () => {
    for (const shape of SHAPE_PRESETS) {
      const { width, depth } = SHAPE_DEFAULT_SIZE[shape];
      const params = defaultShapeParams(shape, width, depth);
      expect(presetProblem(shape, params, 0.3), shape).toBeNull();
      const result = build(presetOutline(shape, params));
      expect(result.ok, shape).toBe(true);
      if (!result.ok) continue;
      expect(validateDocument(result.document)).toEqual([]);
      const env = analyzeEnvelope(level(result.document));
      expect(env.ok && env.info.family, shape).toBe(shape);
      expect(env.ok && [env.info.width, env.info.depth], shape).toEqual([width, depth]);
    }
  });

  it("stay valid across a range of sizes, or say why not", () => {
    let valid = 0;
    for (const shape of SHAPE_PRESETS) {
      for (const width of [6, 9, 12, 16, 24]) {
        for (const depth of [6, 9, 12, 16]) {
          for (const frontShare of [0.3, 0.5, 0.7]) {
            for (const wingShare of [0.2, 0.35, 0.45]) {
              const params: ShapeParams = { width, depth, front: Math.round(depth * frontShare * 2) / 2, wing: Math.round(width * wingShare * 2) / 2 };
              const problem = presetProblem(shape, params, 0.3);
              const result = build(presetOutline(shape, params));
              // The preset check and the command agree.
              expect(result.ok, `${shape} ${JSON.stringify(params)} ${problem}`).toBe(problem === null);
              if (result.ok) valid++;
            }
          }
        }
      }
    }
    expect(valid).toBeGreaterThan(250);
  });

  it("explains sizes that don't make the shape", () => {
    expect(presetProblem("L", { width: 12, depth: 11, front: 11, wing: 5 }, 0.3)).toBe("Front wing depth must be less than the depth.");
    expect(presetProblem("U", { width: 12, depth: 11, front: 5, wing: 6 }, 0.3)).toBe("Rear wings' width must be less than half the width.");
    expect(presetProblem("Z", { width: 12, depth: 11, front: 5, wing: 7 }, 0.3)).toBe("Rear block set over must be less than half the width.");
    expect(presetProblem("T", { width: 12, depth: 11, front: 5, wing: -1 }, 0.3)).toBe("Rear wing width must be a positive number.");
    expect(presetProblem("L", { width: 12, depth: 11, front: 5.5, wing: 0.9 }, 0.3)).toMatch(/^The house is only 0.3 m wide inside/);
    expect(presetProblem("rectangle", { width: 8, depth: 10, front: 0, wing: 0 }, 0.3)).toBeNull();
  });
});
