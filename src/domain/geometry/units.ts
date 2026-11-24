/**
 * Lengths and areas for people to read. Plans stay metric throughout; the
 * reader can see square feet alongside (UK browsers by default), or the
 * whole plan in feet and inches.
 */

export const SQ_FT_PER_M2 = 10.7639;

export const M_PER_FT = 0.3048;

/** "auto" follows the browser's language; the others are a person's choice in Settings. "imperial" is feet and inches throughout. */
export type AreaUnits = "auto" | "metric" | "both" | "imperial";

/** Whether to show square feet alongside m² for this setting and browser language. */
export function showsSquareFeet(units: AreaUnits, language: string | undefined): boolean {
  if (units !== "auto") return units === "both";
  return /^en-GB\b/i.test(language ?? "");
}

const grouped = (value: number, digits: number) =>
  new Intl.NumberFormat("en-GB", { minimumFractionDigits: digits, maximumFractionDigits: digits }).format(value);

/** "152 m²", "152 m² · 1,636 sq ft", or in imperial "1,636 sq ft". Square feet are always whole. */
export function areaText(m2: number, { sqft = false, digits = 0, imperial = false }: { sqft?: boolean; digits?: number; imperial?: boolean } = {}): string {
  const feet = `${grouped(Math.round(m2 * SQ_FT_PER_M2), 0)} sq ft`;
  if (imperial) return feet;
  const metric = `${grouped(m2, digits)} m²`;
  return sqft ? `${metric} · ${feet}` : metric;
}

/** Feet and inches to the nearest inch: 3.81 → `12′ 6″`, 0.3 → `1′ 0″`, 0.1 → `4″`. */
export function feetInches(m: number): string {
  const sign = m < 0 ? "−" : "";
  const total = Math.round(Math.abs(m) / M_PER_FT * 12);
  const ft = Math.floor(total / 12);
  const inch = total % 12;
  return ft ? `${sign}${ft}′ ${inch}″` : `${sign}${inch}″`;
}

/** A length: "3.60 m" (to `digits` places) or `11′ 10″`. */
export function lengthText(m: number, { imperial = false, digits = 2 }: { imperial?: boolean; digits?: number } = {}): string {
  return imperial ? feetInches(m) : `${m.toFixed(digits)} m`;
}

/** Width by depth: "3.60 × 6.53 m" or `11′ 10″ × 21′ 5″`. */
export function sizeText(w: number, d: number, { imperial = false, digits = 2 }: { imperial?: boolean; digits?: number } = {}): string {
  return imperial ? `${feetInches(w)} × ${feetInches(d)}` : `${w.toFixed(digits)} × ${d.toFixed(digits)} m`;
}

/**
 * A typed length in metres, or null. Takes feet and inches in any usual
 * spelling (`12'6"`, `12′ 6″`, `12 ft 6 in`, `12.5'`, `150"`) and metric with
 * its unit (`3.2 m`, `3200 mm`). A bare number is feet in imperial, else metres.
 */
export function parseLength(text: string, { imperial = false }: { imperial?: boolean } = {}): number | null {
  const t = text.trim().toLowerCase().replace(/,/g, ".").replace(/[′’]/g, "'").replace(/[″”]/g, '"').replace(/''/g, '"');
  if (!t) return null;
  const num = "(\\d+(?:\\.\\d+)?|\\.\\d+)";
  const metric = new RegExp(`^${num}\\s*(mm|cm|m)$`).exec(t);
  if (metric) return Number(metric[1]) / (metric[2] === "mm" ? 1000 : metric[2] === "cm" ? 100 : 1);
  const inches = (ft: number, inch: number) => (ft * 12 + inch) * (M_PER_FT / 12);
  // Feet, then inches with or without their mark: 12' 6", 12'6, 12 ft 6 in.
  const feet = new RegExp(`^${num}\\s*(?:'|ft|feet|foot)\\s*(?:${num}\\s*(?:"|in|inch|inches)?)?$`).exec(t);
  if (feet) return inches(Number(feet[1]), Number(feet[2] ?? 0));
  const inchOnly = new RegExp(`^${num}\\s*(?:"|in|inch|inches)$`).exec(t);
  if (inchOnly) return inches(0, Number(inchOnly[1]));
  const bare = new RegExp(`^${num}$`).exec(t);
  if (bare) return Number(bare[1]) * (imperial ? M_PER_FT : 1);
  return null;
}
