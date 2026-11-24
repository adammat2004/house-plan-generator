/**
 * The satellite map and search provider. One key, read client-side: it's a
 * public key, restricted at the provider to this app's domains, same as any
 * map SDK key. `imagery` is stored on a traced site (`Site.traced.imagery`)
 * so its Check band (`domain/site/geo.ts`) can later be tuned per provider.
 */

export const TILE_PROVIDER = "MapTiler";
export const IMAGERY_SOURCE = "maptiler-satellite";

function key(): string | undefined {
  const k = process.env.NEXT_PUBLIC_MAPTILER_KEY;
  return k && k.trim() ? k : undefined;
}

/** Whether a map can be built at all: without a key, SiteMap goes straight to its failed state. */
export function mapKeyAvailable(): boolean {
  return !!key();
}

/** A complete MapLibre style for satellite imagery. */
export function satelliteStyleUrl(): string | null {
  const k = key();
  return k ? `https://api.maptiler.com/maps/satellite/style.json?key=${k}` : null;
}

export interface GeocodeResult {
  label: string;
  center: [number, number];
}

/** Up to 5 matches for free text: an Eircode, an address, or a townland. */
export async function geocode(query: string): Promise<GeocodeResult[]> {
  const k = key();
  if (!k || !query.trim()) return [];
  const url = `https://api.maptiler.com/geocoding/${encodeURIComponent(query.trim())}.json?key=${k}&country=ie,gb&limit=5`;
  const res = await fetch(url);
  if (!res.ok) return [];
  const body = (await res.json()) as { features?: { place_name?: string; text?: string; center?: [number, number] }[] };
  return (body.features ?? [])
    .filter((f): f is { place_name?: string; text?: string; center: [number, number] } => Array.isArray(f.center) && f.center.length === 2)
    .map((f) => ({ label: f.place_name ?? f.text ?? "Result", center: f.center }));
}
