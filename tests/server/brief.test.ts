import { describe, expect, it, vi } from "vitest";
import { briefFromFields, fieldsOfBrief, type PromptReply } from "@/domain/brief/fromPrompt";
import { houseBriefSchema } from "@/domain/brief/schema";
import { programFromBrief, targetAreaFit } from "@/domain/design/program";
import type { ClaudeClient } from "@/server/designInterpreter";
import { interpretBrief } from "@/server/briefInterpreter";

vi.mock("next/server", () => ({ connection: async () => undefined }));

const reply = (over: Partial<PromptReply> = {}): PromptReply => ({
  reply: "A four-bedroom family home.",
  bedrooms: 4,
  bathrooms: 2,
  spaces: ["kitchen", "living", "dining"],
  preferences: ["open_plan", "home_office"],
  roomSizes: { living: null, kitchen: null, bedrooms: null },
  houseShape: null,
  storeys: 1,
  targetArea: 200,
  unclear: [],
  ...over,
});

/** A stand-in for the SDK that answers with the given parsed reply and records the request. */
function claudeAnswering(parsed: PromptReply | null, stop_reason = "end_turn") {
  const parse = vi.fn(async () => ({ stop_reason, parsed_output: parsed, model: "test-model" }));
  return { client: { beta: { messages: { parse } } } as unknown as ClaudeClient, parse };
}

const area = (spaces: { target: number }[]) => spaces.reduce((sum, s) => sum + s.target, 0);

describe("describe your home → brief", () => {
  it("turns a description into a valid brief with a target area", async () => {
    const { client, parse } = claudeAnswering(reply());
    const result = await interpretBrief("4 bed family home, open-plan kitchen, home office, about 200 m², single storey", client);
    if (!result.ok) throw new Error(result.message);
    expect(houseBriefSchema.safeParse(result.brief).success).toBe(true);
    expect(result.brief).toMatchObject({ bedrooms: 4, bathrooms: 2, targetArea: 200 });
    expect(result.brief.requiredSpaces).toContain("office");
    expect(result.brief.preferences).toEqual(expect.arrayContaining(["open_plan", "home_office"]));
    expect(result.brief.storeys).toBeUndefined();
    expect(result.brief.rooms).toMatchObject({ master_bedroom: 1, double_bedroom: 3, open_plan: 1, office: 1 });
    expect(result.reply).toBe("A four-bedroom family home.");
    // The user's words reach the model, which is given no plan or geometry.
    const request = parse.mock.calls[0] as unknown as [{ messages: { content: string }[] }];
    expect(request[0].messages[0].content).toContain("about 200 m²");
  });

  it("clamps counts, rejects a silly area and reports what the brief can't hold", async () => {
    const { client } = claudeAnswering(reply({ bedrooms: 12, targetArea: 5000, storeys: 3, unclear: ["a swimming pool"] }));
    const result = await interpretBrief("a mansion with a pool", client);
    if (!result.ok) throw new Error(result.message);
    expect(result.brief.bedrooms).toBe(8);
    expect(result.brief.targetArea).toBeUndefined();
    expect(result.brief.storeys).toBe(2);
    expect(result.notes.join("\n")).toMatch(/swimming pool/);
    expect(result.notes.join("\n")).toMatch(/5000 m²/);
    expect(result.notes.join("\n")).toMatch(/Three or more storeys/);
  });

  it("says plainly when the target area can't be met", async () => {
    const { client } = claudeAnswering(reply({ bedrooms: 2, bathrooms: 1, preferences: [], targetArea: 400 }));
    const result = await interpretBrief("a 2 bed home of 400 m²", client);
    if (!result.ok) throw new Error(result.message);
    expect(result.brief.targetArea).toBe(400);
    const fit = targetAreaFit(result.brief)!;
    expect(fit.met).toBe(false);
    expect(fit.message).toMatch(/400 m² can't be reached/);
    expect(result.notes).toContain(fit.message);
  });

  it("reports a refusal, an empty answer and no key without calling Claude", async () => {
    const refused = await interpretBrief("x y z", claudeAnswering(null, "refusal").client);
    expect(refused).toMatchObject({ ok: false, status: 422 });
    const empty = await interpretBrief("x y z", claudeAnswering(null).client);
    expect(empty).toMatchObject({ ok: false, status: 502 });
    const saved = process.env.ANTHROPIC_API_KEY;
    delete process.env.ANTHROPIC_API_KEY;
    try {
      expect(await interpretBrief("a house")).toMatchObject({ ok: false, status: 503 });
    } finally {
      if (saved !== undefined) process.env.ANTHROPIC_API_KEY = saved;
    }
  });
});

describe("target area in the planner", () => {
  const fields = { bedrooms: 3, bathrooms: 2, spaces: ["kitchen", "living", "dining"] as const, preferences: [] as never[], houseShape: "any" as const };

  it("scales rooms toward a reachable target", () => {
    const plain = briefFromFields(fields);
    const base = programFromBrief(plain);
    const bigger = programFromBrief(briefFromFields({ ...fields, targetArea: Math.round(targetAreaFit({ ...plain, targetArea: 100 })!.range.max * 0.9) }));
    expect(area(bigger.spaces)).toBeGreaterThan(area(base.spaces));
    expect(bigger.notes.join(" ")).toMatch(/sized to make a house of about/);
  });

  it("stops at sensible room sizes and says so", () => {
    const small = programFromBrief(briefFromFields({ ...fields, targetArea: 40 }));
    const base = programFromBrief(briefFromFields(fields));
    expect(area(small.spaces)).toBeGreaterThanOrEqual(area(base.spaces) * 0.84);
    expect(small.notes.join(" ")).toMatch(/can't be reached/);
  });

  it("leaves a brief without a target untouched, and round-trips through fields", () => {
    const brief = briefFromFields({ ...fields, targetArea: 150, storeys: 2 });
    expect(briefFromFields(fieldsOfBrief(brief))).toEqual(brief);
    expect(targetAreaFit(briefFromFields(fields))).toBeNull();
    expect(programFromBrief(briefFromFields(fields)).notes).toEqual([]);
  });
});
