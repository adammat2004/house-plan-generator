import { describe, expect, it } from "vitest";
import { BRIEF_PRESETS } from "@/domain/brief/rooms";
import { DEFAULT_BRIEF, normaliseBrief, withPicks, type HouseBrief } from "@/domain/brief/schema";
import { validateDocument } from "@/domain/commands";
import { assessHouse, roomConnections } from "@/domain/design/analysis";
import { assessHouseSense } from "@/domain/design/houseSense";
import type { PlanningResult } from "@/domain/design/planner";
import { storeyPrograms } from "@/domain/design/program";
import { arrangementTitle, planLayouts } from "@/domain/design/stripPlanner";
import { isStoreyLayout } from "@/domain/design/storeyLayouts";
import { analyzeEnvelope } from "@/domain/geometry/envelope";
import { levelStairs } from "@/domain/geometry/stairs";
import type { PlanDocument } from "@/domain/plan/types";
import { apply, envelope, level, newHouse } from "../helpers";

const two = (brief: HouseBrief): HouseBrief => ({ ...brief, storeys: 2 });
const preset = (id: string) => two(withPicks(DEFAULT_BRIEF, BRIEF_PRESETS.find((p) => p.id === id)!.picks));
const BRIEFS: Array<[string, HouseBrief]> = [
  ["two-bed", two({ ...DEFAULT_BRIEF, bedrooms: 2, bathrooms: 1 })],
  ["default", two(DEFAULT_BRIEF)],
  ["family-3", preset("family-3")],
  ["family-4", preset("family-4")],
  ["five-bed", two({ ...DEFAULT_BRIEF, bedrooms: 5, bathrooms: 3, requiredSpaces: ["kitchen", "living", "dining", "utility"] })],
];

const generate = (source: PlanDocument, brief: HouseBrief, extra: object = {}, count = 3): PlanningResult =>
  planLayouts({ intent: { action: "generate_layouts", brief, count, ...extra }, source, brief, idPrefix: "t" });

const outlineOf = (doc: PlanDocument, i: number) => {
  const env = analyzeEnvelope(doc.levels[i]);
  return env.ok ? env.info.outsideRing : null;
};

/** Everything a generated two-storey house must satisfy. */
function checkHouse(doc: PlanDocument, brief: HouseBrief, label: string) {
  expect(validateDocument(doc), label).toEqual([]);
  expect(doc.levels, label).toHaveLength(2);
  const [ground, first] = doc.levels;
  expect(outlineOf(doc, 1), label).toEqual(outlineOf(doc, 0));
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

  it("generates within a second", () => {
    const start = performance.now();
    generate(newHouse(), preset("family-4"), { footprint: "auto" });
    expect(performance.now() - start).toBeLessThan(1500);
  });
});
