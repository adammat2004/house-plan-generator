"use client";

import { useState, type DragEvent, type PointerEvent as ReactPointerEvent } from "react";
import { ROOM_PICK_SPECS, ROOM_PICKS, type RoomPick, type RoomPicks } from "@/domain/brief/rooms";
import { parsePlacementKey, placementKey, type HouseBrief, type Placement } from "@/domain/brief/schema";
import { roomBounds } from "@/domain/design/analysis";
import { checkPlacements, whereInHouse } from "@/domain/design/placement";
import { frameOf } from "@/domain/design/zonePlanner";
import { analyzeEnvelope, type EnvelopeSide } from "@/domain/geometry/envelope";
import type { Level, PlanDocument } from "@/domain/plan/types";
import { roomColour } from "@/design/roomColours";
import { MenuItem } from "@/components/ui/controls";
import { editor } from "../../state/editor";
import { PICK_ROOM_TYPE } from "./RoomTile";

/**
 * Rooms placed on the house before generating (brief.placements): drag a
 * picked room from the list onto the preview, or use its "Place…" menu, to
 * say roughly where it should go. A hint for choosing between layouts, never
 * a rule; the preview re-plans and a thin line runs from each marker to the
 * room it landed in. Points are kept in the ground floor's frame: u across
 * the house, v from the street (0) to the garden (1).
 */

/** The drag payload's type, so only room picks drop here. */
export const PICK_DRAG_TYPE = "application/x-room-pick";

type Placements = NonNullable<HouseBrief["placements"]>;

/** Where a pick dropped again goes: its first room not yet placed, else its last. */
export function nextPlacementKey(pick: RoomPick, picks: RoomPicks, placements: Placements | undefined): string | null {
  const count = picks[pick] ?? 0;
  if (!count) return null;
  for (let n = 1; n <= count; n++) if (!placements?.[placementKey(pick, n)]) return placementKey(pick, n);
  return placementKey(pick, count);
}

/** Sets or clears one placement, keeping the rest. */
export function setPlacement(brief: HouseBrief, key: string, at: Placement | null) {
  const next: Placements = { ...brief.placements };
  if (at) next[key] = { u: round(at.u), v: round(at.v) };
  else delete next[key];
  const { placements: _drop, ...rest } = brief;
  void _drop;
  editor.setBrief(Object.keys(next).length ? { ...rest, placements: next } : rest);
}

/** Takes every room of a pick off the plan. */
export function clearPick(brief: HouseBrief, pick: RoomPick) {
  const next = Object.fromEntries(Object.entries(brief.placements ?? {}).filter(([k]) => parsePlacementKey(k)?.pick !== pick));
  const { placements: _drop, ...rest } = brief;
  void _drop;
  editor.setBrief(Object.keys(next).length ? { ...rest, placements: next } : rest);
}

/** Takes every placed room off the plan. */
export function clearPlacements(brief: HouseBrief) {
  const { placements: _drop, ...rest } = brief;
  void _drop;
  editor.setBrief(rest);
}

const round = (t: number) => Math.round(Math.min(1, Math.max(0, t)) * 1000) / 1000;

/** The ground floor's frame for a plan: world point ↔ u, v. Null without an outline. */
export function houseFrameOf(plan: PlanDocument) {
  const ground = plan.levels[0];
  const env = analyzeEnvelope(ground);
  if (!env.ok) return null;
  const rear: EnvelopeSide = (ground.rearWallId && env.info.sideOfWall[ground.rearWallId]) || "north";
  const frame = frameOf(env.info.outsideRect, rear);
  return {
    toUV: (p: { x: number; y: number }): Placement => {
      const l = frame.local(p);
      return { u: l.u / frame.W, v: l.v / frame.V };
    },
    toWorld: (p: Placement) => {
      const r = frame.world({ u0: p.u * frame.W, u1: p.u * frame.W, v0: p.v * frame.V, v1: p.v * frame.V });
      return { x: r.minX, y: r.minY };
    },
  };
}

/** The world point under the pointer, in the plan drawing's SVG (drawn with y flipped). */
function worldAt(svg: SVGSVGElement, clientX: number, clientY: number) {
  const m = svg.getScreenCTM();
  if (!m) return null;
  const p = new DOMPoint(clientX, clientY).matrixTransform(m.inverse());
  return { x: p.x, y: -p.y };
}

/** Handlers for the element around a plan drawing: rooms dragged from the list are placed where they drop. */
export function placementDropHandlers(plan: PlanDocument | null, brief: HouseBrief, picks: RoomPicks) {
  const frame = plan ? houseFrameOf(plan) : null;
  return {
    onDragOver: (e: DragEvent) => {
      if (frame && e.dataTransfer.types.includes(PICK_DRAG_TYPE)) {
        e.preventDefault();
        e.dataTransfer.dropEffect = "move";
      }
    },
    onDrop: (e: DragEvent) => {
      // A pick ("double_bedroom") places its next room; a room's key ("double_bedroom#2") places that room.
      const payload = e.dataTransfer.getData(PICK_DRAG_TYPE);
      const room = parsePlacementKey(payload);
      const pick = (room?.pick ?? payload) as RoomPick;
      const svg = (e.target as Element).closest("svg") ?? e.currentTarget.querySelector("svg");
      if (!frame || !svg || !ROOM_PICKS.includes(pick)) return;
      e.preventDefault();
      const at = worldAt(svg as SVGSVGElement, e.clientX, e.clientY);
      const key = room && room.n <= (picks[pick] ?? 0) ? payload : nextPlacementKey(pick, picks, brief.placements);
      if (at && key) setPlacement(brief, key, frame.toUV(at));
    },
  };
}

/**
 * The markers on one floor's drawing, as children of its PlanThumbnail:
 * each a pill in the room's colour with its name, draggable to move it,
 * with a cross to take it off, and a dashed line to the room it landed in.
 * On a house of several floors each marker shows on the floor its room is on.
 */
export function PlacementMarkers({ plan, level, brief, picks }: { plan: PlanDocument; level: Level; brief: HouseBrief; picks: RoomPicks }) {
  const frame = houseFrameOf(plan);
  const [moving, setMoving] = useState<{ key: string; at: Placement } | null>(null);
  if (!frame || !brief.placements) return null;
  const checks = checkPlacements(plan, brief.placements, picks);
  const onThisFloor = (levelId: string | null) => (levelId ?? plan.levels[0].id) === level.id;
  const start = (key: string) => (e: ReactPointerEvent<SVGGElement>) => {
    e.stopPropagation();
    (e.currentTarget as Element).setPointerCapture(e.pointerId);
    setMoving({ key, at: brief.placements![key] });
  };
  const move = (e: ReactPointerEvent<SVGGElement>) => {
    if (!moving) return;
    const svg = (e.currentTarget as SVGGElement).ownerSVGElement;
    const at = svg && worldAt(svg, e.clientX, e.clientY);
    if (at) setMoving({ key: moving.key, at: frame.toUV(at) });
  };
  const end = () => {
    if (moving) setPlacement(brief, moving.key, moving.at);
    setMoving(null);
  };
  return (
    <g className="placement-markers" data-testid="placement-markers">
      {checks.map((c) => {
        const k = parsePlacementKey(c.key);
        if (!k || !onThisFloor(c.levelId)) return null;
        const at = moving?.key === c.key ? moving.at : brief.placements![c.key];
        const p = frame.toWorld(at);
        const room = c.roomId && c.levelId ? roomBounds(plan.levels.find((l) => l.id === c.levelId)!, c.roomId) : null;
        const label = `${ROOM_PICK_SPECS[k.pick].label}${(picks[k.pick] ?? 0) > 1 ? ` ${k.n}` : ""}`;
        // A pill in the room's colour with its name, like the room's tile in the list.
        const h = 0.62;
        const w = 0.7 + label.length * 0.19;
        const x0 = p.x - w / 2;
        const y0 = -p.y - h / 2;
        return (
          <g key={c.key} data-testid={`placement-${c.key}`} data-honoured={c.honoured ? "true" : "false"}>
            {room && !moving && (
              <line className="placement-link" x1={p.x} y1={-p.y} x2={(room.minX + room.maxX) / 2} y2={-(room.minY + room.maxY) / 2} />
            )}
            <g className="placement-marker" onPointerDown={start(c.key)} onPointerMove={move} onPointerUp={end} onPointerCancel={() => setMoving(null)}>
              <title>{`${label}: placed at the ${whereInHouse(at.u, at.v)}${c.at && !c.honoured ? `, laid out at the ${c.at}` : ""}`}</title>
              <rect x={x0} y={y0} width={w} height={h} rx={h / 2} fill={roomColour(PICK_ROOM_TYPE[k.pick])} />
              <text x={p.x} y={-p.y + 0.11} fontSize={0.3} textAnchor="middle">
                {label}
              </text>
            </g>
            <g
              className="placement-clear"
              role="button"
              aria-label={`Take ${label} off the plan`}
              onPointerDown={(e) => e.stopPropagation()}
              onClick={() => setPlacement(brief, c.key, null)}
              data-testid={`placement-clear-${c.key}`}
            >
              <circle cx={x0 + w} cy={y0} r={0.2} />
              <path d={`M${x0 + w - 0.08} ${y0 - 0.08}l0.16 0.16m0 -0.16l-0.16 0.16`} />
            </g>
          </g>
        );
      })}
    </g>
  );
}

const CELLS: ReadonlyArray<{ label: string; at: Placement }> = [
  { label: "Back left", at: { u: 1 / 6, v: 5 / 6 } },
  { label: "Back", at: { u: 0.5, v: 5 / 6 } },
  { label: "Back right", at: { u: 5 / 6, v: 5 / 6 } },
  { label: "Left", at: { u: 1 / 6, v: 0.5 } },
  { label: "Middle", at: { u: 0.5, v: 0.5 } },
  { label: "Right", at: { u: 5 / 6, v: 0.5 } },
  { label: "Front left", at: { u: 1 / 6, v: 1 / 6 } },
  { label: "Front", at: { u: 0.5, v: 1 / 6 } },
  { label: "Front right", at: { u: 5 / 6, v: 1 / 6 } },
];

/**
 * The keyboard and touch way to place a room: a grid of the house's nine
 * parts, garden at the top. Places the pick's next room, or one room by its key.
 */
export function PlaceGrid({ pick, brief, picks, placeKey }: { pick: RoomPick; brief: HouseBrief; picks: RoomPicks; placeKey?: string }) {
  const key = placeKey ?? nextPlacementKey(pick, picks, brief.placements);
  const placed = placeKey ? (brief.placements?.[placeKey] ? [placeKey] : []) : Object.keys(brief.placements ?? {}).filter((k) => parsePlacementKey(k)?.pick === pick);
  if (!key) return null;
  return (
    <>
      <p className="place-grid-hint">Roughly where should it go? Garden at the top.</p>
      <div className="place-grid" role="group" aria-label={`Place ${ROOM_PICK_SPECS[pick].label.toLowerCase()}`}>
        {CELLS.map((c) => (
          <MenuItem key={c.label} onSelect={() => setPlacement(brief, key, c.at)} data-testid={`place-${pick}-${c.label.toLowerCase().replace(/ /g, "-")}`}>
            {c.label}
          </MenuItem>
        ))}
      </div>
      {placed.length > 0 && (
        <MenuItem onSelect={() => (placeKey ? setPlacement(brief, placeKey, null) : clearPick(brief, pick))} data-testid={`place-${pick}-clear`}>
          Don&rsquo;t place it
        </MenuItem>
      )}
    </>
  );
}
