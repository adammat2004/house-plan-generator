import { deriveLevelGeometry, openingHostIntervals, roomFaceIndices, type LevelGeometry } from "../geometry/derive";
import { EPS } from "../geometry/numeric";
import { connectedWallIds } from "../geometry/topology";
import { pointKey } from "../geometry/vector";
import { LIMITS } from "../plan/defaults";
import type { Level, PlanDocument } from "../plan/types";
import { describeEntity } from "./describe";
import type { PlanIssue } from "./types";

/**
 * Structural and topological checks that must pass before enclosed faces
 * and rooms can be derived.
 */
export function validateLevelStructure(level: Level, geometry = deriveLevelGeometry(level)): PlanIssue[] {
  const issues: PlanIssue[] = [];
  const label = (id: string) => describeEntity(level, id);

  for (const [key, entity] of [
    ...Object.entries(level.walls),
    ...Object.entries(level.openings),
    ...Object.entries(level.rooms),
  ]) {
    if (entity.id !== key) {
      issues.push({ code: "invalid-structure", message: `Entity key ${key} does not match its id ${entity.id}.`, entityIds: [key] });
    }
  }
  if (issues.length) return issues;

  for (const [id, p] of Object.entries(level.vertices)) {
    if (!Number.isFinite(p.x) || !Number.isFinite(p.y)) {
      issues.push({ code: "invalid-value", message: `Vertex ${id} has a non-finite coordinate.`, entityIds: [id] });
    }
  }

  for (const wall of Object.values(level.walls)) {
    if (!level.vertices[wall.startVertexId] || !level.vertices[wall.endVertexId]) {
      issues.push({ code: "not-found", message: `${label(wall.id)} references a missing vertex.`, entityIds: [wall.id] });
      continue;
    }
    if (wall.thickness < LIMITS.minWallThickness - EPS || wall.thickness > LIMITS.maxWallThickness + EPS) {
      issues.push({
        code: "invalid-value",
        message: `${label(wall.id)} thickness must be between ${LIMITS.minWallThickness} m and ${LIMITS.maxWallThickness} m.`,
        entityIds: [wall.id],
      });
    }
    if (wall.height > LIMITS.maxWallHeight + EPS) {
      issues.push({ code: "invalid-value", message: `${label(wall.id)} is taller than ${LIMITS.maxWallHeight} m.`, entityIds: [wall.id] });
    }
    const axis = geometry.axes.get(wall.id);
    if (!axis) continue;
    if (wall.startVertexId === wall.endVertexId || axis.orientation === "degenerate") {
      issues.push({ code: "zero-length-wall", message: `${label(wall.id)} has zero length.`, entityIds: [wall.id] });
    } else if (axis.orientation === "oblique") {
      issues.push({
        code: "non-orthogonal-wall",
        message: `${label(wall.id)} is not horizontal or vertical; only orthogonal walls are supported.`,
        entityIds: [wall.id],
      });
    } else if (axis.length < LIMITS.minWallLength - EPS) {
      issues.push({
        code: "zero-length-wall",
        message: `${label(wall.id)} would be shorter than ${LIMITS.minWallLength * 1000} mm.`,
        entityIds: [wall.id],
      });
    }
  }
  if (issues.length) return issues;

  const env = geometry.envelope;
  if (!env.ok) return [{ code: "envelope-invalid", message: env.message, entityIds: env.wallIds }];
  const envelopeIds = new Set(level.envelope.wallIds);
  for (const wall of Object.values(level.walls)) {
    if (!envelopeIds.has(wall.id) && wall.role !== "internal") {
      issues.push({ code: "envelope-invalid", message: "Only the four envelope walls can be external.", entityIds: [wall.id] });
    }
  }

  const seen = new Map<string, string>();
  for (const [id, p] of Object.entries(level.vertices)) {
    const key = pointKey(p);
    const other = seen.get(key);
    if (other) {
      issues.push({ code: "duplicate-vertex", message: "Two wall endpoints occupy the same position without being joined.", entityIds: [other, id] });
    } else seen.set(key, id);
  }

  const r = env.info.axisRect;
  for (const wall of Object.values(level.walls)) {
    if (wall.role !== "internal") continue;
    for (const vid of [wall.startVertexId, wall.endVertexId]) {
      const p = level.vertices[vid];
      if (p.x < r.minX - EPS || p.x > r.maxX + EPS || p.y < r.minY - EPS || p.y > r.maxY + EPS) {
        issues.push({ code: "outside-envelope", message: `${label(wall.id)} extends outside the house.`, entityIds: [wall.id] });
        break;
      }
    }
  }

  for (const [a, b] of geometry.overlaps) {
    issues.push({ code: "wall-overlap", message: `${label(a)} overlaps ${label(b)} along the same line.`, entityIds: [a, b] });
  }

  const footprints = [...geometry.footprints.values()];
  for (let i = 0; i < footprints.length; i++) {
    const fa = footprints[i];
    const connected = connectedWallIds(geometry.contacts, fa.wallId);
    for (let j = i + 1; j < footprints.length; j++) {
      const fb = footprints[j];
      if (connected.has(fb.wallId)) continue;
      const w = Math.min(fa.rect.maxX, fb.rect.maxX) - Math.max(fa.rect.minX, fb.rect.minX);
      const h = Math.min(fa.rect.maxY, fb.rect.maxY) - Math.max(fa.rect.minY, fb.rect.minY);
      if (w > EPS && h > EPS) {
        issues.push({
          code: "wall-clash",
          message: `${label(fa.wallId)} collides with ${label(fb.wallId)}; join walls at their centrelines or keep them apart.`,
          entityIds: [fa.wallId, fb.wallId],
        });
      }
    }
  }
  return issues;
}

/** Checks hosted openings, room/region correspondence and rear-wall designation. */
export function validateLevelSemantics(level: Level, geometry: LevelGeometry = deriveLevelGeometry(level)): PlanIssue[] {
  const issues: PlanIssue[] = [];
  const label = (id: string) => describeEntity(level, id);
  const byWall = new Map<string, typeof level.openings[string][]>();

  for (const opening of Object.values(level.openings)) {
    const wall = level.walls[opening.wallId];
    const axis = geometry.axes.get(opening.wallId);
    if (!wall || !axis) {
      issues.push({ code: "not-found", message: `${label(opening.id)} is not hosted by an existing wall.`, entityIds: [opening.id] });
      continue;
    }
    const list = byWall.get(wall.id) ?? [];
    list.push(opening);
    byWall.set(wall.id, list);

    if (opening.width < LIMITS.minOpeningWidth - EPS) {
      issues.push({
        code: "invalid-value",
        message: `${label(opening.id)} must be at least ${LIMITS.minOpeningWidth * 1000} mm wide.`,
        entityIds: [opening.id],
      });
      continue;
    }
    const lo = opening.offset;
    const hi = opening.offset + opening.width;
    if (lo < -EPS || hi > axis.length + EPS) {
      issues.push({
        code: "opening-out-of-bounds",
        message: `${label(opening.id)} extends beyond the end of ${label(wall.id)}.`,
        entityIds: [opening.id, wall.id],
      });
    } else {
      const intervals = openingHostIntervals(geometry, wall.id);
      if (!intervals.some(([a, b]) => lo >= a - EPS && hi <= b + EPS)) {
        issues.push({
          code: "opening-crosses-junction",
          message: `${label(opening.id)} would overlap a wall junction on ${label(wall.id)}.`,
          entityIds: [opening.id, wall.id],
        });
      }
    }
    const top = opening.kind === "window" ? opening.sillHeight + opening.height : opening.height;
    if (top > wall.height + EPS) {
      issues.push({
        code: "opening-too-tall",
        message: `${label(opening.id)} is taller than ${label(wall.id)} (${wall.height} m).`,
        entityIds: [opening.id, wall.id],
      });
    }
  }

  for (const [wallId, list] of byWall) {
    const sorted = [...list].sort((a, b) => a.offset - b.offset);
    for (let i = 0; i + 1 < sorted.length; i++) {
      if (sorted[i].offset + sorted[i].width > sorted[i + 1].offset + EPS) {
        issues.push({
          code: "opening-overlap",
          message: `${label(sorted[i].id)} overlaps ${label(sorted[i + 1].id)}.`,
          entityIds: [sorted[i].id, sorted[i + 1].id, wallId],
        });
      }
    }
  }

  const faceToRoom = new Map<number, string>();
  for (const [roomId, faceIndex] of roomFaceIndices(level)) {
    if (faceIndex < 0) {
      issues.push({ code: "room-unmatched", message: `${label(roomId)} is not inside an enclosed region.`, entityIds: [roomId] });
      continue;
    }
    const existing = faceToRoom.get(faceIndex);
    if (existing) {
      issues.push({ code: "room-duplicate", message: `${label(existing)} and ${label(roomId)} describe the same region.`, entityIds: [existing, roomId] });
    } else faceToRoom.set(faceIndex, roomId);
  }
  geometry.faces.forEach((_, index) => {
    if (!faceToRoom.has(index)) {
      issues.push({ code: "room-unmatched", message: "An enclosed region has no room record.", entityIds: [] });
    }
  });

  if (level.rearWallId !== null && !level.envelope.wallIds.includes(level.rearWallId)) {
    issues.push({ code: "rear-wall-invalid", message: "The rear wall must be one of the external walls.", entityIds: [level.rearWallId] });
  }
  return issues;
}

export function validateLevel(level: Level): PlanIssue[] {
  const geometry = deriveLevelGeometry(level);
  const structural = validateLevelStructure(level, geometry);
  if (structural.length) return structural;
  return validateLevelSemantics(level, geometry);
}

/** Full geometric validation of a structurally parsed document. */
export function validateDocument(document: PlanDocument): PlanIssue[] {
  if (document.levels.length !== 1) {
    return [{ code: "invalid-structure", message: "This version supports exactly one level.", entityIds: [] }];
  }
  return validateLevel(document.levels[0]);
}
