import { describe, expect, it } from "vitest";
import { BRIEF_PRESETS } from "@/domain/brief/rooms";
import { DEFAULT_BRIEF, withPicks, type HouseBrief } from "@/domain/brief/schema";
import { validateDocument } from "@/domain/commands";
import { roomBounds, roomConnections, roomRegion } from "@/domain/design/analysis";
import { programFromBrief } from "@/domain/design/program";
import { assessSense } from "@/domain/design/sense";
import { planLayouts } from "@/domain/design/stripPlanner";
import { isZoneLayout } from "@/domain/design/zoneLayouts";
import { planZones, zoneFootprints } from "@/domain/design/zonePlanner";
import type { PlanDocument } from "@/domain/plan/types";
import { apply, envelope, level, newHouse } from "../helpers";

const preset = (id: string): HouseBrief => withPicks(DEFAULT_BRIEF, BRIEF_PRESETS.find((p) => p.id === id)!.picks);
const auto = (brief: HouseBrief, count = 3) => planLayouts({ intent: { action: "generate_layouts", brief, count, footprint: "auto" }, source: newHouse(), brief, idPrefix: "z" });
const LIVING = new Set(["living", "kitchen", "kitchen_dining", "dining"]);

/** What every zone layout must be: valid, sensible, entered from the street, with garden doors from a living space. */
function checkZoneLayout(doc: PlanDocument, label: string) {
  const lvl = level(doc);
  expect(validateDocument(doc), label).toEqual([]);
  expect(assessSense(lvl).findings.map((f) => f.message), label).toEqual([]);
  const hall = Object.values(lvl.rooms).find((r) => r.type === "hall")!;
  expect(roomConnections(lvl, hall.id).some((c) => c.kind === "door" && c.target.kind === "outside" && c.side === "south"), `${label}: front door`).toBe(true);
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
      checkZoneLayout(first.document, p.id);
    }
  });

  it("offer houses of different sizes", () => {
    const sizes = auto(preset("family-3")).candidates.map((c) => `${c.footprint?.width}x${c.footprint?.depth}`);
    expect(new Set(sizes).size).toBe(3);
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

  it("plan a live preview quickly", () => {
    const brief = preset("family-4");
    auto(brief, 1);
    const started = performance.now();
    auto(brief, 1);
    // A loose bound (three times the 60 ms budget) so shared CI machines don't flake.
    expect(performance.now() - started).toBeLessThan(180);
  });
});
