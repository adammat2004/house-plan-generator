import { describe, expect, it } from "vitest";
import { applyCommand, parsePlanDocumentJson, serializePlanDocument } from "@/domain/commands";
import { assessHouse, assessPlan } from "@/domain/design/analysis";
import { assessHouseSense } from "@/domain/design/houseSense";
import { assessSense } from "@/domain/design/sense";
import { furnitureRect, rectOverlapArea } from "@/domain/furniture/geometry";
import { furnishPlan } from "@/domain/furniture/furnish";
import { furnitureIssues } from "@/domain/furniture/issues";
import { levelKeepOut, risersFor, staircasePlan, stairPlan } from "@/domain/geometry/stairs";
import type { PlanDocument, Staircase } from "@/domain/plan/types";
import { buildStairScene } from "@/editor/rendering/scene/stairScene";
import { apply, newHouse, reject } from "../helpers";

const floor = (doc: PlanDocument, i: number) => doc.levels[i];
const storeys = (n: number, doc = newHouse()) => {
  for (let i = 1; i < n; i++) doc = apply(doc, { type: "addLevel" });
  return doc;
};
const stairs = (doc: PlanDocument, over: Partial<Staircase> = {}): Staircase => ({
  id: "s1",
  fromLevelId: floor(doc, 0).id,
  toLevelId: floor(doc, 1).id,
  shape: "straight",
  foot: { x: 1.2, y: 1.2 },
  rotation: 0,
  width: 0.9,
  going: 0.25,
  ...over,
});
const withStairs = (doc: PlanDocument, over: Partial<Staircase> = {}) => apply(doc, { type: "addStairs", staircase: stairs(doc, over) });
const roomOf = (doc: PlanDocument, i: number) => Object.values(floor(doc, i).rooms)[0];
const typed = (doc: PlanDocument, i: number, type: "hall" | "bedroom" | "living") => apply(doc, { type: "updateRoom", roomId: roomOf(doc, i).id, changes: { type } });
const size = (r: { minX: number; minY: number; maxX: number; maxY: number }) => [Math.round((r.maxX - r.minX) * 1000) / 1000, Math.round((r.maxY - r.minY) * 1000) / 1000];

describe("stair geometry", () => {
  it("gives each storey as few risers as keep every step under 220 mm", () => {
    expect(risersFor(2.7)).toBe(13);
    for (let f = 2.4; f <= 3.6; f += 0.05) {
      const n = risersFor(f);
      expect(f / n).toBeLessThanOrEqual(0.22 + 1e-9);
      expect(f / (n - 1)).toBeGreaterThan(0.22);
    }
  });

  it("lays out straight, L and U stairs with a tread for every step", () => {
    const s = stairs(storeys(2));
    const straight = stairPlan(s, 13);
    expect(size(straight.bounds)).toEqual([0.9, 3]);
    expect(straight.treads.map((t) => t.step)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);

    const u = stairPlan({ ...s, shape: "u", turn: "right" }, 13);
    expect(size(u.bounds)).toEqual([1.85, 2.4]);
    expect(u.treads.map((t) => t.step)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
    // You arrive back beside the foot, on the side it turned to.
    expect(u.path[u.path.length - 1].x).toBeGreaterThan(s.foot.x);
    expect(stairPlan({ ...s, shape: "u", turn: "left" }, 13).path.at(-1)!.x).toBeLessThan(s.foot.x);

    const l = stairPlan({ ...s, shape: "l", turn: "right" }, 13);
    expect(size(l.bounds)).toEqual([2.15, 2.4]);

    // Turned a quarter, the first flight climbs west.
    const west = stairPlan({ ...s, rotation: 90 }, 13);
    expect(west.path.at(-1)).toEqual({ x: s.foot.x - 3, y: s.foot.y });
  });
});

describe("placing stairs", () => {
  it("places stairs that fit, and says why others don't", () => {
    const doc = storeys(2);
    const placed = withStairs(doc);
    expect(placed.staircases?.s1.turn).toBeUndefined();
    const wall = { type: "addWall", start: { x: 1, y: 0.15 }, end: { x: 1, y: 9.85 }, thickness: 0.1 } as const;
    expect(reject(placed, wall)[0].message).toBe("The stairs run into Internal wall 1 on the ground floor.");
    expect(reject(placed, { ...wall, levelId: floor(doc, 1).id })[0].message).toBe("The stairs run into Internal wall 1 on the first floor.");
    expect(reject(doc, { type: "addStairs", staircase: stairs(doc, { foot: { x: 7.5, y: 1.2 } }) })[0].message).toBe("The stairs would stick out of the house on the ground floor.");
    expect(reject(doc, { type: "addStairs", staircase: stairs(doc, { foot: { x: 1.2, y: 0.4 } }) })[0].message).toBe("There's no room to step onto the stairs on the ground floor.");
    expect(reject(doc, { type: "addStairs", staircase: stairs(doc, { toLevelId: floor(doc, 0).id }) })[0].code).toBe("stairs-invalid");
    expect(reject(doc, { type: "addStairs", staircase: stairs(doc, { id: Object.keys(floor(doc, 0).walls)[0] }) })[0].message).toMatch(/already exists/);
    const second = reject(placed, { type: "addStairs", staircase: stairs(doc, { id: "s2", foot: { x: 1.5, y: 1.2 } }) });
    expect(second[0].message).toBe("Stairs 1 and Stairs 2 overlap.");
  });

  it("moves, turns and removes stairs", () => {
    const doc = withStairs(storeys(2));
    const turned = apply(doc, { type: "updateStairs", staircaseId: "s1", changes: { shape: "u", foot: { x: 1.5, y: 1.2 } } });
    expect(turned.staircases?.s1).toMatchObject({ shape: "u", turn: "right", foot: { x: 1.5, y: 1.2 } });
    expect(apply(turned, { type: "updateStairs", staircaseId: "s1", changes: { turn: "left", foot: { x: 3, y: 1.2 } } }).staircases?.s1.turn).toBe("left");
    const gone = apply(doc, { type: "deleteStairs", staircaseId: "s1" });
    expect(gone.staircases).toBeUndefined();
    expect(reject(gone, { type: "deleteStairs", staircaseId: "s1" })[0].code).toBe("not-found");
  });

  it("keeps out of pinned rooms", () => {
    const doc = storeys(2);
    const pinned = apply(doc, { type: "updateRoom", roomId: roomOf(doc, 1).id, changes: { locked: true } });
    expect(reject(pinned, { type: "addStairs", staircase: stairs(doc) })[0].code).toBe("room-pinned");
  });

  it("stacks through three floors, and loses a storey with a floor", () => {
    const doc = storeys(3);
    const u = withStairs(doc, { shape: "u", foot: { x: 2, y: 1.2 }, toLevelId: floor(doc, 2).id });
    const middle = buildStairScene(u, floor(doc, 1).id)[0];
    expect(middle.role).toBe("through");
    expect(middle.labels.map((l) => l.text)).toEqual(["UP", "DOWN"]);

    const two = apply(u, { type: "removeLevel", levelId: floor(doc, 1).id });
    expect(two.staircases?.s1).toMatchObject({ fromLevelId: floor(doc, 0).id, toLevelId: floor(doc, 2).id });
    const one = apply(two, { type: "removeLevel", levelId: floor(doc, 2).id });
    expect(one.staircases).toBeUndefined();
    expect(one.levels).toHaveLength(1);
  });

  it("refuses a taller ceiling when the longer stairs would run into a wall", () => {
    let doc = withStairs(storeys(2));
    doc = apply(doc, { type: "addWall", start: { x: 0.15, y: 4.5 }, end: { x: 7.85, y: 4.5 }, thickness: 0.1 });
    expect(staircasePlan(doc, doc.staircases!.s1).risers).toBe(13);
    expect(reject(doc, { type: "updateLevel", wallHeight: 3 })[0].message).toBe("The stairs run into Internal wall 1 on the ground floor.");
    expect(applyCommand(doc, { type: "updateLevel", wallHeight: 2.6 }).ok).toBe(true);
  });

  it("round-trips through a file", () => {
    const doc = withStairs(storeys(2), { shape: "l", turn: "left", foot: { x: 3, y: 1.2 } });
    const parsed = parsePlanDocumentJson(serializePlanDocument(doc));
    expect(parsed.ok && parsed.document).toEqual(doc);
  });
});

describe("furniture and stairs", () => {
  it("furnishes round the stairs and flags pieces standing on them", () => {
    const doc = withStairs(typed(storeys(2), 0, "living"));
    const keepOut = levelKeepOut(doc, floor(doc, 0).id);
    expect(keepOut.bodies).toHaveLength(1);
    const furnished = furnishPlan(doc, "f");
    const items = Object.values(floor(furnished, 0).furniture);
    expect(items.length).toBeGreaterThan(0);
    for (const item of items) for (const r of [...keepOut.bodies, ...keepOut.zones]) expect(rectOverlapArea(furnitureRect(item), r)).toBeLessThan(0.005);

    const sofa = { id: "sofa", kind: "sofa_2" as const, position: { x: 1.2, y: 2.5 }, rotation: 0 as const, width: 1.5, depth: 0.85, height: 0.8 };
    const blocked = apply(doc, { type: "addFurniture", item: sofa });
    expect(furnitureIssues(floor(blocked, 0), levelKeepOut(blocked, floor(blocked, 0).id)).get("sofa")).toBe("stairs");
    expect(furnitureIssues(floor(blocked, 0)).get("sofa")).not.toBe("stairs");
  });
});

describe("judging a house of several floors", () => {
  it("is exactly the floor's own judgement for a bungalow", () => {
    const doc = newHouse();
    expect(assessHouseSense(doc)).toBe(assessSense(floor(doc, 0)));
    expect(assessHouse(doc)).toBe(assessPlan(floor(doc, 0)));
  });

  it("wants stairs up to every floor, from and to a hall", () => {
    const bare = storeys(2);
    expect(assessHouseSense(bare).findings.map((f) => f.message)).toContain("No stairs lead up to the first floor.");
    const unnamed = withStairs(bare);
    const messages = assessHouseSense(unnamed).findings.filter((f) => f.rule === "stairs").map((f) => f.message);
    expect(messages).toEqual([
      `The stairs start in ${roomOf(unnamed, 0).name}; they should start in a hall or landing.`,
      `The stairs arrive in ${roomOf(unnamed, 1).name}; they should arrive in a hall or landing.`,
    ]);
    const halls = typed(typed(unnamed, 0, "hall"), 1, "hall");
    expect(assessHouseSense(halls).findings.filter((f) => f.rule === "stairs")).toEqual([]);
    expect(assessHouseSense(halls).metrics.groundWc).toBe(false);
  });

  it("counts rooms on every floor", () => {
    const doc = typed(typed(storeys(2), 0, "bedroom"), 1, "bedroom");
    expect(assessHouse(doc)).toMatchObject({ storeys: 2, bedrooms: 2 });
    expect(assessPlan(floor(doc, 0)).bedrooms).toBe(1);
  });
});

describe("stairs on plan", () => {
  it("draws the flight up to the cut on the floor below, and all of it from above", () => {
    const doc = withStairs(storeys(2));
    const [below] = buildStairScene(doc, floor(doc, 0).id);
    expect(below.labels.map((l) => l.text)).toEqual(["UP"]);
    expect(below.breakLine).not.toBeNull();
    expect(below.treads.filter((t) => !t.hidden)).toHaveLength(6);
    const [above] = buildStairScene(doc, floor(doc, 1).id);
    expect(above.labels.map((l) => l.text)).toEqual(["DOWN"]);
    expect(above.treads.every((t) => !t.hidden)).toBe(true);
    expect(above.path[0]).toEqual(below.path.at(-1));
    expect(buildStairScene(newHouse(), floor(newHouse(), 0).id)).toEqual([]);
  });
});
