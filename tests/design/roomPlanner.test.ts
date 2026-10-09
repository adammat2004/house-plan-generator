import { describe, expect, it } from "vitest";
import { DEFAULT_BRIEF } from "@/domain/brief/schema";
import { validateDocument } from "@/domain/commands";
import { assessPlan, briefFit, compareRoom, roomAtPoint, roomConnections, roomFacts, roomWalls, touchesRear } from "@/domain/design/analysis";
import { furnitureIssues } from "@/domain/furniture/issues";
import type { RoomGoal } from "@/domain/design/intent";
import { interpretRequest } from "@/domain/design/request";
import { planLayouts } from "@/domain/design/stripPlanner";
import type { PlanDocument } from "@/domain/plan/types";
import { apply, level, newHouse } from "../helpers";

const withRear = (doc = newHouse()) => apply(doc, { type: "setRearWall", wallId: level(doc).envelope.wallIds[2] });
const layout = (n = 0) => planLayouts({ intent: { action: "generate_layouts", brief: DEFAULT_BRIEF, count: 3 }, source: withRear(), brief: DEFAULT_BRIEF, idPrefix: "t" }).candidates[n].document;
const roomOf = (doc: PlanDocument, type: string) => Object.values(level(doc).rooms).find((r) => r.type === type)!;
const redesign = (doc: PlanDocument, roomId: string, goals: RoomGoal[]) =>
  planLayouts({ intent: { action: "redesign_room", roomId, goals }, source: doc, brief: DEFAULT_BRIEF, idPrefix: "r" });

describe("plan analysis", () => {
  it("summarises a generated layout and finds what each room connects to", () => {
    const doc = layout();
    const a = assessPlan(level(doc));
    expect(a.bedrooms).toBe(3);
    expect(a.bathrooms).toBe(2);
    expect(a.totalArea).toBeGreaterThan(50);
    // The two-wing layout runs its hall to a garden door.
    expect(assessPlan(level(layout(1))).features).toContain("garden_access");
    const primary = roomOf(doc, "primary_bedroom");
    // Four outer sides plus the two walls around the ensuite.
    expect(new Set(roomWalls(level(doc), primary.id).map((w) => w.side)).size).toBe(4);
    expect(roomWalls(level(doc), primary.id).length).toBeGreaterThanOrEqual(6);
    const doors = roomConnections(level(doc), primary.id).filter((c) => c.kind === "door");
    expect(doors.map((d) => (d.target.kind === "room" ? d.target.name : d.target.kind))).toEqual(expect.arrayContaining(["Hall", "Ensuite"]));
  });

  it("scores a plan that matches the brief above one that doesn't", () => {
    const a = assessPlan(level(layout()));
    expect(briefFit(a, DEFAULT_BRIEF)).toBeGreaterThan(briefFit(a, { ...DEFAULT_BRIEF, bedrooms: 6, bathrooms: 4 }));
  });
});

describe("whole-plan generation", () => {
  it("offers further distinct layouts, and similar ones on request", () => {
    const run = (extra: object) => planLayouts({ intent: { action: "generate_layouts", brief: DEFAULT_BRIEF, count: 3, ...extra }, source: withRear(), brief: DEFAULT_BRIEF, idPrefix: "t" });
    const first = run({}).candidates.map((c) => c.arrangement);
    const more = run({ exclude: first }).candidates.map((c) => c.arrangement);
    expect(more.length).toBeGreaterThan(0);
    expect(more.filter((a) => first.includes(a))).toEqual([]);
    const similar = run({ similarTo: first[0], exclude: first, count: 2 }).candidates;
    expect(similar.map((c) => c.arrangement)).not.toContain(first[0]);
    const every = run({ count: 6 }).candidates.map((c) => c.arrangement!);
    const rest = run({ exclude: every, count: 6 }).candidates.map((c) => c.arrangement!);
    expect(run({ exclude: [...every, ...rest] }).issues[0].message).toMatch(/no more distinct layouts/);
  });
});

describe("room planner", () => {
  it("offers larger versions of a room by moving its internal walls, without touching the source", () => {
    const doc = layout();
    const snapshot = JSON.stringify(doc);
    const room = roomOf(doc, "primary_bedroom");
    const before = assessPlan(level(doc)).rooms.find((r) => r.id === room.id)!.area;
    const result = redesign(doc, room.id, ["make_larger"]);
    expect(result.candidates.length).toBeGreaterThan(0);
    for (const c of result.candidates) {
      expect(validateDocument(c.document)).toEqual([]);
      expect(assessPlan(level(c.document)).rooms.find((r) => r.id === room.id)!.area).toBeGreaterThan(before + 0.5);
      expect(c.changedRoomIds).toContain(room.id);
    }
    expect(JSON.stringify(doc)).toBe(snapshot);
  });

  it("adds garden doors to rooms on the rear wall and explains when a room isn't", () => {
    const doc = layout();
    const rear = Object.values(level(doc).rooms).find((r) => r.type !== "hall" && touchesRear(level(doc), r.id))!;
    const front = Object.values(level(doc).rooms).find((r) => r.type !== "hall" && !touchesRear(level(doc), r.id))!;
    const result = redesign(doc, rear.id, ["increase_garden_connection"]);
    expect(result.candidates.length).toBeGreaterThan(0);
    const doors = roomConnections(level(result.candidates[0].document), rear.id).filter((c) => c.kind === "door" && c.target.kind === "garden");
    expect(doors[0].width).toBeGreaterThanOrEqual(1.8);
    expect(redesign(doc, front.id, ["increase_garden_connection"]).issues[0].message).toMatch(/doesn't reach the garden/);
  });

  it("brings in more light and opens day rooms into each other", () => {
    const doc = layout();
    const living = roomOf(doc, "living") ?? roomOf(doc, "kitchen_dining");
    const light = redesign(doc, living.id, ["more_natural_light"]);
    expect(light.candidates.length).toBeGreaterThan(0);
    expect(assessPlan(level(light.candidates[0].document)).glazingRatio).toBeGreaterThan(assessPlan(level(doc)).glazingRatio);

    const separate = planLayouts({
      intent: { action: "generate_layouts", brief: { ...DEFAULT_BRIEF, preferences: ["separate_living_room"] }, count: 1 },
      source: withRear(newHouse(10, 12)),
      brief: DEFAULT_BRIEF,
      idPrefix: "s",
    }).candidates[0].document;
    const kitchen = Object.values(level(separate).rooms).find((r) => r.type === "kitchen" || r.type === "kitchen_dining")!;
    const open = redesign(separate, kitchen.id, ["make_open_plan"]);
    if (open.candidates.length) {
      const after = level(open.candidates[0].document);
      expect(Object.keys(after.rooms)).toHaveLength(Object.keys(level(separate).rooms).length - 1);
      expect(validateDocument(open.candidates[0].document)).toEqual([]);
    } else expect(open.issues[0].message).toMatch(/opened up|no living space/);
  });

  it("varies a room in different ways, and leaves out options already shown", () => {
    const doc = layout();
    const kitchen = Object.values(level(doc).rooms).find((r) => r.type === "kitchen" || r.type === "kitchen_dining")!;
    const variations = (exclude?: string[]) =>
      planLayouts({ intent: { action: "room_variations", roomIds: [kitchen.id], goals: [], count: 3, exclude }, source: doc, brief: DEFAULT_BRIEF, idPrefix: "v" });
    const first = variations();
    expect(first.candidates).toHaveLength(3);
    // A spread of ideas, each with a title and a stable key.
    expect(new Set(first.candidates.map((c) => c.goal)).size).toBeGreaterThan(1);
    for (const c of first.candidates) expect(c.title && c.variant).toBeTruthy();
    const shown = first.candidates.map((c) => c.variant!);
    const more = variations(shown);
    expect(more.candidates.length).toBeGreaterThan(0);
    expect(more.candidates.filter((c) => shown.includes(c.variant!))).toEqual([]);
    // Deterministic: the same request gives the same options.
    expect(variations().candidates.map((c) => c.variant)).toEqual(shown);
  });

  it("describes what a change did to a room and its neighbours", () => {
    const doc = layout();
    const bedroom = roomOf(doc, "primary_bedroom");
    const [larger] = redesign(doc, bedroom.id, ["make_larger"]).candidates;
    const changes = compareRoom(level(doc), level(larger.document), bedroom.id);
    expect(changes.map((c) => c.kind)).toEqual(expect.arrayContaining(["area", "size", "neighbour"]));
    expect(roomFacts(level(larger.document), bedroom.id)!.area).toBeGreaterThan(roomFacts(level(doc), bedroom.id)!.area);
    expect(compareRoom(level(doc), level(doc), bedroom.id)).toEqual([]);
  });

  it("explains goals it can't plan yet", () => {
    const doc = layout();
    const result = redesign(doc, roomOf(doc, "primary_bedroom").id, ["improve_privacy"]);
    expect(result.issues[0]).toMatchObject({ code: "unsupported-intent" });
    expect(result.issues[0].message).toMatch(/Improve privacy/);
  });

  it("adds storage against free walls, the widest first", () => {
    const doc = layout();
    const bedroom = roomOf(doc, "bedroom");
    const { candidates } = redesign(doc, bedroom.id, ["add_storage"]);
    expect(candidates.length).toBeGreaterThan(0);
    for (const c of candidates) {
      const added = Object.values(level(c.document).furniture).filter((f) => !level(doc).furniture[f.id]);
      expect(added.map((f) => f.kind)).toEqual(["wardrobe"]);
      expect([...furnitureIssues(level(c.document))]).toEqual([]);
    }
  });

  it("offers kitchen islands and dining tables with room to walk round them", () => {
    const doc = withRear(newHouse(12, 10));
    const roomId = Object.keys(level(doc).rooms)[0];
    const kitchen = apply(doc, { type: "updateRoom", roomId, changes: { type: "kitchen_dining" } });
    const islands = redesign(kitchen, roomId, ["add_kitchen_island"]).candidates;
    expect(islands.length).toBeGreaterThan(0);
    const kinds = Object.values(level(islands[0].document).furniture).map((f) => f.kind);
    expect(kinds).toEqual(expect.arrayContaining(["kitchen_run", "kitchen_island"]));
    const tables = redesign(kitchen, roomId, ["create_dining_zone"]).candidates;
    expect(tables.map((c) => c.variant)).toEqual(["dining:6", "dining:4"]);
    expect(redesign(kitchen, roomId, ["add_kitchen_island"]).issues).toEqual([]);
    const bedroom = apply(doc, { type: "updateRoom", roomId, changes: { type: "bedroom" } });
    expect(redesign(bedroom, roomId, ["add_kitchen_island"]).issues[0].message).toMatch(/kitchen/);
  });

  it("walls off a bedroom corner as a fitted ensuite with its own door", () => {
    let doc = withRear(newHouse(5, 5));
    const roomId = Object.keys(level(doc).rooms)[0];
    doc = apply(doc, { type: "updateRoom", roomId, changes: { type: "primary_bedroom", name: "Main bedroom" } });
    const { candidates, issues } = redesign(doc, roomId, ["add_ensuite"]);
    expect(issues).toEqual([]);
    expect(candidates.length).toBeGreaterThan(0);
    for (const c of candidates) {
      expect(validateDocument(c.document)).toEqual([]);
      const rooms = Object.values(level(c.document).rooms);
      expect(rooms.map((r) => r.type).sort()).toEqual(["ensuite", "primary_bedroom"]);
      expect(rooms.find((r) => r.type === "primary_bedroom")!.name).toBe("Main bedroom");
      const ensuite = rooms.find((r) => r.type === "ensuite")!;
      expect(roomConnections(level(c.document), ensuite.id).some((d) => d.kind === "door")).toBe(true);
      const fittings = Object.values(level(c.document).furniture).filter((f) => roomAtPoint(level(c.document), f.position) === ensuite.id);
      expect(fittings.map((f) => f.kind).sort()).toEqual(["basin", "shower", "toilet"]);
      expect([...furnitureIssues(level(c.document))]).toEqual([]);
    }
  });

  it("lays furniture out again in rooms whose walls moved", () => {
    const doc = layout();
    const bedroom = roomOf(doc, "bedroom");
    for (const c of redesign(doc, bedroom.id, ["make_smaller", "make_larger"]).candidates) {
      expect([...furnitureIssues(level(c.document))]).toEqual([]);
    }
  });
});

describe("request interpreter", () => {
  it("splits a request into room goals and brief changes", () => {
    const doc = layout();
    const { steps, unclear } = interpretRequest("Make the kitchen larger and add a utility room", level(doc), DEFAULT_BRIEF, null);
    expect(unclear).toEqual([]);
    const kitchen = Object.values(level(doc).rooms).find((r) => r.type === "kitchen" || r.type === "kitchen_dining")!;
    expect(steps[0]).toMatchObject({ kind: "room", roomId: kitchen.id, goals: ["make_larger"] });
    expect(steps[1]).toMatchObject({ kind: "brief", patch: { requiredSpaces: [...DEFAULT_BRIEF.requiredSpaces, "utility"] } });
  });

  it("uses the selected room when none is named, and reports what it can't place", () => {
    const doc = layout();
    const bed = roomOf(doc, "primary_bedroom");
    expect(interpretRequest("more light please", level(doc), DEFAULT_BRIEF, bed.id).steps[0]).toMatchObject({ roomId: bed.id, goals: ["more_natural_light"] });
    expect(interpretRequest("more light please", level(doc), DEFAULT_BRIEF, null).unclear).toEqual(["more light please"]);
    expect(interpretRequest("paint it blue", level(doc), DEFAULT_BRIEF, bed.id).unclear).toEqual(["paint it blue"]);
  });
});
