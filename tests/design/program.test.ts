import { describe, expect, it } from "vitest";
import { DEFAULT_BRIEF, houseBriefSchema, normaliseBrief, type HouseBrief } from "@/domain/brief/schema";
import { programFromBrief } from "@/domain/design/program";

const target = (brief: HouseBrief, type: string) => programFromBrief(brief).spaces.find((s) => s.type === type)?.target;

describe("brief room sizes", () => {
  it("scales the program's target areas", () => {
    const generous: HouseBrief = { ...DEFAULT_BRIEF, roomSizes: { bedrooms: "generous", living: "compact" } };
    expect(target(generous, "primary_bedroom")).toBeGreaterThan(target(DEFAULT_BRIEF, "primary_bedroom")!);
    expect(target(generous, "bedroom")).toBeGreaterThan(target(DEFAULT_BRIEF, "bedroom")!);
    expect(target(generous, "living")).toBeLessThan(target(DEFAULT_BRIEF, "living")!);
    expect(target(generous, "kitchen")).toBe(target(DEFAULT_BRIEF, "kitchen"));
  });

  it("treats briefs saved before sizes existed as standard", () => {
    const legacy: Omit<HouseBrief, "roomSizes"> = { ...DEFAULT_BRIEF };
    expect(houseBriefSchema.safeParse(legacy).success).toBe(true);
    expect(programFromBrief(legacy as HouseBrief)).toEqual(programFromBrief(DEFAULT_BRIEF));
  });

  it("leaves standard sizes out of the canonical brief", () => {
    expect(normaliseBrief({ ...DEFAULT_BRIEF, roomSizes: { kitchen: "standard" } })).toEqual(normaliseBrief(DEFAULT_BRIEF));
    expect(normaliseBrief({ ...DEFAULT_BRIEF, roomSizes: { kitchen: "generous", living: "standard" } }).roomSizes).toEqual({ kitchen: "generous" });
  });
});
