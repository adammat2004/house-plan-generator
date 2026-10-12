import { describe, expect, it } from "vitest";
import { scaleBarLength } from "@/editor/rendering/presentation";

describe("the presentation image's scale bar", () => {
  it("picks a round length near the size asked for", () => {
    // 50 px a metre: 200 px is 4 m, nearest 5.
    expect(scaleBarLength(1 / 50, 200)).toBe(5);
    // 10 px a metre: 200 px is 20 m.
    expect(scaleBarLength(1 / 10, 200)).toBe(20);
    // Very close in, a metre; very far out, a hundred.
    expect(scaleBarLength(1 / 1000, 200)).toBe(1);
    expect(scaleBarLength(1, 200)).toBe(100);
  });
});
