import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { DEFAULT_BRIEF, type HouseBrief } from "@/domain/brief/schema";
import { createPlanDocument } from "@/domain/commands";
import type { RoomGoal } from "@/domain/design/intent";
import type { PlanningResult } from "@/domain/design/planner";
import { renderKey } from "@/domain/design/renderRequest";
import { planLayouts } from "@/domain/design/stripPlanner";
import type { PlanDocument } from "@/domain/plan/types";
import { DEFAULT_APPEARANCE } from "@/domain/project/schema";
import { buildTemplatePlan, PROJECT_TEMPLATES } from "@/domain/project/templates";
import { buildDimensions } from "@/editor/rendering/scene/planScene";
import { buildHouseModel } from "@/editor/rendering/three/houseModel";
import { apply, level, newHouse } from "../helpers";

/**
 * Golden fingerprints of rectangular houses. Generalising the house outline
 * must leave every rectangle exactly as it was: the same walls, rooms,
 * openings, furniture, 3D model, dimensions and photo keys. Only the schema
 * version and the envelope's kind tag may change, so both are left out.
 */

function stable(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((k) => [k, stable((value as Record<string, unknown>)[k])]),
    );
  }
  return value;
}

function canonical(doc: PlanDocument): unknown {
  return { ...doc, schemaVersion: undefined, levels: doc.levels.map((l) => ({ ...l, envelope: { wallIds: l.envelope.wallIds } })) };
}

const fingerprint = (value: unknown) => createHash("sha256").update(JSON.stringify(stable(value))).digest("hex").slice(0, 16);

function summarise(result: PlanningResult) {
  return {
    issues: result.issues,
    candidates: result.candidates.map((c) => ({
      arrangement: c.arrangement,
      variant: c.variant,
      summary: c.summary,
      notes: c.notes,
      footprint: c.footprint,
      changedRoomIds: c.changedRoomIds,
      goal: c.goal,
      title: c.title,
      document: fingerprint(canonical(c.document)),
    })),
  };
}

const withRear = (doc: PlanDocument, index = 2) => apply(doc, { type: "setRearWall", wallId: level(doc).envelope.wallIds[index] });

const generate = (brief: HouseBrief, source: PlanDocument, count = 6, extra: object = {}) =>
  planLayouts({ intent: { action: "generate_layouts", brief, count, ...extra }, source, brief, idPrefix: "g" });

const LARGE: HouseBrief = {
  bedrooms: 4,
  bathrooms: 3,
  requiredSpaces: ["kitchen", "living", "dining", "office", "utility", "garage"],
  preferences: ["separate_living_room", "large_kitchen", "utility_near_kitchen"],
  additionalInstructions: "",
};

describe("golden: rectangular houses stay exactly as they were", () => {
  it("creates the same empty house", () => {
    expect(fingerprint(canonical(newHouse()))).toMatchSnapshot();
    expect(fingerprint(canonical(createPlanDocument({ id: "d", name: "n", width: 12.35, depth: 9.1, externalThickness: 0.35, wallHeight: 2.7, idPrefix: "p" })))).toMatchSnapshot();
  });

  it("lays out the same plans inside the user's house", () => {
    expect(summarise(generate(DEFAULT_BRIEF, withRear(newHouse())))).toMatchSnapshot();
    expect(summarise(generate(DEFAULT_BRIEF, withRear(newHouse(), 1)))).toMatchSnapshot();
    expect(summarise(generate(DEFAULT_BRIEF, withRear(newHouse(9, 9), 0)))).toMatchSnapshot();
    expect(summarise(generate(DEFAULT_BRIEF, newHouse(11, 8)))).toMatchSnapshot();
    expect(summarise(generate(LARGE, withRear(newHouse(14, 13))))).toMatchSnapshot();
    expect(summarise(generate({ ...DEFAULT_BRIEF, preferences: ["kitchen_faces_garden", "open_plan"] }, withRear(newHouse(10, 11))))).toMatchSnapshot();
    expect(summarise(generate({ ...DEFAULT_BRIEF, preferences: ["accessible_layout", "maximize_natural_light"] }, withRear(newHouse(12, 11), 3)))).toMatchSnapshot();
    expect(summarise(generate(DEFAULT_BRIEF, withRear(newHouse(), 2), 3, { exclude: ["garden-living"] }))).toMatchSnapshot();
    expect(summarise(generate(DEFAULT_BRIEF, withRear(newHouse(), 2), 3, { similarTo: "two-wings" }))).toMatchSnapshot();
  });

  it("gives the same too-small message", () => {
    expect(summarise(generate(LARGE, withRear(newHouse(6, 6))))).toMatchSnapshot();
  });

  it("sizes the same houses from the rooms", () => {
    expect(summarise(generate(DEFAULT_BRIEF, newHouse(), 6, { footprint: "auto" }))).toMatchSnapshot();
    expect(summarise(generate(LARGE, newHouse(), 6, { footprint: "auto" }))).toMatchSnapshot();
    expect(summarise(generate(DEFAULT_BRIEF, newHouse(), 4, { footprint: "auto", plot: { maxWidth: 10 } }))).toMatchSnapshot();
    expect(summarise(generate(LARGE, newHouse(), 3, { footprint: "auto", plot: { maxWidth: 9, maxDepth: 9 } }))).toMatchSnapshot();
  });

  it("builds the same templates", () => {
    for (const template of PROJECT_TEMPLATES.filter((t) => !t.outline)) {
      const plan = buildTemplatePlan(template, "tpl");
      expect(plan && fingerprint(canonical(plan)), template.id).toMatchSnapshot();
    }
  });

  it("makes the same room proposals", () => {
    const doc = generate(DEFAULT_BRIEF, withRear(newHouse()), 1).candidates[0].document;
    const goals: RoomGoal[] = ["make_larger", "make_smaller", "more_natural_light", "increase_garden_connection", "make_open_plan", "add_storage", "add_ensuite"];
    for (const room of Object.values(level(doc).rooms).sort((a, b) => a.id.localeCompare(b.id))) {
      for (const goal of goals) {
        const result = planLayouts({ intent: { action: "redesign_room", roomId: room.id, goals: [goal] }, source: doc, brief: DEFAULT_BRIEF, idPrefix: "r" });
        expect(summarise(result), `${room.name} ${goal}`).toMatchSnapshot();
      }
    }
  });

  it("draws the same 3D model, dimensions and photo keys", () => {
    for (const [i, source] of [withRear(newHouse()), withRear(newHouse(14, 13), 1)].entries()) {
      const brief = i === 0 ? DEFAULT_BRIEF : LARGE;
      const lvl = level(generate(brief, source, 1).candidates[0].document);
      for (const options of [
        { cutaway: false, roof: true, dimensions: true, landscape: true, furniture: true },
        { cutaway: true, roof: false, dimensions: false, landscape: false, furniture: false },
      ]) {
        const { boxes, floors, outside, wallHeight, labels, site } = buildHouseModel(lvl, options);
        // Floors as the flat ring list they were stored as before each became a list of polygons.
        const legacyFloors = floors.map(({ polygons, ...floor }) => ({ ...floor, rings: polygons.flatMap((p) => [p.outer, ...p.holes]) }));
        expect(fingerprint({ boxes, floors: legacyFloors, outside, wallHeight, labels, site })).toMatchSnapshot();
      }
      expect(fingerprint(buildDimensions(lvl, null))).toMatchSnapshot();
      const someRoom = Object.keys(lvl.rooms).sort()[0];
      const someWall = Object.keys(lvl.walls).sort()[0];
      expect(fingerprint(buildDimensions(lvl, { kind: "room", id: someRoom }))).toMatchSnapshot();
      expect(fingerprint(buildDimensions(lvl, { kind: "wall", id: someWall }))).toMatchSnapshot();
      for (const target of [{ kind: "exterior" as const }, { kind: "aerial" as const }, { kind: "room" as const, roomId: someRoom }]) {
        expect(renderKey(lvl, target, DEFAULT_APPEARANCE, "warm_minimal")).toMatchSnapshot();
      }
    }
  });
});
