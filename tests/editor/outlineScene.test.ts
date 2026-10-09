import { describe, expect, it } from "vitest";
import { renderKey, renderPrompt, renderRequestSchema, renderViewFor } from "@/domain/design/renderRequest";
import { DEFAULT_APPEARANCE } from "@/domain/project/schema";
import { buildDimensions, buildPlanScene } from "@/editor/rendering/scene/planScene";
import { OUTLINES } from "../fixtures/outlines";
import { apply, level, newHouse, newOutlineHouse } from "../helpers";

describe("drawing an outline other than a rectangle", () => {
  it("measures every outside face besides the overall width and depth", () => {
    const lvl = level(newOutlineHouse(OUTLINES.L));
    const dims = buildDimensions(lvl, null);
    expect(dims.filter((d) => d.key.startsWith("overall")).map((d) => d.text)).toEqual(["12.000 m", "11.000 m"]);
    // Six faces; the west one is the overall depth already.
    expect(dims.filter((d) => d.key.startsWith("outline")).map((d) => d.text)).toEqual(["12.000 m", "5.500 m", "6.500 m", "5.500 m", "5.500 m"]);
    // A rectangle keeps just its two overall dimensions.
    expect(buildDimensions(level(newHouse()), null)).toHaveLength(2);
  });

  it("gives the scene the outline for shadows", () => {
    expect(buildPlanScene(level(newOutlineHouse(OUTLINES.U))).outsideRing).toEqual(OUTLINES.U);
  });

  it("keys exterior photos on the outline and names the shape in the prompt", () => {
    const doc = newOutlineHouse(OUTLINES.L);
    const key = renderKey(level(doc), { kind: "exterior" }, DEFAULT_APPEARANCE, "warm_minimal");
    const deeper = apply(doc, { type: "resizeFootprint", depth: 12 });
    expect(renderKey(level(deeper), { kind: "exterior" }, DEFAULT_APPEARANCE, "warm_minimal")).not.toBe(key);
    const view = renderViewFor(level(doc), { kind: "exterior" }, DEFAULT_APPEARANCE)!;
    expect(view).toMatchObject({ kind: "exterior", shape: "L" });
    expect(renderRequestSchema.shape.view.safeParse(view).success).toBe(true);
    expect(renderPrompt(view, "modern")).toMatch(/photograph of an L-shaped single-storey house/);
    const rect = renderViewFor(level(newHouse()), { kind: "exterior" }, DEFAULT_APPEARANCE)!;
    expect(rect).not.toHaveProperty("shape");
    expect(renderPrompt(rect, "modern")).toMatch(/photograph of a single-storey house/);
  });
});
