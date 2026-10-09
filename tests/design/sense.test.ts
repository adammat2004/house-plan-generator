import { describe, expect, it } from "vitest";
import { BRIEF_PRESETS } from "@/domain/brief/rooms";
import { DEFAULT_BRIEF, withPicks, type HouseBrief } from "@/domain/brief/schema";
import { roomAtPoint } from "@/domain/design/analysis";
import { assessSense, SENSE_RULES, type SenseRule } from "@/domain/design/sense";
import { planLayouts } from "@/domain/design/stripPlanner";
import { deriveLevelGeometry } from "@/domain/geometry/derive";
import { axialParam, distanceToAxis } from "@/domain/geometry/walls";
import type { Opening, PlanDocument, Point2, RoomType } from "@/domain/plan/types";
import { AXIS, addWall, apply, envelope, level, newHouse } from "../helpers";

/**
 * A small house that makes sense, 8 × 10 m with the garden to the north:
 *
 *   ┌────────────┬──────────────┐ north (garden)
 *   │  Bedroom   │   Kitchen    │  window N · garden door N, window E
 *   │            │              │
 *   ├──door──────┴────door──────┤ y = 4
 *   │  Hall  door   Living      │
 *   └──front─────┴───window─────┘ south (street)
 *              x = 3 (hall)  x = 4 (bedroom | kitchen)
 *
 * Each test breaks one thing and checks the rule that catches it.
 */

function at(doc: PlanDocument, p: Point2, kind: "door" | "window", width = 0.9): Opening {
  const geometry = deriveLevelGeometry(level(doc));
  const axis = [...geometry.axes.values()].find((a) => distanceToAxis(a, p) < 1e-6 && axialParam(a, p) > 0 && axialParam(a, p) < a.length);
  if (!axis) throw new Error(`No wall at ${p.x}, ${p.y}`);
  const id = `${kind}-${p.x}-${p.y}`;
  const offset = axialParam(axis, p) - width / 2;
  return kind === "door"
    ? { id, wallId: axis.wallId, kind, offset, width, height: 2.1, hinge: "start", swingSide: "left" }
    : { id, wallId: axis.wallId, kind, offset, width, height: 1.2, sillHeight: 0.9 };
}

const add = (doc: PlanDocument, p: Point2, kind: "door" | "window", width?: number) => apply(doc, { type: "addOpening", opening: at(doc, p, kind, width) });

function name(doc: PlanDocument, p: Point2, roomName: string, type: RoomType): PlanDocument {
  const roomId = roomAtPoint(level(doc), p);
  if (!roomId) throw new Error(`No room at ${p.x}, ${p.y}`);
  return apply(doc, { type: "updateRoom", roomId, changes: { name: roomName, type } });
}

const P = {
  hall: { x: 1.5, y: 2 },
  living: { x: 5.5, y: 2 },
  bedroom: { x: 2, y: 7 },
  kitchen: { x: 6, y: 7 },
  frontDoor: { x: 1.5, y: AXIS.south },
  hallToLiving: { x: 3, y: 2 },
  hallToBedroom: { x: 1.5, y: 4 },
  livingToKitchen: { x: 6, y: 4 },
  gardenDoor: { x: 6, y: AXIS.north },
  bedroomWindow: { x: 2, y: AXIS.north },
};

function goodHouse(): PlanDocument {
  let doc = newHouse();
  doc = apply(doc, { type: "setRearWall", wallId: envelope(doc).sides.north });
  doc = addWall(doc, "a", [AXIS.west, 4], [AXIS.east, 4]);
  doc = addWall(doc, "b", [3, AXIS.south], [3, 4]);
  doc = addWall(doc, "c", [4, 4], [4, AXIS.north]);
  doc = name(doc, P.hall, "Hall", "hall");
  doc = name(doc, P.living, "Living Room", "living");
  doc = name(doc, P.bedroom, "Bedroom", "bedroom");
  doc = name(doc, P.kitchen, "Kitchen", "kitchen");
  for (const p of [P.frontDoor, P.hallToLiving, P.hallToBedroom, P.livingToKitchen, P.gardenDoor]) doc = add(doc, p, "door");
  doc = add(doc, { x: 5.5, y: AXIS.south }, "window", 1.5);
  doc = add(doc, P.bedroomWindow, "window");
  doc = add(doc, { x: AXIS.east, y: 7 }, "window");
  return doc;
}

const without = (doc: PlanDocument, p: Point2, kind: "door" | "window") => {
  const target = at(doc, p, kind);
  const found = Object.values(level(doc).openings).find((o) => o.wallId === target.wallId && Math.abs(o.offset - target.offset) < 0.05);
  if (!found) throw new Error("No opening there");
  return apply(doc, { type: "deleteOpening", openingId: found.id });
};

const rules = (doc: PlanDocument) => assessSense(level(doc)).findings.map((f) => f.rule);

describe("plan sense", () => {
  it("finds nothing wrong with a sensible house", () => {
    const sense = assessSense(level(goodHouse()));
    expect(sense.findings).toEqual([]);
    expect(sense.metrics.gardenDoorFromLiving).toBe(true);
    expect(sense.metrics.irregularRooms).toBe(0);
    expect(sense.score).toBeGreaterThan(80);
  });

  it("finds a room that can't be reached", () => {
    const doc = without(goodHouse(), P.hallToBedroom, "door");
    const finding = assessSense(level(doc)).findings.find((f) => f.rule === "reachable");
    expect(finding?.message).toBe("Bedroom can't be reached from the front door.");
  });

  it("finds a front door on the wrong side, or into the wrong room", () => {
    let doc = without(goodHouse(), P.frontDoor, "door");
    doc = add(doc, { x: AXIS.west, y: 2 }, "door");
    expect(assessSense(level(doc)).findings.find((f) => f.rule === "front_door")?.message).toBe("The front door isn't on the street side; it's on the west wall.");
    expect(rules(name(goodHouse(), P.hall, "Utility", "utility"))).toContain("front_door");
    expect(rules(without(goodHouse(), P.frontDoor, "door"))).toContain("front_door");
  });

  it("finds a habitable room with no window, but not a bathroom", () => {
    expect(rules(without(goodHouse(), P.bedroomWindow, "window"))).toEqual(["daylight"]);
    expect(rules(name(without(goodHouse(), P.bedroomWindow, "window"), P.bedroom, "Bathroom", "bathroom"))).not.toContain("daylight");
  });

  it("finds a kitchen cut off from where people eat", () => {
    let doc = without(goodHouse(), P.livingToKitchen, "door");
    doc = add(doc, { x: 4, y: 7 }, "door");
    expect(rules(doc)).toEqual(["kitchen_connected"]);
  });

  it("finds a bathroom that opens onto a living space", () => {
    const doc = name(goodHouse(), P.kitchen, "Bathroom", "bathroom");
    expect(assessSense(level(doc)).findings.find((f) => f.rule === "wet_room_privacy")?.message).toBe("Bathroom opens straight onto living room.");
  });

  it("finds a room too narrow and too long for its type", () => {
    let doc = addWall(goodHouse(), "strip", [0.95, 4], [0.95, AXIS.north]);
    doc = name(doc, { x: 0.6, y: 7 }, "Bedroom 2", "bedroom");
    const finding = assessSense(level(doc)).findings.find((f) => f.rule === "room_shape" && f.message.startsWith("Bedroom 2"));
    expect(finding?.message).toMatch(/^Bedroom 2 is only 0\.6 m wide and .* too long and narrow and only/);
  });

  it("finds a master bedroom smaller than another bedroom", () => {
    const doc = name(goodHouse(), P.living, "Master Bedroom", "primary_bedroom");
    expect(assessSense(level(doc)).findings.find((f) => f.rule === "master_largest")?.message).toMatch(/^Master Bedroom \(\d+\.\d m²\) is smaller than Bedroom\.$/);
  });

  it("scores less hallway higher", () => {
    const base = assessSense(level(goodHouse()));
    const hallier = assessSense(level(name(goodHouse(), P.living, "Landing", "hall")));
    expect(hallier.metrics.hallShare).toBeGreaterThan(base.metrics.hallShare);
    expect(hallier.score).toBeLessThan(base.score);
  });
});

/**
 * The scoreboard: how today's planners do against each rule, over every
 * preset sized from the rooms, as rectangles and other shapes. Report-only
 * for now; a rule becomes a planner filter once every case here passes it.
 */
describe("plan sense scoreboard", () => {
  const preset = (id: string, extra: Partial<HouseBrief> = {}): HouseBrief => ({ ...withPicks(DEFAULT_BRIEF, BRIEF_PRESETS.find((p) => p.id === id)!.picks), ...extra });
  const cases: Array<[string, HouseBrief]> = [
    ...BRIEF_PRESETS.map((p) => [p.id, preset(p.id)] as [string, HouseBrief]),
    ["family-4 any shape", preset("family-4", { houseShape: "any" })],
    ["family-3 L", preset("family-3", { houseShape: "L" })],
    ["bungalow U", preset("bungalow", { houseShape: "U" })],
  ];

  it("records how many generated plans break each rule", () => {
    const failing = Object.fromEntries(SENSE_RULES.map((r) => [r, 0])) as Record<SenseRule, number>;
    let plans = 0;
    let score = 0;
    for (const [, brief] of cases) {
      const result = planLayouts({ intent: { action: "generate_layouts", brief, count: 3, footprint: "auto" }, source: newHouse(), brief, idPrefix: "s" });
      for (const c of result.candidates) {
        const sense = assessSense(level(c.document));
        plans++;
        score += sense.score;
        for (const rule of new Set(sense.findings.map((f) => f.rule))) failing[rule]++;
      }
    }
    expect({ plans, meanScore: Math.round(score / plans), failing }).toMatchSnapshot();
  });
});
