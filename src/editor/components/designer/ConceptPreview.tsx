"use client";

import { memo, useId, type ComponentProps } from "react";
import type { MultiPolygon } from "@/domain/geometry/polygons";
import type { Rect } from "@/domain/geometry/vector";
import type { Level, PlanDocument } from "@/domain/plan/types";
import { SITE_THEME } from "../../rendering/konva/theme";
import { buildGarden } from "../../rendering/scene/garden";
import { buildPlanScene } from "../../rendering/scene/planScene";
import { labelsOffStairs } from "../../rendering/scene/stairScene";
import { PlanDrawing, stairsOn, svgLine, type PlanPalette } from "./PlanThumbnail";

const LAWN_STRIPE = "#b2c193";

const shapes = (mp: MultiPolygon) => mp.flatMap((p) => [p.outer, ...p.holes]).map((ring) => svgLine(ring, true)).join("");

/**
 * A plan drawn in its garden for comparing concepts, the same garden as on
 * the plan (scene/garden.ts): lawn, gravel at the walls, the terrace and
 * the path, and trees where the picture reaches them; and room names.
 * World metres, y up; decorative apart from the plan itself.
 */
export const ConceptPreview = memo(function ConceptPreview({
  level,
  palette = "finish",
  className = "concept-preview",
  labels = true,
  margin = 1.8,
  focus,
  highlight,
  site = true,
  frame: sameFrame,
  plan,
}: {
  level: Level;
  /** The house the floor is in, to draw its stairs. */
  plan?: PlanDocument;
  palette?: PlanPalette;
  className?: string;
  labels?: boolean;
  margin?: number;
  /** Crop to this part of the plan (world metres) instead of the whole house. */
  focus?: Rect;
  /** Rooms to outline, e.g. the ones a variation changes. */
  highlight?: readonly string[];
  /** Draw the garden round the house. */
  site?: boolean;
  /** Draw every preview of a set in a box this size (m), so their houses share one scale. */
  frame?: { w: number; h: number };
}) {
  const id = useId().replace(/:/g, "");
  const stairs = stairsOn(plan, level);
  const scene = stairs ? labelsOffStairs(buildPlanScene(level), stairs) : buildPlanScene(level);
  const r = scene.outsideRect;
  if (!r) return <span className={className} aria-hidden />;
  const garden = site ? buildGarden(level) : null;
  const cx = (r.minX + r.maxX) / 2;
  const cy = (r.minY + r.maxY) / 2;
  const frame = focus ?? (sameFrame && sameFrame.w > 0 ? { minX: cx - sameFrame.w / 2, minY: cy - sameFrame.h / 2, maxX: cx + sameFrame.w / 2, maxY: cy + sameFrame.h / 2 } : r);
  const box = { minX: frame.minX - margin, minY: frame.minY - margin, maxX: frame.maxX + margin, maxY: frame.maxY + margin };
  const w = box.maxX - box.minX;
  const h = box.maxY - box.minY;

  // Labels are a fraction of a unit tall and scaled up by the viewBox; without geometricPrecision, hinted glyph advances break words apart on Linux.
  return (
    <svg className={className} viewBox={`${box.minX} ${-box.maxY} ${w} ${h}`} preserveAspectRatio={sameFrame ? "xMidYMid meet" : "xMidYMid slice"} textRendering="geometricPrecision" aria-hidden>
      <defs>
        <pattern id={`paving-${id}`} patternUnits="userSpaceOnUse" width="0.9" height="0.9">
          <rect width="0.9" height="0.9" fill={SITE_THEME.paving} />
          <path d="M0 0H0.9M0 0V0.9" stroke={SITE_THEME.pavingJoint} strokeWidth="0.03" />
        </pattern>
        <pattern id={`lawn-${id}`} patternUnits="userSpaceOnUse" width="2.8" height="1.4">
          <rect width="2.8" height="1.4" fill={SITE_THEME.lawn} />
          <rect width="1.4" height="1.4" fill={LAWN_STRIPE} />
        </pattern>
      </defs>
      <g transform="scale(1,-1)">
        {garden && (
          <>
            <rect x={box.minX} y={box.minY} width={w} height={h} fill={`url(#lawn-${id})`} />
            <path d={shapes(garden.hedges)} fill={SITE_THEME.hedge} fillRule="evenodd" />
            <path d={shapes(garden.apron)} fill={SITE_THEME.gravel} fillRule="evenodd" />
            <path d={shapes([...garden.terrace, ...garden.path])} fill={`url(#paving-${id})`} stroke={SITE_THEME.pavingJoint} strokeWidth={0.03} />
          </>
        )}
        {scene.outsideRing ? (
          <polygon points={scene.outsideRing.map((p) => `${p.x + 0.25},${p.y - 0.3}`).join(" ")} fill="rgba(40, 38, 30, 0.14)" />
        ) : (
          <rect x={r.minX + 0.25} y={r.minY - 0.3} width={r.maxX - r.minX} height={r.maxY - r.minY} fill="rgba(40, 38, 30, 0.14)" />
        )}
        {garden?.trees.map((t, i) => (
          <g key={i}>
            <circle cx={t.x + t.r * 0.35} cy={t.y - t.r * 0.35} r={t.r} fill={SITE_THEME.treeShadow} />
            <circle cx={t.x} cy={t.y} r={t.r} fill={SITE_THEME.canopy[t.shade % SITE_THEME.canopy.length]} />
            <circle cx={t.x - t.r * 0.22} cy={t.y + t.r * 0.22} r={t.r * 0.42} fill={SITE_THEME.canopyLight} />
          </g>
        ))}
        <PlanDrawing scene={scene} palette={palette} detail highlight={highlight} stairs={stairs} />
      </g>
      {labels &&
        scene.rooms.map((room) => {
          const width = room.bounds.maxX - room.bounds.minX;
          const height = room.bounds.maxY - room.bounds.minY;
          // Long names ("Kitchen / Dining") break onto two lines when that makes them fit.
          const fits = (text: string) => width >= text.length * 0.2 + 0.2;
          const split = room.name.includes(" / ") ? room.name.split(" / ").map((p, i, all) => (i < all.length - 1 ? `${p} /` : p)) : room.name.split(" ");
          const lines = fits(room.name) ? [room.name] : split.length > 1 && split.every(fits) ? [split.slice(0, Math.ceil(split.length / 2)).join(" "), split.slice(Math.ceil(split.length / 2)).join(" ")] : null;
          if (room.clearArea < 3 || !lines || height < 1.1 + (lines.length - 1) * 0.4) return null;
          const top = -room.label.y - 0.06 - (lines.length - 1) * 0.21;
          return (
            <g key={room.id} className="concept-label">
              {lines.map((line, i) => (
                <text key={i} x={room.label.x} y={top + i * 0.42} fontSize={0.36} fontWeight={600} textAnchor="middle">
                  {line}
                </text>
              ))}
              <text x={room.label.x} y={top + (lines.length - 1) * 0.42 + 0.42} fontSize={0.28} textAnchor="middle" opacity={0.7}>
                {room.areaLabel}
              </text>
            </g>
          );
        })}
    </svg>
  );
});

/** Every floor of a house side by side, ground first and each named; a house of one floor is its ConceptPreview alone. */
export function HousePreview({ plan, className = "concept-preview", ...rest }: { plan: PlanDocument } & Omit<ComponentProps<typeof ConceptPreview>, "level" | "plan">) {
  if (plan.levels.length === 1) return <ConceptPreview level={plan.levels[0]} className={className} {...rest} />;
  return (
    <span className={`${className} house-floors`} data-testid="house-floors">
      {plan.levels.map((level, i) => (
        <span key={level.id} className="house-floor">
          <ConceptPreview level={level} plan={plan} className="house-floor-plan" {...rest} site={i === 0 && rest.site !== false} />
          <span className="house-floor-name">{level.name}</span>
        </span>
      ))}
    </span>
  );
}
