import { describe, expect, it } from "vitest";
import { photoTargets, renderKey, renderPrompt, renderRequestSchema, renderViewFor } from "@/domain/design/renderRequest";
import { DEFAULT_APPEARANCE } from "@/domain/project/schema";
import { apply, newHouse } from "../helpers";

const doc = () => {
  let d = apply(newHouse(), { type: "addLevel" });
  const [ground, first] = d.levels.map((l) => Object.values(l.rooms)[0]);
  d = apply(d, { type: "updateRoom", roomId: ground.id, changes: { type: "living" } });
  d = apply(d, { type: "updateRoom", roomId: first.id, changes: { type: "bedroom" } });
  return d;
};

describe("photos of a house of several floors", () => {
  it("says how many storeys the house has", () => {
    const view = renderViewFor(doc(), { kind: "exterior" }, DEFAULT_APPEARANCE)!;
    expect(view).toMatchObject({ kind: "exterior", storeys: 2 });
    expect(renderPrompt(view, "modern")).toMatch(/of a two-storey house seen from its garden/);
    expect(renderRequestSchema.shape.view.safeParse(view).success).toBe(true);
    const aerial = renderViewFor(doc(), { kind: "aerial" }, DEFAULT_APPEARANCE)!;
    expect(renderPrompt(aerial, "modern")).toMatch(/furnished two-storey home/);
    // A bungalow's prompt is as it was.
    expect(renderPrompt(renderViewFor(newHouse().levels[0], { kind: "exterior" }, DEFAULT_APPEARANCE)!, "modern")).toMatch(/a single-storey house/);
  });

  it("offers rooms on every floor, keyed by their own floor", () => {
    const d = doc();
    const upstairs = Object.values(d.levels[1].rooms)[0];
    expect(photoTargets(d).map((t) => (t.kind === "room" ? d.levels.findIndex((l) => t.roomId in l.rooms) : t.kind))).toEqual(["exterior", 0, 1]);
    const target = { kind: "room" as const, roomId: upstairs.id };
    expect(renderKey(d, target, DEFAULT_APPEARANCE, "modern")).toBe(renderKey(d.levels[1], target, DEFAULT_APPEARANCE, "modern"));
    expect(renderKey(d, { kind: "exterior" }, DEFAULT_APPEARANCE, "modern")).not.toBe(renderKey(d.levels[0], { kind: "exterior" }, DEFAULT_APPEARANCE, "modern"));
    expect(renderViewFor(d, target, DEFAULT_APPEARANCE)).toMatchObject({ kind: "room", roomType: "bedroom" });
  });
});
