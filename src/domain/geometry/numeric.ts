/** Numerical comparison tolerance, in metres. */
export const EPS = 1e-6;

/** Committed edit precision, in metres (1 mm). */
export const EDIT_PRECISION = 0.001;

const PRECISION_FACTOR = Math.round(1 / EDIT_PRECISION);

/** Rounds a length to the committed edit precision, normalising -0 to 0. */
export function roundToPrecision(value: number): number {
  const rounded = Math.round(value * PRECISION_FACTOR) / PRECISION_FACTOR;
  return rounded === 0 ? 0 : rounded;
}

export function nearlyEqual(a: number, b: number, eps = EPS): boolean {
  return Math.abs(a - b) <= eps;
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/** Formats metres with millimetre precision, e.g. "3.650 m". */
export function formatMetres(value: number, decimals = 3): string {
  return `${roundToPrecision(value).toFixed(decimals)} m`;
}

export function formatArea(value: number): string {
  return `${(Math.round(value * 100) / 100).toFixed(2)} m²`;
}
