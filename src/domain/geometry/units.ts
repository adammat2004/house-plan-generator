/**
 * Areas for people to read. Plans stay metric throughout; square feet are
 * shown alongside where a reader expects them (UK browsers by default).
 */

export const SQ_FT_PER_M2 = 10.7639;

/** "auto" follows the browser's language; the others are a person's choice in Settings. */
export type AreaUnits = "auto" | "metric" | "both";

/** Whether to show square feet alongside m² for this setting and browser language. */
export function showsSquareFeet(units: AreaUnits, language: string | undefined): boolean {
  if (units !== "auto") return units === "both";
  return /^en-GB\b/i.test(language ?? "");
}

const grouped = (value: number, digits: number) =>
  new Intl.NumberFormat("en-GB", { minimumFractionDigits: digits, maximumFractionDigits: digits }).format(value);

/** "152 m²", or "152 m² · 1,636 sq ft". Square feet are always whole. */
export function areaText(m2: number, { sqft = false, digits = 0 }: { sqft?: boolean; digits?: number } = {}): string {
  const metric = `${grouped(m2, digits)} m²`;
  return sqft ? `${metric} · ${grouped(Math.round(m2 * SQ_FT_PER_M2), 0)} sq ft` : metric;
}
