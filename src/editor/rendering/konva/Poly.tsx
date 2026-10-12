"use client";

import type { Context } from "konva/lib/Context";
import type { Shape as KonvaShape } from "konva/lib/Shape";
import { Shape } from "react-konva";
import type { MultiPolygon, Ring } from "@/domain/geometry/polygons";
import type { FinishPattern } from "./patterns";

export function traceRings(ctx: Context, rings: Ring[]) {
  ctx.beginPath();
  for (const ring of rings) {
    ring.forEach((p, i) => (i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y)));
    ctx.closePath();
  }
}

export const ringsOf = (mp: MultiPolygon): Ring[] => mp.flatMap((p) => [p.outer, ...p.holes]);

export interface PolyProps {
  rings: Ring[];
  fill?: string;
  stroke?: string;
  strokeWidth?: number;
  dash?: number[];
  /** A floor finish to fill with instead of `fill` (in world units: the shape must be in the world group). */
  pattern?: FinishPattern | null;
  /** A soft shadow round the shape, its blur in world metres. */
  glow?: { color: string; blur: number };
}

export function Poly({ rings, fill, stroke, strokeWidth = 1, dash, pattern, glow }: PolyProps) {
  return (
    <Shape
      sceneFunc={(ctx: Context, shape: KonvaShape) => {
        traceRings(ctx, rings);
        ctx.fillStrokeShape(shape);
      }}
      fill={pattern ? undefined : fill}
      fillPatternImage={pattern ? (pattern.image as unknown as HTMLImageElement) : undefined}
      fillPatternScale={pattern?.scale}
      fillPatternRepeat="repeat"
      stroke={stroke}
      strokeWidth={strokeWidth}
      dash={dash}
      fillRule="evenodd"
      strokeScaleEnabled={false}
      listening={false}
      perfectDrawEnabled={false}
      {...(glow ? { shadowColor: glow.color, shadowBlur: glow.blur, shadowOffset: { x: 0, y: 0 }, shadowOpacity: 1, shadowForStrokeEnabled: false } : {})}
    />
  );
}
