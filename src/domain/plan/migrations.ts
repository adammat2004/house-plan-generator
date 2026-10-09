import { CURRENT_SCHEMA_VERSION } from "./schema";

export type MigrationResult = { ok: true; value: unknown } | { ok: false; code: "unsupported-version" | "malformed-file"; message: string };

/**
 * Upgrade steps keyed by the version they upgrade from. Each takes a raw
 * object at that version and returns one at the next version; structure is
 * checked by the schema afterwards.
 */
const STEPS: Record<number, (raw: Record<string, unknown>) => Record<string, unknown>> = {
  // v1 → v2: Room.usage (8 values) became Room.type; every v1 value is still a type.
  1: (raw) => ({
    ...raw,
    schemaVersion: 2,
    levels: Array.isArray(raw.levels)
      ? raw.levels.map((level: unknown) => {
          if (typeof level !== "object" || level === null) return level;
          const rooms = (level as { rooms?: unknown }).rooms;
          if (typeof rooms !== "object" || rooms === null) return level;
          const upgraded = Object.fromEntries(
            Object.entries(rooms as Record<string, unknown>).map(([id, room]) => {
              if (typeof room !== "object" || room === null) return [id, room];
              const { usage, ...rest } = room as Record<string, unknown>;
              return [id, { ...rest, type: usage }];
            }),
          );
          return { ...level, rooms: upgraded };
        })
      : raw.levels,
  }),
  // v2 → v3: levels gained furniture; older plans have none.
  2: (raw) => ({
    ...raw,
    schemaVersion: 3,
    levels: Array.isArray(raw.levels)
      ? raw.levels.map((level: unknown) => (typeof level === "object" && level !== null ? { furniture: {}, ...level } : level))
      : raw.levels,
  }),
  // v3 → v4: the envelope became any right-angle outline; a rectangle is one with four walls.
  3: (raw) => ({
    ...raw,
    schemaVersion: 4,
    levels: Array.isArray(raw.levels)
      ? raw.levels.map((level: unknown) => {
          if (typeof level !== "object" || level === null) return level;
          const envelope = (level as { envelope?: unknown }).envelope;
          if (typeof envelope !== "object" || envelope === null) return level;
          const { kind, ...rest } = envelope as Record<string, unknown>;
          return { ...level, envelope: { kind: kind === "rectangle" ? "polygon" : kind, ...rest } };
        })
      : raw.levels,
  }),
};

/** Brings a raw parsed file up to the current schema version. */
export function migrateToCurrent(raw: unknown): MigrationResult {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    return { ok: false, code: "malformed-file", message: "The file does not contain a floor plan." };
  }
  const version = (raw as { schemaVersion?: unknown }).schemaVersion;
  if (version === undefined) {
    return { ok: false, code: "malformed-file", message: "The file has no schemaVersion, so it isn't a floor-plan project." };
  }
  if (typeof version !== "number" || !Number.isInteger(version)) {
    return { ok: false, code: "malformed-file", message: "The file's schemaVersion is not a whole number." };
  }
  if (version > CURRENT_SCHEMA_VERSION) {
    return {
      ok: false,
      code: "unsupported-version",
      message: `This file uses schema version ${version}, which is newer than this editor supports (version ${CURRENT_SCHEMA_VERSION}).`,
    };
  }
  if (version < 1) {
    return { ok: false, code: "unsupported-version", message: `Schema version ${version} is not supported.` };
  }
  let value = raw as Record<string, unknown>;
  for (let v = version; v < CURRENT_SCHEMA_VERSION; v++) value = STEPS[v](value);
  return { ok: true, value };
}
