import { describe, expect, it } from "vitest";
import { DEFAULT_BRIEF, normaliseBrief, type HouseBrief } from "@/domain/brief/schema";
import { validateDocument } from "@/domain/commands";
import { interpretationFromReply, type AiReply } from "@/domain/design/aiInterpretation";
import { shapeFootprintsFor } from "@/domain/design/footprint";
import { programFromBrief } from "@/domain/design/program";
import { interpretRequest } from "@/domain/design/request";
import { planLayouts } from "@/domain/design/stripPlanner";
import { analyzeEnvelope } from "@/domain/geometry/envelope";
import { presetProblem } from "@/domain/geometry/outlinePresets";
import type { PlanDocument } from "@/domain/plan/types";
import { level, newHouse } from "../helpers";

const brief = (over: Partial<HouseBrief> = {}): HouseBrief => ({ ...DEFAULT_BRIEF, ...over });

function auto(b: HouseBrief, extra: { count?: number; plot?: { maxWidth?: number; maxDepth?: number }; exclude?: string[]; similarTo?: string } = {}) {
  const { count = 3, ...rest } = extra;
  return planLayouts({ intent: { action: "generate_layouts", brief: b, count, footprint: "auto", ...rest }, source: newHouse(), brief: b, idPrefix: "a" });
}

const familyOf = (doc: PlanDocument) => {
  const env = analyzeEnvelope(level(doc));
  return env.ok ? env.info.family : null;
};

describe("houses shaped from the rooms", () => {
  it("sizes L, T and U outlines that fit the rooms", () => {
    const program = programFromBrief(DEFAULT_BRIEF);
    const opts = { externalThickness: 0.3, hallWidth: 1.2 };
    for (const family of ["L", "T", "U"] as const) {
      const options = shapeFootprintsFor(program, family, opts);
      expect(options.length, family).toBeGreaterThan(0);
      for (const o of options) {
        expect(presetProblem(family, o.params, 0.3)).toBeNull();
        expect(o.key.startsWith(`${family}:`)).toBe(true);
      }
    }
    // Bigger briefs get bigger houses.
    const big = programFromBrief(brief({ bedrooms: 5, bathrooms: 3, requiredSpaces: ["kitchen", "living", "dining", "office", "garage"] }));
    const small = shapeFootprintsFor(program, "L", opts)[0];
    const large = shapeFootprintsFor(big, "L", opts)[0];
    expect(large.width * large.depth).toBeGreaterThan(small.width * small.depth);
  });

  it("lays out only houses of the shape asked for, within the plot", () => {
    for (const family of ["L", "T", "U"] as const) {
      const result = auto(brief({ houseShape: family }), { plot: { maxWidth: 17 } });
      expect(result.candidates.length, `${family} ${result.issues.map((i) => i.message)}`).toBeGreaterThan(0);
      for (const c of result.candidates) {
        expect(validateDocument(c.document)).toEqual([]);
        expect(familyOf(c.document)).toBe(family);
        expect(c.footprint!.width).toBeLessThanOrEqual(17);
        expect(c.variant).toMatch(new RegExp(`^wings-[a-z-]+\\.p\\d+\\.c\\d+@${family}:`));
        expect(c.summary).toMatch(new RegExp(`^An? ${family}-shaped \\d+(\\.5)? × \\d+(\\.5)? m house\\.`));
      }
      expect(new Set(result.candidates.map((c) => c.variant)).size).toBe(result.candidates.length);
    }
  });

  it("mixes rectangles and shaped houses when any shape will do", () => {
    const result = auto(brief({ houseShape: "any" }), { count: 4 });
    const families = result.candidates.map((c) => familyOf(c.document));
    expect(families).toContain("rectangle");
    expect(families.some((f) => f === "L" || f === "U" || f === "T")).toBe(true);
  });

  it("offers more shaped houses that leave out the ones shown, and similar ones first", () => {
    const first = auto(brief({ houseShape: "U" }));
    const shown = first.candidates.map((c) => c.variant!);
    const more = auto(brief({ houseShape: "U" }), { exclude: shown });
    for (const c of more.candidates) expect(shown).not.toContain(c.variant);
    const similar = auto(brief({ houseShape: "U" }), { similarTo: shown[0], count: 1 });
    expect(similar.candidates[0].variant!.split("@")[1]).toBe(shown[0].split("@")[1]);
  });

  it("explains when no house of that shape fits the plot", () => {
    const result = auto(brief({ houseShape: "U" }), { plot: { maxWidth: 9, maxDepth: 9 } });
    expect(result.candidates).toEqual([]);
    expect(result.issues[0].message).toMatch(/U-shaped house within a 9 × 9 m plot/);
  });

  it("keeps the house the user drew, saying the brief's shape applies to houses sized from the rooms", () => {
    const b = brief({ houseShape: "L" });
    const result = planLayouts({ intent: { action: "generate_layouts", brief: b, count: 1 }, source: newHouse(), brief: b, idPrefix: "s" });
    expect(familyOf(result.candidates[0].document)).toBe("rectangle");
    expect(result.candidates[0].notes.join(" ")).toMatch(/asks for an L-shaped house; these layouts keep the house you drew/);
  });
});

describe("asking for a shape", () => {
  it("stores no preference for a plain rectangle", () => {
    expect(normaliseBrief(brief({ houseShape: "rectangle" }))).not.toHaveProperty("houseShape");
    expect(normaliseBrief(brief({ houseShape: "U" })).houseShape).toBe("U");
  });

  it("reads shapes from typed requests", () => {
    const lvl = level(newHouse());
    const step = (text: string) => interpretRequest(text, lvl, DEFAULT_BRIEF, null).steps[0];
    expect(step("Make it L-shaped")).toMatchObject({ kind: "brief", patch: { houseShape: "L" }, describe: "The brief now asks for an L-shaped house" });
    expect(step("I'd love a courtyard house")).toMatchObject({ patch: { houseShape: "U" } });
    expect(step("a t shape please")).toMatchObject({ patch: { houseShape: "T" } });
    expect(step("any shape is fine")).toMatchObject({ patch: { houseShape: "any" }, describe: "The planner may choose the house's shape" });
  });

  it("takes a shape from Claude's reply", () => {
    const reply: AiReply = {
      reply: "A U-shaped house it is.",
      roomChanges: [],
      brief: { bedrooms: null, bathrooms: null, addSpaces: [], removeSpaces: [], addPreferences: [], removePreferences: [], roomSizes: [], houseShape: "U" },
      unclear: [],
    };
    const read = interpretationFromReply(reply, null, DEFAULT_BRIEF, "request");
    expect(read.steps).toEqual([{ kind: "brief", patch: { houseShape: "U" }, describe: "The brief now asks for a U-shaped house", clause: "The brief now asks for a U-shaped house" }]);
  });
});
