import { describe, expect, it } from "vitest";
import { BRIEF_PRESETS, cleanPicks, picksFromCounts, type RoomPicks } from "@/domain/brief/rooms";
import { DEFAULT_BRIEF, normaliseBrief, withPicks } from "@/domain/brief/schema";
import { validateDocument } from "@/domain/commands";
import { interpretationFromReply, type AiReply } from "@/domain/design/aiInterpretation";
import { programFromBrief } from "@/domain/design/program";
import { planLayouts } from "@/domain/design/stripPlanner";
import { level, newHouse } from "../helpers";

const brief = (picks: RoomPicks) => withPicks(DEFAULT_BRIEF, picks);
const types = (picks: RoomPicks) => programFromBrief(brief(picks)).spaces.map((s) => s.type).sort();

describe("room picks", () => {
  it("set the brief's counts and spaces", () => {
    const b = brief({ master_bedroom: 1, double_bedroom: 2, single_bedroom: 1, ensuite: 1, family_bathroom: 1, wc: 1, open_plan: 1, office: 1 });
    expect(b).toMatchObject({ bedrooms: 4, bathrooms: 3, requiredSpaces: ["kitchen", "living", "dining", "office"] });
    expect(normaliseBrief(b)).toEqual(b);
  });

  it("need a master bedroom for an ensuite, and stay within each room's limit", () => {
    expect(cleanPicks({ ensuite: 1, double_bedroom: 12 })).toEqual({ double_bedroom: 7 });
  });

  it("follow counts and spaces changed another way, as the AI reader does", () => {
    const b = brief({ master_bedroom: 1, double_bedroom: 1, family_bathroom: 1, open_plan: 1 });
    expect(normaliseBrief({ ...b, bedrooms: 3 }).rooms).toMatchObject({ master_bedroom: 1, double_bedroom: 2 });
    expect(normaliseBrief({ ...b, requiredSpaces: [...b.requiredSpaces, "utility"] }).rooms).toMatchObject({ utility: 1 });
    // Taking dining out of an open plan splits it into what's still wanted.
    const noDining = normaliseBrief({ ...b, requiredSpaces: ["kitchen", "living"] }).rooms!;
    expect(noDining.open_plan).toBeUndefined();
    expect(noDining).toMatchObject({ kitchen: 1, living_room: 1 });
    const reply: AiReply = {
      reply: "",
      roomChanges: [],
      brief: { bedrooms: null, bathrooms: 2, addSpaces: ["office"], removeSpaces: [], addPreferences: [], removePreferences: [], roomSizes: [], houseShape: null, storeys: null },
      unclear: [],
    };
    let next = b;
    for (const step of interpretationFromReply(reply, null, b, "request").steps) if (step.kind === "brief") next = normaliseBrief({ ...next, ...step.patch });
    expect(next.rooms).toMatchObject({ family_bathroom: 2, office: 1 });
  });

  it("come from an older brief's counts", () => {
    expect(picksFromCounts(3, 2, ["kitchen", "living", "dining"], false)).toEqual({ master_bedroom: 1, double_bedroom: 2, ensuite: 1, family_bathroom: 1, kitchen_dining: 1, living_room: 1 });
    expect(picksFromCounts(2, 1, ["kitchen", "living", "dining"], true)).toMatchObject({ open_plan: 1, family_bathroom: 1 });
  });

  it("are laid out exactly: single bedrooms smaller, the ensuite with the master bedroom", () => {
    expect(types({ master_bedroom: 1, double_bedroom: 1, single_bedroom: 2, ensuite: 1, family_bathroom: 1, wc: 1, open_plan: 1, office: 2 })).toEqual(
      ["bathroom", "bedroom", "bedroom", "bedroom", "kitchen_dining", "office", "office", "primary_bedroom", "wc"].sort(),
    );
    const spaces = programFromBrief(brief({ double_bedroom: 1, single_bedroom: 1 })).spaces;
    expect(spaces[1].target).toBeLessThan(spaces[0].target);
    expect(programFromBrief(brief({ master_bedroom: 1, ensuite: 1 })).spaces.find((s) => s.type === "primary_bedroom")!.ensuite).toBe(true);
    // To fit, separate kitchen and dining combine, then the living room joins them.
    const separate = brief({ double_bedroom: 1, kitchen: 1, dining_room: 1, living_room: 1 });
    expect(programFromBrief(separate, 1).spaces.map((s) => s.type)).toContain("kitchen_dining");
    expect(programFromBrief(separate, 2).spaces.filter((s) => s.type === "living")).toHaveLength(0);
  });

  it("every preset generates valid layouts sized from its rooms", () => {
    for (const preset of BRIEF_PRESETS) {
      const b = brief(preset.picks);
      const result = planLayouts({ intent: { action: "generate_layouts", brief: b, count: 2, footprint: "auto" }, source: newHouse(), brief: b, idPrefix: preset.id });
      expect(result.candidates.length, preset.id).toBe(2);
      for (const c of result.candidates) {
        expect(validateDocument(c.document)).toEqual([]);
        const rooms = Object.values(level(c.document).rooms);
        expect(rooms.filter((r) => r.type === "bedroom" || r.type === "primary_bedroom")).toHaveLength(b.bedrooms);
        // Every room starts with a sensible floor finish.
        expect(rooms.every((r) => r.floorMaterial)).toBe(true);
      }
    }
  });
});
