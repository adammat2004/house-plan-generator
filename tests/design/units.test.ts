import { describe, expect, it } from "vitest";
import { areaText, feetInches, lengthText, M_PER_FT, parseLength, showsSquareFeet, sizeText } from "@/domain/geometry/units";

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

describe("imperial lengths", () => {
  it("writes lengths in feet and inches to the nearest inch", () => {
    expect(feetInches(3.81)).toBe("12′ 6″");
    expect(feetInches(M_PER_FT)).toBe("1′ 0″");
    expect(feetInches(0.1)).toBe("4″");
    // 11 ft 11.6 in rounds up to a whole foot, not "11′ 12″".
    expect(feetInches((12 * 12 - 0.4) * (M_PER_FT / 12))).toBe("12′ 0″");
    expect(lengthText(3.6)).toBe("3.60 m");
    expect(lengthText(3.6, { imperial: true })).toBe("11′ 10″");
    expect(sizeText(3.6, 6.53)).toBe("3.60 × 6.53 m");
    expect(sizeText(3.6, 6.53, { imperial: true })).toBe("11′ 10″ × 21′ 5″");
    expect(areaText(152, { imperial: true })).toBe("1,636 sq ft");
  });

  it("reads typed lengths in feet and inches or metric", () => {
    const ft = (f: number, i = 0) => (f * 12 + i) * (M_PER_FT / 12);
    for (const [text, m] of [
      [`12'6"`, ft(12, 6)],
      ["12′ 6″", ft(12, 6)],
      ["12 ft 6 in", ft(12, 6)],
      ["12'6", ft(12, 6)],
      ["12.5'", ft(12.5)],
      ['150"', ft(0, 150)],
      ["3.2 m", 3.2],
      ["3200mm", 3.2],
      ["320 cm", 3.2],
    ] as const) {
      expect(parseLength(text)).toBeCloseTo(m, 9);
    }
    // A bare number is in the reader's units.
    expect(parseLength("10", { imperial: true })).toBeCloseTo(ft(10), 9);
    expect(parseLength("3.5")).toBe(3.5);
    expect(parseLength("3,5")).toBe(3.5);
    expect(parseLength("")).toBeNull();
    expect(parseLength("twelve feet")).toBeNull();
  });
});

