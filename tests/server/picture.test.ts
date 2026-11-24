import Anthropic from "@anthropic-ai/sdk";
import { describe, expect, it } from "vitest";
import { DEFAULT_BRIEF, withPicks } from "@/domain/brief/schema";
import { ROOM_PICKS } from "@/domain/brief/rooms";
import { briefFromPicture, pictureRequestSchema, type PictureReply, type PictureRequest } from "@/domain/design/pictureReading";
import { MODEL, type ClaudeClient } from "@/server/designInterpreter";
import { readPicture } from "@/server/pictureReader";

const none = Object.fromEntries(ROOM_PICKS.map((p) => [p, null])) as PictureReply["rooms"];
const plan = (rooms: Partial<PictureReply["rooms"]>, extra: Partial<PictureReply> = {}): PictureReply => ({
  reply: "A three-bed bungalow.",
  rooms: { ...Object.fromEntries(ROOM_PICKS.map((p) => [p, 0])), ...rooms } as PictureReply["rooms"],
  houseShape: "L",
  storeys: 1,
  notes: [],
  ...extra,
});

const IMAGE = "A".repeat(400);
const request = (kind: PictureRequest["kind"] = "floor_plan"): PictureRequest => ({ kind, mediaType: "image/jpeg", image: IMAGE, rooms: {} });

function stub(answer: () => unknown) {
  const calls: Array<Record<string, unknown>> = [];
  const client = { beta: { messages: { parse: async (params: Record<string, unknown>) => (calls.push(params), answer()) } } } as unknown as ClaudeClient;
  return { client, calls };
}

describe("reading a picture into the brief", () => {
  it("takes a floor plan's rooms, shape and storeys", () => {
    const next = briefFromPicture(DEFAULT_BRIEF, plan({ master_bedroom: 1, ensuite: 1, double_bedroom: 2, family_bathroom: 1, open_plan: 1, utility: 1 }));
    expect(next.rooms).toEqual({ master_bedroom: 1, ensuite: 1, double_bedroom: 2, family_bathroom: 1, open_plan: 1, utility: 1 });
    expect(next.bedrooms).toBe(3);
    expect(next.houseShape).toBe("L");
    expect(next.storeys).toBe(1);
  });

  it("keeps the rooms for inspiration, and adds its notes to the brief", () => {
    const start = { ...withPicks(DEFAULT_BRIEF, { master_bedroom: 1, double_bedroom: 1, open_plan: 1, family_bathroom: 1 }), additionalInstructions: "A boot room" };
    const next = briefFromPicture(start, { reply: "", rooms: none, houseShape: null, storeys: 2, notes: ["Dark timber cladding", " "] });
    expect(next.rooms).toEqual(start.rooms);
    expect(next.storeys).toBe(2);
    expect(next.additionalInstructions).toBe("A boot room\nDark timber cladding");
  });

  it("keeps counts within the brief's limits, and an ensuite only with a master", () => {
    const next = briefFromPicture(DEFAULT_BRIEF, plan({ double_bedroom: 30, ensuite: 1, family_bathroom: 1, kitchen: 1 }));
    expect(next.rooms?.double_bedroom).toBe(7);
    expect(next.rooms?.ensuite).toBeUndefined();
    // A third storey isn't something a brief can hold.
    expect(briefFromPicture(DEFAULT_BRIEF, plan({}, { storeys: 3 })).storeys).toBe(DEFAULT_BRIEF.storeys);
  });

  it("checks the request: kind, a picture type and a size limit", () => {
    expect(pictureRequestSchema.safeParse(request()).success).toBe(true);
    expect(pictureRequestSchema.safeParse({ ...request(), mediaType: "image/gif" }).success).toBe(false);
    expect(pictureRequestSchema.safeParse({ ...request(), image: "A".repeat(3_000_000) }).success).toBe(false);
  });

  it("sends the picture to Claude with the kind, and returns the parsed reply", async () => {
    const reply = plan({ master_bedroom: 1 });
    const { client, calls } = stub(() => ({ stop_reason: "end_turn", parsed_output: reply, model: MODEL }));
    const result = await readPicture(request("floor_plan"), client);
    expect(result).toEqual({ ok: true, reply, model: MODEL });
    const params = calls[0] as { model: string; messages: Array<{ content: Array<{ type: string; source?: { data: string }; text?: string }> }> };
    expect(params.model).toBe(MODEL);
    expect(params.messages[0].content[0]).toMatchObject({ type: "image", source: { data: IMAGE } });
    expect(params.messages[0].content[1].text).toContain("floor_plan");
  });

  it("says plainly when Claude declines, runs out, or isn't reachable", async () => {
    expect(await readPicture(request(), stub(() => ({ stop_reason: "refusal", parsed_output: null })).client)).toMatchObject({ ok: false, status: 422 });
    expect(await readPicture(request(), stub(() => ({ stop_reason: "max_tokens", parsed_output: null })).client)).toMatchObject({ ok: false, status: 502 });
    const timeout = stub(() => Promise.reject(new Anthropic.APIConnectionTimeoutError())).client;
    expect(await readPicture(request(), timeout)).toMatchObject({ ok: false, status: 504 });
  });
});
