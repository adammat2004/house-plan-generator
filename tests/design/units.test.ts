import { describe, expect, it } from "vitest";
import { areaText, showsSquareFeet } from "@/domain/geometry/units";

describe("area units", () => {
  it("shows square feet alongside m², grouped and whole", () => {
    expect(areaText(152, { sqft: true })).toBe("152 m² · 1,636 sq ft");
    expect(areaText(152)).toBe("152 m²");
    expect(areaText(12.345, { digits: 1 })).toBe("12.3 m²");
    expect(areaText(1200, { sqft: true })).toBe("1,200 m² · 12,917 sq ft");
  });

  it("uses square feet for UK browsers unless the setting says otherwise", () => {
    expect(showsSquareFeet("auto", "en-GB")).toBe(true);
    expect(showsSquareFeet("auto", "en-IE")).toBe(false);
    expect(showsSquareFeet("auto", "en-US")).toBe(false);
    expect(showsSquareFeet("auto", undefined)).toBe(false);
    expect(showsSquareFeet("metric", "en-GB")).toBe(false);
    expect(showsSquareFeet("both", "fr-FR")).toBe(true);
  });
});
