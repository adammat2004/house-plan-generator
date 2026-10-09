import { describe, expect, it } from "vitest";
import { picksFromCounts } from "@/domain/brief/rooms";
import { DEFAULT_BRIEF, withPicks, type HouseBrief } from "@/domain/brief/schema";
import { programFromBrief } from "@/domain/design/program";
import { OPEN_PLAN_MIN_SLOT, ROOM_KINDS, ROOM_RULES, SLOT_WALL } from "@/domain/design/roomRules";
import { ROOM_TYPES } from "@/domain/plan/schema";

const withoutKeys = (brief: HouseBrief) => programFromBrief(brief).spaces.map((s) => ({ ...s, key: "" }));

describe("room rules", () => {
  it("cover every room type", () => {
    for (const type of ROOM_TYPES) expect(ROOM_RULES[type], type).toBeDefined();
  });

  it("never let a program slot be narrower than its room type works at", () => {
    for (const [kind, { type, minSlot }] of Object.entries(ROOM_KINDS)) {
      expect(minSlot, kind).toBeGreaterThanOrEqual(ROOM_RULES[type].minWidth + SLOT_WALL - 1e-9);
    }
    expect(OPEN_PLAN_MIN_SLOT).toBeGreaterThanOrEqual(ROOM_RULES.kitchen_dining.minWidth + SLOT_WALL);
  });

  it("give every program space its type's zone and window", () => {
    for (const space of programFromBrief({ ...DEFAULT_BRIEF, requiredSpaces: ["kitchen", "living", "dining", "office", "utility", "garage"] }).spaces) {
      expect(space.zone, space.name).toBe(ROOM_RULES[space.type].zone);
      expect(space.window, space.name).toBe(ROOM_RULES[space.type].window);
    }
  });
});

describe("one program for counts and picks", () => {
  const briefs: HouseBrief[] = [
    DEFAULT_BRIEF,
    { ...DEFAULT_BRIEF, bedrooms: 4, bathrooms: 3, requiredSpaces: ["kitchen", "living", "dining", "office", "utility", "garage"] },
    { ...DEFAULT_BRIEF, bedrooms: 1, bathrooms: 1, requiredSpaces: ["kitchen", "living"], preferences: ["open_plan"] },
    { ...DEFAULT_BRIEF, bedrooms: 2, bathrooms: 2, preferences: ["home_office", "large_kitchen"], roomSizes: { bedrooms: "generous" } },
  ];

  it("reads a counts-only brief as the picks it implies", () => {
    for (const brief of briefs) {
      const open = brief.preferences.includes("open_plan") && !brief.preferences.includes("separate_living_room");
      const spaces = brief.preferences.includes("home_office") ? [...brief.requiredSpaces, "office" as const] : brief.requiredSpaces;
      const picked = withPicks(brief, picksFromCounts(brief.bedrooms, brief.bathrooms, spaces, open));
      expect(withoutKeys(brief), JSON.stringify(brief)).toEqual(withoutKeys(picked));
    }
  });

  it("names the primary bedroom the same way whichever brief it comes from", () => {
    const counts = programFromBrief(DEFAULT_BRIEF).spaces.find((s) => s.type === "primary_bedroom");
    const picks = programFromBrief(withPicks(DEFAULT_BRIEF, { master_bedroom: 1, ensuite: 1 })).spaces.find((s) => s.type === "primary_bedroom");
    expect(counts?.name).toBe(picks?.name);
  });
});
