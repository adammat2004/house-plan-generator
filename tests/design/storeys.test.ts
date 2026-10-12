import { describe, expect, it } from "vitest";
import { BRIEF_PRESETS } from "@/domain/brief/rooms";
import { DEFAULT_BRIEF, normaliseBrief, withPicks, type HouseBrief } from "@/domain/brief/schema";
import { validateDocument } from "@/domain/commands";
import { assessHouse, roomConnections } from "@/domain/design/analysis";
import { assessHouseSense } from "@/domain/design/houseSense";
import type { PlanningResult } from "@/domain/design/planner";
import { storeyPrograms } from "@/domain/design/program";
import { arrangementTitle, planLayouts } from "@/domain/design/stripPlanner";
import { isStoreyLayout, STACK_TITLE, stackOf } from "@/domain/design/storeyLayouts";
import { analyzeEnvelope } from "@/domain/geometry/envelope";
import { describeOutline } from "@/domain/geometry/outlineDescription";
import { levelStairs } from "@/domain/geometry/stairs";
import type { PlanDocument } from "@/domain/plan/types";
import { OUTLINES, STOREY_OUTLINES } from "../fixtures/outlines";
import { apply, envelope, level, newHouse, newOutlineHouse } from "../helpers";

const two = (brief: HouseBrief): HouseBrief => ({ ...brief, storeys: 2 });
const preset = (id: string) => two(withPicks(DEFAULT_BRIEF, BRIEF_PRESETS.find((p) => p.id === id)!.picks));
const BRIEFS: Array<[string, HouseBrief]> = [
  ["two-bed", two({ ...DEFAULT_BRIEF, bedrooms: 2, bathrooms: 1 })],
  ["default", two(DEFAULT_BRIEF)],
  ["family-3", preset("family-3")],
  ["family-4", preset("family-4")],
  ["five-bed", two({ ...DEFAULT_BRIEF, bedrooms: 5, bathrooms: 3, requiredSpaces: ["kitchen", "living", "dining", "utility"] })],
];

/** A house drawn to an outline, with the garden to the north. */
function shaped(outline: Array<{ x: number; y: number }>): PlanDocument {
  const doc = newOutlineHouse(outline);
  return apply(doc, { type: "setRearWall", wallId: envelope(doc).sides.north });
}

const generate = (source: PlanDocument, brief: HouseBrief, extra: object = {}, count = 3): PlanningResult =>
  planLayouts({ intent: { action: "generate_layouts", brief, count, ...extra }, source, brief, idPrefix: "t" });

const outlineOf = (doc: PlanDocument, i: number) => {
  const env = analyzeEnvelope(doc.levels[i]);
  return env.ok ? env.info.outsideRing : null;
};

/**
 * Everything a generated two-storey house must satisfy. The floor above
 * repeats the ground floor's outline, or with a setback is a rectangle over
 * part of it (validation keeps it from overhanging).
 */
function checkHouse(doc: PlanDocument, brief: HouseBrief, label: string, setback = false) {
  expect(validateDocument(doc), label).toEqual([]);
  expect(doc.levels, label).toHaveLength(2);
  const [ground, first] = doc.levels;
  if (setback) expect(outlineOf(doc, 1), label).toHaveLength(4);
  else expect(outlineOf(doc, 1), label).toEqual(outlineOf(doc, 0));
  // One straight flight up from the ground floor hall to the landing.
  expect(Object.keys(doc.staircases ?? {}), label).toHaveLength(1);
  expect(levelStairs(doc, ground.id)[0].role, label).toBe("start");
  for (const l of doc.levels) expect(Object.values(l.rooms).filter((r) => r.type === "unspecified"), label).toEqual([]);
  // Living downstairs with a WC, every bedroom upstairs.
  const types = (i: number) => Object.values(doc.levels[i].rooms).map((r) => r.type);
  expect(types(0).filter((t) => t === "bedroom" || t === "primary_bedroom"), label).toEqual([]);
  expect(types(0), label).toContain("wc");
  expect(assessHouse(doc).bedrooms, label).toBe(brief.bedrooms);
  // A front door into the hall; the landing upstairs has no door out.
  const hall = Object.values(ground.rooms).find((r) => r.type === "hall")!;
  expect(roomConnections(ground, hall.id).some((c) => c.kind === "door" && c.target.kind !== "room"), `${label}: front door`).toBe(true);
  const landing = Object.values(first.rooms).find((r) => r.type === "hall")!;
  expect(landing.name, label).toBe("Landing");
  expect(Object.values(first.openings).some((o) => o.kind === "door" && analyzeEnvelope(first).ok && first.envelope.wallIds.includes(o.wallId)), `${label}: no door out upstairs`).toBe(false);
  // Every room is reachable, and the stairs leave from and arrive in a hall.
  const findings = assessHouseSense(doc).findings.filter((f) => f.rule === "reachable" || f.rule === "stairs" || f.rule === "front_door");
  expect(findings, label).toEqual([]);
}

describe("two-storey layouts", () => {
  it("splits the rooms between the floors", () => {
    const { ground, upper, notes } = storeyPrograms(preset("family-4"));
    expect(ground.spaces.map((s) => s.type).sort()).toEqual(["kitchen_dining", "living", "utility", "wc"]);
    expect(upper.spaces.map((s) => s.name)).toContain("Study");
    expect(notes.join(" ")).toMatch(/study is upstairs/);
    expect(storeyPrograms(two(DEFAULT_BRIEF)).notes.join(" ")).toMatch(/WC is added downstairs/);
  });

  it("keeps storeys in the brief only when there are two", () => {
    expect(normaliseBrief({ ...DEFAULT_BRIEF, storeys: 1 })).toEqual(DEFAULT_BRIEF);
    expect(normaliseBrief(two(DEFAULT_BRIEF)).storeys).toBe(2);
  });

  it("lays out houses sized from the rooms, for two to five bedrooms", () => {
    for (const [name, brief] of BRIEFS) {
      const result = generate(newHouse(), brief, { footprint: "auto" });
      expect(result.issues, name).toEqual([]);
      expect(result.candidates.length, name).toBe(3);
      for (const c of result.candidates) {
        checkHouse(c.document, brief, `${name} ${c.variant}`);
        expect(isStoreyLayout(c.arrangement), c.arrangement).toBe(true);
        expect(arrangementTitle(c.arrangement!)).toBe("Two storeys, bedrooms upstairs");
        expect(c.variant).toMatch(/@2s:/);
        // Furnished, every floor.
        for (const l of c.document.levels) expect(Object.keys(l.furniture).length, `${name} ${l.name}`).toBeGreaterThan(0);
      }
      expect(new Set(result.candidates.map((c) => c.variant)).size, name).toBe(3);
    }
  });

  it("stacks a floor on a house drawn for it, keeping its garden side", () => {
    const doc = newHouse(7.5, 9);
    const source = apply(doc, { type: "setRearWall", wallId: envelope(doc).sides.north });
    const result = generate(source, two(DEFAULT_BRIEF));
    expect(result.issues).toEqual([]);
    for (const c of result.candidates) {
      checkHouse(c.document, two(DEFAULT_BRIEF), c.arrangement!);
      const env = analyzeEnvelope(c.document.levels[1]);
      expect(env.ok && env.info.sideOfWall[c.document.levels[1].rearWallId!]).toBe("north");
    }
  });

  it("says why a house can't take two floors", () => {
    const tiny = generate(newHouse(5, 6), two(DEFAULT_BRIEF));
    expect(tiny.candidates).toEqual([]);
    expect(tiny.issues[0].message).toMatch(/^No two-storey layout fits/);
  });

  it("is the same every time, and new each time it's asked for more", () => {
    const brief = preset("family-3");
    const a = generate(newHouse(), brief, { footprint: "auto" });
    const b = generate(newHouse(), brief, { footprint: "auto" });
    expect(a.candidates.map((c) => c.variant)).toEqual(b.candidates.map((c) => c.variant));
    expect(level(a.candidates[0].document)).toEqual(level(b.candidates[0].document));
    const more = generate(newHouse(), brief, { footprint: "auto", exclude: a.candidates.map((c) => c.variant!) });
    for (const c of more.candidates) expect(a.candidates.map((x) => x.variant)).not.toContain(c.variant);
  });

  it("generates in a house drawn for it", () => {
    for (const [name, outline] of Object.entries(STOREY_OUTLINES)) {
      for (const [bn, brief] of [["default", two(DEFAULT_BRIEF)], ["family-3", preset("family-3")]] as const) {
        // A Z house is too big for so few rooms downstairs.
        if (name === "Z" && bn === "default") continue;
        const label = `${name} ${bn}`;
        const result = generate(shaped(outline), brief);
        expect(result.issues, label).toEqual([]);
        // The Z has fewer ways to stack it: one block or the other.
        expect(result.candidates.length, label).toBeGreaterThanOrEqual(name === "Z" ? 2 : 3);
        for (const c of result.candidates) {
          const stack = stackOf(c.arrangement!);
          expect(stack, `${label} ${c.arrangement}`).not.toBeNull();
          checkHouse(c.document, brief, `${label} ${c.arrangement}`, stack === "setback");
          if (stack === "setback") expect(arrangementTitle(c.arrangement!)).toBe(STACK_TITLE);
          // The garden on the same side upstairs.
          const upper = c.document.levels[1];
          const env = analyzeEnvelope(upper);
          expect(env.ok && env.info.sideOfWall[upper.rearWallId!], label).toBe("north");
        }
      }
    }
  });

  it("covers the whole of a house with a bay, or all but the bay", () => {
    const result = generate(shaped(STOREY_OUTLINES.bay), preset("family-3"), {}, 6);
    const kinds = new Set(result.candidates.map((c) => stackOf(c.arrangement!)));
    expect([...kinds].sort()).toEqual(["full", "setback"]);
    const full = result.candidates.find((c) => stackOf(c.arrangement!) === "full")!;
    expect(full.summary).toMatch(/^Living spaces downstairs/);
  });

  it("builds the floor above over a wing too, a bedroom growing into it", () => {
    for (const outline of [STOREY_OUTLINES.L, STOREY_OUTLINES.Lside]) {
      const result = generate(shaped(outline), two(DEFAULT_BRIEF), {}, 6);
      const full = result.candidates.filter((c) => stackOf(c.arrangement!) === "full");
      expect(full.length).toBeGreaterThan(0);
      // Both kinds are on offer.
      expect(result.candidates.some((c) => stackOf(c.arrangement!) === "setback")).toBe(true);
      for (const c of full) {
        checkHouse(c.document, two(DEFAULT_BRIEF), c.arrangement!);
        expect(c.summary).toMatch(/^Bedrooms upstairs over the whole house; downstairs the wing holds the /);
        // Every bedroom upstairs, one of them grown over the wing.
        const upstairs = assessHouse(c.document).rooms.filter((r) => Object.keys(c.document.levels[1].rooms).includes(r.id));
        expect(Math.max(...upstairs.filter((r) => r.type === "primary_bedroom" || r.type === "bedroom" || r.type === "office").map((r) => r.area))).toBeGreaterThan(16);
      }
    }
  });

  it("puts a wing's rooms in it, or opens a living space into it", () => {
    const result = generate(shaped(STOREY_OUTLINES.T), preset("family-3"));
    for (const c of result.candidates) {
      expect(c.summary, c.arrangement).toMatch(/single-storey (wing holds|wings hold) the/);
      // No room grows out of all proportion to take up a wing.
      for (const room of Object.values(c.document.levels[0].rooms)) expect(assessHouse(c.document).rooms.find((r) => r.id === room.id)?.area ?? 0, room.name).toBeLessThan(45);
    }
  });

  it("runs the stairs along the street wall where the house is shallow", () => {
    // 5.5 m deep at the front: too shallow for a band of rooms in front of the stairs.
    for (const [name, outline] of [["L", OUTLINES.L], ["T", OUTLINES.T], ["U", OUTLINES.U]] as const) {
      const brief = preset("family-3");
      const result = generate(shaped(outline), brief);
      expect(result.issues, name).toEqual([]);
      expect(result.candidates.length, name).toBe(3);
      for (const c of result.candidates) {
        expect(c.arrangement, name).toMatch(/\.x0[fr]\./);
        checkHouse(c.document, brief, `${name} ${c.arrangement}`, stackOf(c.arrangement!) === "setback");
      }
    }
    // And in a shallow rectangle.
    const wide = generate(apply(newHouse(12, 6), { type: "setRearWall", wallId: envelope(newHouse(12, 6)).sides.north }), two(DEFAULT_BRIEF));
    expect(wide.issues).toEqual([]);
    for (const c of wide.candidates) checkHouse(c.document, two(DEFAULT_BRIEF), c.arrangement!);
  });

  it("says why a house that isn't a rectangle can't take two floors", () => {
    // Every part of a cross-shaped house is 4 m wide.
    const result = generate(shaped(OUTLINES.plus), two(DEFAULT_BRIEF));
    expect(result.candidates).toEqual([]);
    expect(result.issues[0].message).toBe("No two-storey layout fits: the stairs and the bedrooms over them don't fit the biggest part of the house that reaches the street, 4 × 12 m.");
  });

  it("is the same every time in a house that isn't a rectangle, and new each time it's asked for more", () => {
    const brief = preset("family-3");
    const a = generate(shaped(STOREY_OUTLINES.U), brief);
    const b = generate(shaped(STOREY_OUTLINES.U), brief);
    expect(a.candidates.map((c) => c.arrangement)).toEqual(b.candidates.map((c) => c.arrangement));
    expect(level(a.candidates[0].document)).toEqual(level(b.candidates[0].document));
    const more = generate(shaped(STOREY_OUTLINES.U), brief, { exclude: a.candidates.map((c) => c.arrangement!) });
    expect(more.candidates.length).toBeGreaterThan(0);
    for (const c of more.candidates) expect(a.candidates.map((x) => x.arrangement)).not.toContain(c.arrangement);
  });

  it("sizes L, T and U houses from the rooms, the wings single-storey or built up", () => {
    for (const family of ["L", "T", "U"] as const) {
      const brief = { ...preset("family-4"), houseShape: family };
      const result = generate(newHouse(), brief, { footprint: "auto" });
      expect(result.issues, family).toEqual([]);
      expect(result.candidates.length, family).toBeGreaterThanOrEqual(2);
      for (const c of result.candidates) {
        const label = `${family} ${c.variant}`;
        expect(c.variant, label).toContain(`@2s:${family}:`);
        checkHouse(c.document, brief, label, stackOf(c.arrangement!) === "setback");
        const env = analyzeEnvelope(c.document.levels[0]);
        expect(env.ok && describeOutline(env.info).shape, label).toBe(family);
        expect(c.summary, label).toMatch(new RegExp(`^An? ${family}-shaped [\\d.]+ × [\\d.]+ m two-storey house\\. Bedrooms upstairs over the (main part|whole house)`));
      }
    }
  });

  it("mixes rectangles and other shapes for any shape, within the plot", () => {
    const any = generate(newHouse(), { ...preset("family-4"), houseShape: "any" }, { footprint: "auto" });
    expect(any.issues).toEqual([]);
    expect(new Set(any.candidates.map((c) => c.variant!.split("@2s:")[1].split(":")[0].replace(/^[\d.]+x[\d.]+$/, "rectangle"))).size).toBeGreaterThan(1);
    const narrow = generate(newHouse(), { ...preset("family-4"), houseShape: "L" }, { footprint: "auto", plot: { maxWidth: 8, maxDepth: 18 } });
    expect(narrow.issues).toEqual([]);
    for (const c of narrow.candidates) expect(c.footprint!.width).toBeLessThanOrEqual(8);
  });

  it("generates within a second", () => {
    const start = performance.now();
    generate(newHouse(), preset("family-4"), { footprint: "auto" });
    expect(performance.now() - start).toBeLessThan(1500);
  });
});
