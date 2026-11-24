import { describe, expect, it } from "vitest";
import { BRIEF_PRESETS } from "@/domain/brief/rooms";
import { DEFAULT_BRIEF, withPicks, type HouseBrief } from "@/domain/brief/schema";
import { validateDocument } from "@/domain/commands";
import { roomBounds, roomConnections, roomRegion } from "@/domain/design/analysis";
import { programFromBrief } from "@/domain/design/program";
import { assessSense, findingsFor } from "@/domain/design/sense";
import { planLayouts } from "@/domain/design/stripPlanner";
import { compareIdeas, ideaOf } from "@/domain/design/eval/metrics";
import { isDirectZone, isSplitZone, isZoneLayout } from "@/domain/design/zoneLayouts";
import { nightSpaces, planZoneColumns, planZones, splitNights, zoneFootprints } from "@/domain/design/zonePlanner";
import type { PlanDocument } from "@/domain/plan/types";
import { apply, envelope, level, newHouse, newOutlineHouse } from "../helpers";

const preset = (id: string): HouseBrief => withPicks(DEFAULT_BRIEF, BRIEF_PRESETS.find((p) => p.id === id)!.picks);
const auto = (brief: HouseBrief, count = 3) => planLayouts({ intent: { action: "generate_layouts", brief, count, footprint: "auto" }, source: newHouse(), brief, idPrefix: "z" });
const LIVING = new Set(["living", "kitchen", "kitchen_dining", "dining"]);

/**
 * What every zone layout must be: valid, sensible, entered from the street (into the hall, or with direct
 * entry into a living space whose door leads on to the hall), with garden doors from a living space.
 */
function checkZoneLayout(doc: PlanDocument, label: string, direct = false) {
  const lvl = level(doc);
  expect(validateDocument(doc), label).toEqual([]);
  expect(assessSense(lvl).findings.map((f) => f.message), label).toEqual([]);
  const hall = Object.values(lvl.rooms).find((r) => r.type === "hall")!;
  const frontDoor = (id: string) => roomConnections(lvl, id).some((c) => c.kind === "door" && c.target.kind === "outside" && c.side === "south");
  if (direct) {
    const entry = Object.values(lvl.rooms).find((r) => frontDoor(r.id));
    expect(entry && LIVING.has(entry.type), `${label}: front door into a living space`).toBe(true);
    const hallFrom = roomConnections(lvl, hall.id).filter((c) => c.kind === "door" && c.target.kind === "room" && LIVING.has(lvl.rooms[c.target.roomId].type));
    expect(hallFrom.length, `${label}: the hall opens off one living space`).toBe(1);
  } else expect(frontDoor(hall.id), `${label}: front door`).toBe(true);
  const gardenDoor = Object.values(lvl.rooms).some((r) => LIVING.has(r.type) && roomConnections(lvl, r.id).some((c) => c.kind === "door" && c.target.kind === "garden"));
  expect(gardenDoor, `${label}: garden doors`).toBe(true);
  // The day zone isn't a corridor: at most one living space opens off the hall.
  const offHall = roomConnections(lvl, hall.id).filter((c) => c.kind === "door" && c.target.kind === "room" && LIVING.has(lvl.rooms[c.target.roomId].type));
  expect(offHall.length, `${label}: day rooms off the hall`).toBeLessThanOrEqual(1);
}

describe("zone layouts", () => {
  it("lead with a sensible zone layout for every preset sized from the rooms", () => {
    for (const p of BRIEF_PRESETS) {
      const result = auto(preset(p.id));
      expect(result.issues, p.id).toEqual([]);
      const first = result.candidates[0];
      expect(isZoneLayout(first.arrangement), `${p.id}: ${first.arrangement}`).toBe(true);
      checkZoneLayout(first.document, p.id, isDirectZone(first.arrangement));
    }
  });

  it("offer different ideas, or the same idea in houses of different sizes, never the same plan twice", () => {
    const candidates = auto(preset("family-3")).candidates;
    expect(candidates).toHaveLength(3);
    expect(new Set(candidates.map((c) => `${c.footprint?.width}x${c.footprint?.depth}`)).size).toBeGreaterThanOrEqual(2);
    for (let i = 0; i < candidates.length; i++) for (let j = i + 1; j < candidates.length; j++) expect(compareIdeas(ideaOf(candidates[i].document), ideaOf(candidates[j].document)).identical).toBe(false);
  });

  it("offer the front door into the living spaces, with the bedrooms off a short inner hall", () => {
    for (const id of ["starter", "family-3", "bungalow"]) {
      const direct = auto(preset(id), 6).candidates.find((c) => isDirectZone(c.arrangement));
      expect(direct, id).toBeDefined();
      checkZoneLayout(direct!.document, id, true);
      expect(direct!.summary, id).toMatch(/front door opens into the living spaces/);
    }
  });

  it("fill a rectangle the user drew, with the garden where they marked it", () => {
    let doc = newHouse(12, 9);
    doc = apply(doc, { type: "setRearWall", wallId: envelope(doc).sides.north });
    const brief = preset("family-3");
    const result = planLayouts({ intent: { action: "generate_layouts", brief, count: 3 }, source: doc, brief, idPrefix: "u" });
    const zones = result.candidates.filter((c) => isZoneLayout(c.arrangement));
    expect(zones.length).toBeGreaterThan(0);
    for (const c of zones) expect(validateDocument(c.document), c.arrangement).toEqual([]);
  });

  it("keep the master a rectangle beside its own ensuite", () => {
    const doc = auto(preset("family-3"), 1).candidates[0].document;
    const lvl = level(doc);
    const master = Object.values(lvl.rooms).find((r) => r.type === "primary_bedroom")!;
    const ensuite = Object.values(lvl.rooms).find((r) => r.type === "ensuite")!;
    expect(roomConnections(lvl, ensuite.id).filter((c) => c.kind === "door").map((c) => (c.target.kind === "room" ? c.target.roomId : c.target.kind))).toEqual([master.id]);
    const bounds = roomBounds(lvl, master.id)!;
    expect(roomRegion(lvl, master.id)!.clearArea).toBeCloseTo((bounds.maxX - bounds.minX) * (bounds.maxY - bounds.minY), 3);
  });

  it("are deterministic", () => {
    const a = auto(preset("family-4"));
    const b = auto(preset("family-4"));
    expect(JSON.stringify(a.candidates.map((c) => c.document))).toBe(JSON.stringify(b.candidates.map((c) => c.document)));
  });

  it("propose house sizes within the plot", () => {
    const program = programFromBrief(preset("family-4"));
    for (const fp of zoneFootprints(program, { hallWidth: 1.2, doorWidth: 0.9, externalThickness: 0.3, plot: { maxWidth: 12 } })) expect(fp.width).toBeLessThanOrEqual(12);
  });

  it("say why a rectangle is too small for a zone layout", () => {
    const program = programFromBrief(preset("family-4"));
    const { plans, problem } = planZones({ minX: 0, maxX: 7, minY: 0, maxY: 7 }, program, { hallWidth: 1.2, doorWidth: 0.9, rearSide: "north" });
    expect(plans).toEqual([]);
    expect(problem).toBeTruthy();
  });

  it("lead with an L of bedrooms beside living spaces when an L is asked for", () => {
    for (const id of ["family-3", "family-4", "bungalow"]) {
      const result = auto({ ...preset(id), houseShape: "L" });
      const first = result.candidates[0];
      expect(first.arrangement, id).toMatch(/^zones-[lr]\.L\./);
      expect(envelope(first.document).family, id).toBe("L");
      checkZoneLayout(first.document, `${id} L`, isDirectZone(first.arrangement));
    }
  });

  it("propose L houses it can lay out, each a valid outline", () => {
    const program = programFromBrief(preset("family-4"));
    const ls = zoneFootprints(program, { hallWidth: 1.2, doorWidth: 0.9, externalThickness: 0.3, shapes: "L" });
    expect(ls.length).toBeGreaterThan(0);
    for (const fp of ls) {
      let doc = newOutlineHouse(fp.outline!);
      doc = apply(doc, { type: "setRearWall", wallId: envelope(doc).sides.north });
      expect(validateDocument(doc), fp.key).toEqual([]);
      expect(planZoneColumns(envelope(doc).axisRing, program, { hallWidth: 1.2, doorWidth: 0.9, rearSide: "north" }).plans.length, fp.key).toBeGreaterThan(0);
    }
  });

  it("plan a live preview quickly", () => {
    const brief = preset("family-4");
    auto(brief, 1);
    const started = performance.now();
    auto(brief, 1);
    // A loose bound (three times the 60 ms budget) so shared CI machines don't flake.
    expect(performance.now() - started).toBeLessThan(180);
  });

  it("turns the end of the bedrooms' hall into the master's walk-in wardrobe when it's big enough", () => {
    const lvl = level(auto(preset("family-3"), 1).candidates[0].document);
    const wardrobe = Object.values(lvl.rooms).find((r) => r.name === "Wardrobe");
    expect(wardrobe).toBeDefined();
    const doors = roomConnections(lvl, wardrobe!.id).filter((c) => c.kind === "door");
    expect(doors.map((c) => (c.target.kind === "room" ? lvl.rooms[c.target.roomId].type : c.target.kind))).toEqual(["primary_bedroom"]);
  });

  it("puts the kitchen on the garden when the brief asks", () => {
    for (const id of ["family-3", "family-4", "bungalow"]) {
      const brief = { ...preset(id), preferences: ["kitchen_faces_garden" as const] };
      for (const c of auto(brief).candidates) {
        expect(ideaOf(c.document).descriptor.kitchenPos, `${id} ${c.arrangement}`).toBe("garden");
      }
    }
  });

  it("never puts a private master by the front door", () => {
    // The starter's master has no ensuite, so it could take the street end of a direct-entry night zone.
    const program = programFromBrief(preset("starter"));
    const opts = { hallWidth: 1.2, doorWidth: 0.9, rearSide: "north" as const };
    const axis = { minX: 0, maxX: 9.2, minY: 0, maxY: 9.2 };
    expect(planZones(axis, program, opts).plans.some((p) => /\.em/.test(p.id))).toBe(true);
    expect(planZones(axis, program, { ...opts, primaryPrivate: true }).plans.some((p) => /\.em/.test(p.id))).toBe(false);
  });

  it("lay a T out as a bedroom wing either side of the living spaces, the master suite on its own", () => {
    for (const id of ["family-3", "family-4"]) {
      const result = auto({ ...preset(id), houseShape: "T" });
      const first = result.candidates[0];
      expect(isSplitZone(first.arrangement), `${id}: ${first.arrangement}`).toBe(true);
      expect(envelope(first.document).family, id).toBe("T");
      checkSplitLayout(first.document, `${id} T`);
    }
  });

  it("lay a drawn U out with the living spaces down the middle", () => {
    const ring = [[0, 0], [5, 0], [5, 5], [9, 5], [9, 0], [14, 0], [14, 11], [0, 11]].map(([x, y]) => ({ x, y }));
    let doc = newOutlineHouse(ring);
    doc = apply(doc, { type: "setRearWall", wallId: envelope(doc).sides.north });
    const brief = preset("family-3");
    const result = planLayouts({ intent: { action: "generate_layouts", brief, count: 3 }, source: doc, brief, idPrefix: "u" });
    const split = result.candidates.find((c) => isSplitZone(c.arrangement));
    expect(split, result.candidates.map((c) => c.arrangement).join(", ")).toBeDefined();
    checkSplitLayout(split!.document, "drawn U");
  });

  it("propose U and T houses each a valid outline of its shape", () => {
    const program = programFromBrief(preset("family-4"));
    for (const shape of ["U", "T"] as const) {
      const fps = zoneFootprints(program, { hallWidth: 1.2, doorWidth: 0.9, externalThickness: 0.3, shapes: shape });
      for (const fp of fps) {
        const doc = newOutlineHouse(fp.outline!);
        expect(validateDocument(doc), fp.key).toEqual([]);
        expect(envelope(doc).family, fp.key).toBe(shape);
      }
    }
    // The T has its bar on the street: the living spaces run on to the garden.
    expect(zoneFootprints(program, { hallWidth: 1.2, doorWidth: 0.9, externalThickness: 0.3, shapes: "T" }).length).toBeGreaterThan(0);
  });

  it("split the bedrooms with the master suite apart from the rest", () => {
    const night = nightSpaces(programFromBrief(preset("family-4")));
    const splits = splitNights(night);
    expect(splits.length).toBeGreaterThan(0);
    for (const [suite, rest] of splits) {
      expect(suite.map((s) => s.type)).toContain("primary_bedroom");
      expect(suite.map((s) => s.type)).toContain("ensuite");
      expect(rest.some((s) => s.type === "bedroom")).toBe(true);
      expect([...suite, ...rest].sort((a, b) => a.key.localeCompare(b.key))).toEqual([...night].sort((a, b) => a.key.localeCompare(b.key)));
    }
  });
});

/** A split-bedroom layout: valid, every room reached and lit, two halls each opening off a living space or the front door, the master and the other bedrooms in different wings. */
function checkSplitLayout(doc: PlanDocument, label: string) {
  const lvl = level(doc);
  expect(validateDocument(doc), label).toEqual([]);
  expect(findingsFor(assessSense(lvl), ["reachable", "front_door", "daylight", "wet_room_privacy"]), label).toEqual([]);
  const rooms = Object.values(lvl.rooms);
  const halls = rooms.filter((r) => r.type === "hall");
  expect(halls, label).toHaveLength(2);
  for (const h of halls) {
    const ways = roomConnections(lvl, h.id).filter((c) => c.kind === "door" && (c.target.kind === "outside" || (c.target.kind === "room" && LIVING.has(lvl.rooms[c.target.roomId].type))));
    expect(ways.length, `${label}: a hall reached from the front door or a living space`).toBeGreaterThan(0);
  }
  // The master is off one hall (perhaps with a bedroom beside it as a nursery or study), the other bedrooms off the other.
  const hallOf = (roomId: string) => roomConnections(lvl, roomId).find((c) => c.kind === "door" && c.target.kind === "room" && lvl.rooms[c.target.roomId].type === "hall")?.target;
  const master = rooms.find((r) => r.type === "primary_bedroom")!;
  const others = rooms.filter((r) => r.type === "bedroom");
  const masterHall = hallOf(master.id);
  expect(masterHall, label).toBeDefined();
  expect(others.filter((b) => JSON.stringify(hallOf(b.id)) !== JSON.stringify(masterHall)).length, `${label}: master apart`).toBeGreaterThanOrEqual(Math.min(others.length, 1));
  expect(others.filter((b) => JSON.stringify(hallOf(b.id)) === JSON.stringify(masterHall)).length, `${label}: at most one bedroom beside the master`).toBeLessThanOrEqual(1);
  const gardenDoor = rooms.some((r) => LIVING.has(r.type) && roomConnections(lvl, r.id).some((c) => c.kind === "door" && c.target.kind === "garden"));
  expect(gardenDoor, `${label}: garden doors`).toBe(true);
}
