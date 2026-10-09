import { describe, expect, it } from "vitest";
import { DEFAULT_BRIEF, type HouseBrief } from "@/domain/brief/schema";
import { validateDocument } from "@/domain/commands";
import { roomConnections } from "@/domain/design/analysis";
import { assessSense, findingsFor } from "@/domain/design/sense";
import type { PlanningResult } from "@/domain/design/planner";
import { arrangementTitle, planLayouts } from "@/domain/design/stripPlanner";
import { wingArrangementOf } from "@/domain/design/wingPlanner";
import { analyzeEnvelope } from "@/domain/geometry/envelope";
import type { Point2, PlanDocument } from "@/domain/plan/types";
import { OUTLINES, randomOutline } from "../fixtures/outlines";
import { apply, envelope, level, newOutlineHouse } from "../helpers";

const TWO: HouseBrief = { ...DEFAULT_BRIEF, bedrooms: 2, bathrooms: 1 };
const LARGE: HouseBrief = {
  bedrooms: 4,
  bathrooms: 3,
  requiredSpaces: ["kitchen", "living", "dining", "office", "utility"],
  preferences: ["separate_living_room"],
  additionalInstructions: "",
};

const scaled = (ring: readonly Point2[], k: number) => ring.map((p) => ({ x: Math.round(p.x * k * 2) / 2, y: Math.round(p.y * k * 2) / 2 }));

function house(outline: readonly Point2[], rear: "north" | "east" | "south" | "west" = "north"): PlanDocument {
  const doc = newOutlineHouse([...outline]);
  return apply(doc, { type: "setRearWall", wallId: envelope(doc).sides[rear] });
}

const generate = (source: PlanDocument, brief: HouseBrief, extra: object = {}, count = 3): PlanningResult =>
  planLayouts({ intent: { action: "generate_layouts", brief, count, ...extra }, source, brief, idPrefix: "w" });

/** Everything a generated layout must satisfy, whatever its shape. */
function checkLayout(doc: PlanDocument, label: string) {
  const lvl = level(doc);
  expect(validateDocument(doc), label).toEqual([]);
  const rooms = Object.values(lvl.rooms);
  expect(rooms.filter((r) => r.type === "unspecified"), label).toEqual([]);
  const halls = rooms.filter((r) => r.type === "hall");
  expect(halls, label).toHaveLength(1);
  // Every room can be reached from the front door through doors.
  expect(findingsFor(assessSense(lvl), ["reachable"]), label).toEqual([]);
  // The front door opens into the hall from outside.
  expect(roomConnections(lvl, halls[0].id).some((c) => c.kind === "door" && c.target.kind !== "room"), `${label}: front door`).toBe(true);
}

describe("wing planner", () => {
  const shapes = ["L", "T", "U", "Z", "bay", "notch"] as const;

  it("lays out every named shape for a three- and a two-bedroom brief", () => {
    for (const name of shapes) {
      for (const [briefName, brief] of [["default", DEFAULT_BRIEF], ["two", TWO]] as const) {
        const result = generate(house(OUTLINES[name]), brief);
        const label = `${name}/${briefName}`;
        expect(result.issues, label).toEqual([]);
        expect(result.candidates.length, label).toBe(3);
        for (const c of result.candidates) {
          checkLayout(c.document, `${label} ${c.arrangement}`);
          expect(wingArrangementOf(c.arrangement!), c.arrangement).not.toBeNull();
          expect(arrangementTitle(c.arrangement!)).toBeTruthy();
        }
        const walls = result.candidates.map((c) => JSON.stringify(Object.values(level(c.document).walls).map((w) => [level(c.document).vertices[w.startVertexId], level(c.document).vertices[w.endVertexId]])));
        expect(new Set(walls).size, `${label} distinct`).toBe(3);
      }
    }
  });

  it("lays out a large brief in bigger houses of each shape", () => {
    for (const name of shapes) {
      const result = generate(house(scaled(OUTLINES[name], 1.35)), LARGE, {}, 2);
      expect(result.candidates.length, `${name} ${result.issues.map((i) => i.message)}`).toBeGreaterThan(0);
      for (const c of result.candidates) checkLayout(c.document, `${name}/large ${c.arrangement}`);
    }
  });

  it("is deterministic and keeps the source plan and its garden side", () => {
    const source = house(OUTLINES.L, "east");
    const before = JSON.stringify(source);
    const a = generate(source, DEFAULT_BRIEF);
    expect(JSON.stringify(generate(source, DEFAULT_BRIEF))).toBe(JSON.stringify(a));
    expect(JSON.stringify(source)).toBe(before);
    for (const c of a.candidates) {
      const env = analyzeEnvelope(level(c.document));
      expect(env.ok && env.info.outsideRing).toEqual(OUTLINES.L);
      const rear = level(c.document).rearWallId;
      expect(env.ok && rear && env.info.sideOfWall[rear]).toBe("east");
    }
  });

  it("offers more layouts that leave out the ones shown, and similar ones first", () => {
    const source = house(OUTLINES.U);
    const first = generate(source, DEFAULT_BRIEF);
    const shown = first.candidates.map((c) => c.arrangement!);
    const more = generate(source, DEFAULT_BRIEF, { exclude: shown });
    expect(more.candidates.length).toBeGreaterThan(0);
    for (const c of more.candidates) expect(shown).not.toContain(c.arrangement);
    const similar = generate(source, DEFAULT_BRIEF, { similarTo: shown[0], exclude: shown }, 1);
    expect(wingArrangementOf(similar.candidates[0].arrangement!)).toBe(wingArrangementOf(shown[0]));
  });

  it("says how much floor the rooms need when the house is too small", () => {
    const result = generate(house(OUTLINES.L), LARGE);
    expect(result.candidates).toEqual([]);
    expect(result.issues[0]).toMatchObject({ code: "does-not-fit", tooSmall: true });
    expect(result.issues[0].message).toMatch(/^These rooms need about \d+ m² inside; your L-shaped house has about \d+ m²/);
  });

  it("describes a rectangle with a bay as one, not as a T", () => {
    const result = generate(house(OUTLINES.bay), DEFAULT_BRIEF, {}, 1);
    expect(result.candidates[0].summary).toMatch(/^Rectangular with a bay house\./);
  });

  it("either lays out random outlines or says why not", () => {
    let laid = 0;
    let tried = 0;
    for (let seed = 1; seed <= 60; seed++) {
      const ring = randomOutline(seed);
      let doc: PlanDocument;
      try {
        doc = house(ring);
      } catch {
        continue;
      }
      tried++;
      const result = generate(doc, TWO, {}, 2);
      if (!result.candidates.length) {
        expect(result.issues[0]?.message.length, `seed ${seed}`).toBeGreaterThan(20);
        continue;
      }
      laid++;
      for (const c of result.candidates) checkLayout(c.document, `seed ${seed} ${c.arrangement}`);
    }
    console.info(`random outlines laid out: ${laid} of ${tried}`);
    expect(laid / tried).toBeGreaterThan(0.5);
  });
});
