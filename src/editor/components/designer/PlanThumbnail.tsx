"use client";

import { memo } from "react";
import type { Ring } from "@/domain/geometry/polygons";
import type { Level, RoomType } from "@/domain/plan/types";
import { PLAN_THEME as T, ROOM_FILL, ZONE_FILL } from "../../rendering/konva/theme";
import { buildPlanScene, type PlanScene } from "../../rendering/scene/planScene";

const path = (rings: Ring[]) => rings.map((ring) => `M${ring.map((p) => `${p.x} ${p.y}`).join("L")}Z`).join("");

/** Neutral cream floors with lighter circulation and wet rooms, for drawings outside the editor. */
const WARM_FILL: Partial<Record<RoomType, string>> = { hall: "#f8f4ec", bathroom: "#ede7dc", ensuite: "#ede7dc", wc: "#ede7dc", utility: "#ede7dc" };
const WARM_DEFAULT = "#f1e9da";

export type PlanPalette = "type" | "warm" | "zones";

const fillFor = (palette: PlanPalette, type: RoomType) =>
  palette === "warm" ? (WARM_FILL[type] ?? WARM_DEFAULT) : palette === "zones" ? ZONE_FILL[type] : ROOM_FILL[type];

/**
 * A plan's rooms, walls and (optionally) openings as SVG in world metres,
 * y up. Callers place it with their own transform.
 */
export function PlanDrawing({ scene, palette = "type", detail = false, highlight }: { scene: PlanScene; palette?: PlanPalette; detail?: boolean; highlight?: readonly string[] }) {
  return (
    <>
      {scene.rooms.map((room) => (
        <path
          key={room.id}
          d={path(room.clear.flatMap((p) => [p.outer, ...p.holes]))}
          fill={fillFor(palette, room.type)}
          fillRule="evenodd"
        />
      ))}
      {highlight?.length ? (
        <g fill={T.accentSoft} stroke={T.accent} strokeWidth={0.12}>
          {scene.rooms
            .filter((room) => highlight.includes(room.id))
            .map((room) => (
              <path key={room.id} d={path(room.clear.flatMap((p) => [p.outer, ...p.holes]))} fillRule="evenodd" />
            ))}
        </g>
      ) : null}
      {/* A hairline keeps thin internal walls legible at thumbnail size. */}
      <path d={path(scene.wallMass.flatMap((p) => [p.outer, ...p.holes]))} fill={T.wallFill} stroke={T.wallFill} strokeWidth={0.04} fillRule="evenodd" />
      {detail && (
        <g fill="none" stroke={T.openingStroke} strokeWidth={0.035} strokeLinejoin="round">
          {scene.openings.map((o) =>
            o.kind === "door" ? (
              <g key={o.id}>
                {o.leaf && <path d={`M${o.leaf[0].x} ${o.leaf[0].y}L${o.leaf[1].x} ${o.leaf[1].y}`} />}
                {o.arc && <path d={`M${o.arc.map((p) => `${p.x} ${p.y}`).join("L")}`} strokeDasharray="0.08 0.06" />}
              </g>
            ) : (
              <g key={o.id}>
                {o.frame && <path d={path([o.frame])} fill="#fbfaf7" />}
                {o.glazing?.map(([a, b], i) => <path key={i} d={`M${a.x} ${a.y}L${b.x} ${b.y}`} stroke={T.glazing} />)}
              </g>
            ),
          )}
        </g>
      )}
    </>
  );
}

/** A small drawing of a plan's rooms and walls, derived from the same scene as the canvas. */
export const PlanThumbnail = memo(function PlanThumbnail({
  level,
  palette = "type",
  className = "plan-thumb",
  pad = 0.3,
  detail = false,
  highlight,
}: {
  level: Level;
  /** Rooms to outline, e.g. the ones a proposal changes. */
  highlight?: readonly string[];
  /** "type" tints rooms by use (as in Design); "warm" draws every floor in cream; "zones" colours day, night and wet rooms. */
  palette?: PlanPalette;
  className?: string;
  /** Margin around the house, m. */
  pad?: number;
  /** Also draw door swings and window frames (for larger drawings). */
  detail?: boolean;
}) {
  const scene = buildPlanScene(level);
  const r = scene.outsideRect;
  if (!r) return <span className={className} aria-hidden />;
  const w = r.maxX - r.minX + pad * 2;
  const h = r.maxY - r.minY + pad * 2;
  return (
    <svg className={className} viewBox={`${r.minX - pad} ${-(r.maxY + pad)} ${w} ${h}`} preserveAspectRatio="xMidYMid meet" aria-hidden>
      <g transform="scale(1,-1)">
        <PlanDrawing scene={scene} palette={palette} detail={detail} highlight={highlight} />
      </g>
    </svg>
  );
});
