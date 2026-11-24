import { describe, expect, it } from "vitest";
import { BRIEF_PRESETS, ROOM_PICKS, type RoomPick, type RoomPicks } from "@/domain/brief/rooms";
import { DEFAULT_BRIEF, houseBriefSchema, normaliseBrief, withPicks, type HouseBrief } from "@/domain/brief/schema";
import { roomBounds } from "@/domain/design/analysis";
import { checkPlacements, missNote, placementCost, placementRoom, whereInHouse } from "@/domain/design/placement";
import { pickRoomName, programFromBrief } from "@/domain/design/program";
import { planLayouts } from "@/domain/design/stripPlanner";
import { analyzeEnvelope } from "@/domain/geometry/envelope";
import { assessHouseSense } from "@/domain/design/houseSense";
import { hardCount } from "@/domain/design/sense";
import type { PlanDocument } from "@/domain/plan/types";
import { apply, newHouse } from "../helpers";

const preset = (id: string): HouseBrief => withPicks(DEFAULT_BRIEF, BRIEF_PRESETS.find((p) => p.id === id)!.picks);
const family = preset("family-3");
const picks = family.rooms!;
const auto = (brief: HouseBrief, count = 3) => planLayouts({ intent: { action: "generate_layouts", brief, count, footprint: "auto" }, source: newHouse(), brief, idPrefix: "p" });
const plan = (brief: HouseBrief): PlanDocument =>
  planLayouts({ intent: { action: "generate_layouts", brief, count: 1, footprint: "auto" }, source: newHouse(), brief, idPrefix: "p" }).candidates[0].document;

/** Where a room's middle is, as a placement point. */
function middleOf(doc: PlanDocument, name: string) {
  const level = doc.levels.find((l) => Object.values(l.rooms).some((r) => r.name === name))!;
  const room = Object.values(level.rooms).find((r) => r.name === name)!;
  const b = roomBounds(level, room.id)!;
  const env = analyzeEnvelope(doc.levels[0]);
  if (!env.ok) throw new Error("no envelope");
  const o = env.info.outsideRect;
  // Generated houses have the garden to the north (the larger y).
  return { u: ((b.minX + b.maxX) / 2 - o.minX) / (o.maxX - o.minX), v: ((b.minY + b.maxY) / 2 - o.minY) / (o.maxY - o.minY) };
}

describe("room names", () => {
  it("names every picked room as the program does", () => {
    const every: RoomPicks = { master_bedroom: 1, ensuite: 1, double_bedroom: 2, single_bedroom: 1, family_bathroom: 2, wc: 2, kitchen: 1, dining_room: 1, living_room: 2, utility: 1, office: 2, garage: 1 };
    const named = programFromBrief(withPicks(DEFAULT_BRIEF, every)).spaces.map((s) => s.name).sort();
    const expected = (Object.entries(every) as Array<[RoomPick, number]>)
      .filter(([pick]) => pick !== "ensuite")
      .flatMap(([pick, count]) => Array.from({ length: count }, (_, i) => pickRoomName(pick, i + 1, every)))
      .sort();
    expect(named).toEqual(expected);
    // Open plan and a kitchen with dining are rooms of their own.
    expect(programFromBrief(withPicks(DEFAULT_BRIEF, { open_plan: 1 })).spaces.map((s) => s.name)).toEqual([pickRoomName("open_plan", 1, {})]);
    expect(programFromBrief(withPicks(DEFAULT_BRIEF, { kitchen_dining: 1 })).spaces.map((s) => s.name)).toEqual([pickRoomName("kitchen_dining", 1, {})]);
    for (const pick of ROOM_PICKS) expect(pickRoomName(pick, 1, every)).toBeTruthy();
  });
});

describe("room placements", () => {
  it("costs nothing without placements", () => {
    const doc = plan(family);
    expect(placementCost(doc, undefined, picks)).toBe(0);
    expect(placementCost(doc, {}, picks)).toBe(0);
    expect(checkPlacements(doc, undefined, picks)).toEqual([]);
  });

  it("finds the room a placement names, falling back to a merged room", () => {
    const doc = plan(family);
    expect(placementRoom("master_bedroom#1", doc, picks).roomId).not.toBeNull();
    expect(placementRoom("double_bedroom#1", doc, picks).name).toBe("Bedroom 2");
    // A kitchen combined into a kitchen/dining room (or open plan) is still found.
    expect(placementRoom("kitchen#1", doc, { kitchen: 1 })).toMatchObject({ name: "Kitchen / Dining" });
    const open = plan(preset("starter"));
    expect(placementRoom("kitchen#1", open, { kitchen: 1 })).toMatchObject({ name: "Kitchen / Living / Dining" });
    expect(placementRoom("living_room#1", open, { living_room: 1 })).toMatchObject({ name: "Kitchen / Living / Dining" });
    expect(placementRoom("garage#1", doc, picks)).toMatchObject({ roomId: null });
  });

  it("is honoured in the room, and costs more the further the point is from it", () => {
    const doc = plan(family);
    const at = middleOf(doc, "Master Bedroom");
    const here = { "master_bedroom#1": at };
    expect(placementCost(doc, here, picks)).toBe(0);
    expect(checkPlacements(doc, here, picks)[0].honoured).toBe(true);
    const near = { "master_bedroom#1": { u: Math.min(1, Math.max(0, at.u + 0.3)), v: Math.min(1, Math.max(0, at.v)) } };
    const far = { "master_bedroom#1": { u: at.u < 0.5 ? 1 : 0, v: at.v < 0.5 ? 1 : 0 } };
    expect(placementCost(doc, far, picks)).toBeGreaterThan(placementCost(doc, near, picks));
    const miss = checkPlacements(doc, far, picks)[0];
    expect(miss.honoured).toBe(false);
    expect(missNote(miss)).toMatch(/^Master Bedroom is at the .+, not the .+ where you placed it\.$/);
  });

  it("measures from the street to the garden whichever side the garden is", () => {
    const doc = plan(family);
    const at = middleOf(doc, "Master Bedroom");
    const env = analyzeEnvelope(doc.levels[0]);
    if (!env.ok) throw new Error("no envelope");
    // The same house with the garden on the other side turns the frame half round.
    const turned = apply(doc, { type: "setRearWall", wallId: env.info.wallsFacing.south[0] });
    const flipped = { "master_bedroom#1": { u: 1 - at.u, v: 1 - at.v } };
    expect(placementCost(turned, flipped, picks)).toBe(0);
    expect(placementCost(turned, { "master_bedroom#1": at }, picks)).toBeGreaterThan(0);
  });

  it("names a point by its third of the house", () => {
    expect(whereInHouse(0.1, 0.9)).toBe("back left");
    expect(whereInHouse(0.5, 0.5)).toBe("middle");
    expect(whereInHouse(0.9, 0.5)).toBe("middle right");
    expect(whereInHouse(0.5, 0.1)).toBe("front");
  });

  it("keeps placements only for rooms still picked", () => {
    const placed = { ...family, placements: { "double_bedroom#2": { u: 0.2, v: 0.8 }, "master_bedroom#1": { u: 0.8, v: 0.9 } } };
    const fewer = withPicks(placed, { ...picks, double_bedroom: 1 });
    expect(fewer.placements).toEqual({ "master_bedroom#1": { u: 0.8, v: 0.9 } });
    expect(withPicks(placed, { ...picks, double_bedroom: 1, master_bedroom: 0 }).placements).toBeUndefined();
    expect(normaliseBrief(placed).placements).toEqual(placed.placements);
    // A brief without picked rooms has nothing to place.
    const { rooms: _rooms, ...counts } = placed;
    void _rooms;
    expect(normaliseBrief(counts).placements).toBeUndefined();
    expect(houseBriefSchema.safeParse({ ...family, placements: { "sofa#1": { u: 0, v: 0 } } }).success).toBe(false);
    expect(houseBriefSchema.safeParse({ ...family, placements: { "wc#1": { u: 2, v: 0 } } }).success).toBe(false);
  });

  it("leads with a layout that puts a placed room where it was placed, no worse for it", () => {
    // The master at either back corner; at the front, where these layouts never put a master with its ensuite, only if one does.
    const corners = [
      { at: { u: 0.85, v: 0.85 }, reachable: true },
      { at: { u: 0.15, v: 0.85 }, reachable: true },
      { at: { u: 0.15, v: 0.15 }, reachable: false },
    ];
    for (const { at, reachable } of corners) {
      const placed = { ...family, placements: { "master_bedroom#1": at } };
      const plain = auto(family);
      const result = auto(placed);
      const top = result.candidates[0].document;
      const check = checkPlacements(top, placed.placements, picks)[0];
      const any = reachable || result.candidates.some((c) => checkPlacements(c.document, placed.placements, picks)[0].honoured);
      if (any) expect(check.honoured, `${whereInHouse(at.u, at.v)}: ${check.at}`).toBe(true);
      else expect(missNote(check), whereInHouse(at.u, at.v)).toMatch(/where you placed it/);
      // Never a plan that breaks more hard rules than the best without the placement.
      expect(hardCount(assessHouseSense(top).findings)).toBeLessThanOrEqual(Math.min(...plain.candidates.map((c) => hardCount(assessHouseSense(c.document).findings))));
    }
  });

  it("shows the same top layout in the live preview as among the layouts", () => {
    const placed = { ...family, placements: { "master_bedroom#1": { u: 0.85, v: 0.85 }, "kitchen_dining#1": { u: 0.15, v: 0.85 } } };
    const preview = auto(placed, 1).candidates[0];
    const honoured = (doc: PlanDocument) => checkPlacements(doc, placed.placements, picks).every((c) => c.honoured);
    const three = auto(placed, 3).candidates;
    // Where any layout honours both, the preview does too.
    if (three.some((c) => honoured(c.document))) expect(honoured(preview.document)).toBe(true);
  });

  it("plans the live preview with placements quickly", () => {
    const placed = { ...family, placements: { "master_bedroom#1": { u: 0.85, v: 0.85 } } };
    auto(placed, 1);
    const times: number[] = [];
    for (let i = 0; i < 7; i++) {
      const t = performance.now();
      auto(placed, 1);
      times.push(performance.now() - t);
    }
    times.sort((a, b) => a - b);
    // The budget is 80 ms; three times that so shared machines don't flake.
    expect(times[times.length - 2]).toBeLessThan(240);
  });
});
