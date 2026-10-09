"use client";

import { memo, useId } from "react";
import { analyzeEnvelope, type EnvelopeSide } from "@/domain/geometry/envelope";
import type { Rect } from "@/domain/geometry/vector";
import type { Level } from "@/domain/plan/types";
import { SITE_THEME } from "../../rendering/konva/theme";
import { buildPlanScene } from "../../rendering/scene/planScene";
import { PlanDrawing, type PlanPalette } from "./PlanThumbnail";

const LAWN = "#b9c79b";
const LAWN_STRIPE = "#b2c193";

/**
 * A plan drawn on its site for comparing concepts: paving around the house,
 * lawn on the garden (rear) side, a few trees, and room names. World metres,
 * y up; decorative apart from the plan itself.
 */
export const ConceptPreview = memo(function ConceptPreview({
  level,
  palette = "warm",
  className = "concept-preview",
  labels = true,
  margin = 1.8,
  focus,
  highlight,
}: {
  level: Level;
  palette?: PlanPalette;
  className?: string;
  labels?: boolean;
  margin?: number;
  /** Crop to this part of the plan (world metres) instead of the whole house. */
  focus?: Rect;
  /** Rooms to outline, e.g. the ones a variation changes. */
  highlight?: readonly string[];
}) {
  const id = useId().replace(/:/g, "");
  const scene = buildPlanScene(level);
  const r = scene.outsideRect;
  if (!r) return <span className={className} aria-hidden />;
  const env = analyzeEnvelope(level);
  const rear: EnvelopeSide = (env.ok && level.rearWallId && env.info.sideOfWall[level.rearWallId]) || "north";
  const frame = focus ?? r;
  const box = { minX: frame.minX - margin, minY: frame.minY - margin, maxX: frame.maxX + margin, maxY: frame.maxY + margin };
  const w = box.maxX - box.minX;
  const h = box.maxY - box.minY;
  const gap = 0.5;
  const lawn =
    rear === "north" ? { x: box.minX, y: r.maxY + gap, w, h: box.maxY - r.maxY - gap }
    : rear === "south" ? { x: box.minX, y: box.minY, w, h: r.minY - gap - box.minY }
    : rear === "east" ? { x: r.maxX + gap, y: box.minY, w: box.maxX - r.maxX - gap, h }
    : { x: box.minX, y: box.minY, w: r.minX - gap - box.minX, h };

  // Trees down both flanks and in the garden corners, from the house size alone.
  const trees: Array<{ x: number; y: number; r: number }> = [];
  const flank = rear === "north" || rear === "south" ? "x" : "y";
  const spanLo = flank === "x" ? r.minY : r.minX;
  const spanHi = flank === "x" ? r.maxY : r.maxX;
  const count = Math.max(2, Math.round((spanHi - spanLo) / 2.6));
  for (let i = 0; i < count; i++) {
    const t = spanLo + ((i + 0.5) / count) * (spanHi - spanLo);
    const rad = 0.75 + ((i * 37) % 5) * 0.08;
    const inset = margin * 0.55 + ((i * 53) % 3) * 0.12;
    if (flank === "x") trees.push({ x: r.minX - inset, y: t, r: rad }, { x: r.maxX + inset, y: t + 0.8, r: rad * 0.9 });
    else trees.push({ x: t, y: r.minY - inset, r: rad }, { x: t + 0.8, y: r.maxY + inset, r: rad * 0.9 });
  }

  return (
    <svg className={className} viewBox={`${box.minX} ${-box.maxY} ${w} ${h}`} preserveAspectRatio="xMidYMid slice" aria-hidden>
      <defs>
        <pattern id={`paving-${id}`} patternUnits="userSpaceOnUse" width="0.9" height="0.9">
          <rect width="0.9" height="0.9" fill={SITE_THEME.paving} />
          <path d="M0 0H0.9M0 0V0.9" stroke={SITE_THEME.pavingJoint} strokeWidth="0.03" />
        </pattern>
        <pattern id={`lawn-${id}`} patternUnits="userSpaceOnUse" width="1.6" height="1.6">
          <rect width="1.6" height="1.6" fill={LAWN} />
          <rect width="0.8" height="1.6" fill={LAWN_STRIPE} />
        </pattern>
      </defs>
      <g transform="scale(1,-1)">
        <rect x={box.minX} y={box.minY} width={w} height={h} fill={`url(#paving-${id})`} />
        {lawn.w > 0 && lawn.h > 0 && <rect x={lawn.x} y={lawn.y} width={lawn.w} height={lawn.h} fill={`url(#lawn-${id})`} />}
        {scene.outsideRing ? (
          <polygon points={scene.outsideRing.map((p) => `${p.x + 0.25},${p.y - 0.3}`).join(" ")} fill="rgba(40, 38, 30, 0.14)" />
        ) : (
          <rect x={r.minX + 0.25} y={r.minY - 0.3} width={r.maxX - r.minX} height={r.maxY - r.minY} fill="rgba(40, 38, 30, 0.14)" />
        )}
        {trees.map((t, i) => (
          <g key={i}>
            <circle cx={t.x + t.r * 0.3} cy={t.y - t.r * 0.3} r={t.r} fill={SITE_THEME.treeShadow} />
            <circle cx={t.x} cy={t.y} r={t.r} fill={SITE_THEME.canopy[i % SITE_THEME.canopy.length]} />
            <circle cx={t.x - t.r * 0.25} cy={t.y + t.r * 0.25} r={t.r * 0.55} fill={SITE_THEME.canopyLight} opacity={0.45} />
          </g>
        ))}
        <PlanDrawing scene={scene} palette={palette} detail highlight={highlight} />
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
