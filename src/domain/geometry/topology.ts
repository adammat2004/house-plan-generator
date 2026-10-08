import type { Id, Point2 } from "../plan/types";
import { EPS } from "./numeric";
import { axialParam, isOrthogonal, type WallAxis } from "./walls";

export type WallEnd = "start" | "end";

/** A point where another wall's axis touches or crosses this wall's axis. */
export interface WallContact {
  otherWallId: Id;
  point: Point2;
  /** Distance along this wall's axis from its start. */
  s: number;
  /** Which end of this wall the contact is at, or null for the interior. */
  thisEnd: WallEnd | null;
  otherEnd: WallEnd | null;
  /** False for collinear walls meeting end to end. */
  perpendicular: boolean;
  otherThickness: number;
}

export type ContactMap = Map<Id, WallContact[]>;

export interface ContactAnalysis {
  contacts: ContactMap;
  /** Pairs of collinear walls sharing more than a point. */
  overlaps: Array<[Id, Id]>;
}

function endAt(axis: WallAxis, s: number): WallEnd | null {
  if (s <= EPS) return "start";
  if (s >= axis.length - EPS) return "end";
  return null;
}

function addContact(map: ContactMap, wallId: Id, contact: WallContact): void {
  const list = map.get(wallId);
  if (list) list.push(contact);
  else map.set(wallId, [contact]);
}

/**
 * Pairwise contact analysis for orthogonal wall axes. Oblique and degenerate
 * axes are ignored here; validation rejects them separately.
 */
export function analyzeContacts(axes: Iterable<WallAxis>): ContactAnalysis {
  const list = [...axes].filter(isOrthogonal);
  const contacts: ContactMap = new Map();
  const overlaps: Array<[Id, Id]> = [];
  for (const axis of list) contacts.set(axis.wallId, []);

  for (let i = 0; i < list.length; i++) {
    const a = list[i];
    for (let j = i + 1; j < list.length; j++) {
      const b = list[j];
      if (a.orientation !== b.orientation) {
        const h = a.orientation === "horizontal" ? a : b;
        const v = h === a ? b : a;
        if (v.line < h.min - EPS || v.line > h.max + EPS) continue;
        if (h.line < v.min - EPS || h.line > v.max + EPS) continue;
        const point = { x: v.line, y: h.line };
        recordPair(contacts, a, b, point, true);
      } else {
        if (Math.abs(a.line - b.line) > EPS) continue;
        const overlap = Math.min(a.max, b.max) - Math.max(a.min, b.min);
        if (overlap > EPS) {
          overlaps.push([a.wallId, b.wallId]);
        } else if (overlap >= -EPS) {
          const at = Math.abs(a.max - b.min) <= EPS ? a.max : a.min;
          const point = a.orientation === "horizontal" ? { x: at, y: a.line } : { x: a.line, y: at };
          recordPair(contacts, a, b, point, false);
        }
      }
    }
  }

  for (const list of contacts.values()) list.sort((p, q) => p.s - q.s);
  return { contacts, overlaps };
}

function recordPair(contacts: ContactMap, a: WallAxis, b: WallAxis, point: Point2, perpendicular: boolean) {
  const sa = clampParam(a, axialParam(a, point));
  const sb = clampParam(b, axialParam(b, point));
  const aEnd = endAt(a, sa);
  const bEnd = endAt(b, sb);
  addContact(contacts, a.wallId, {
    otherWallId: b.wallId,
    point,
    s: sa,
    thisEnd: aEnd,
    otherEnd: bEnd,
    perpendicular,
    otherThickness: b.wall.thickness,
  });
  addContact(contacts, b.wallId, {
    otherWallId: a.wallId,
    point,
    s: sb,
    thisEnd: bEnd,
    otherEnd: aEnd,
    perpendicular,
    otherThickness: a.wall.thickness,
  });
}

function clampParam(axis: WallAxis, s: number): number {
  return Math.max(0, Math.min(axis.length, s));
}

export function connectedWallIds(contacts: ContactMap, wallId: Id): Set<Id> {
  return new Set((contacts.get(wallId) ?? []).map((c) => c.otherWallId));
}
