import type { FurnitureKind } from "@/domain/plan/types";
import { FURNITURE_CATALOG } from "@/domain/furniture/catalog";
import { furnitureSymbolLocal } from "../../rendering/scene/furnitureSymbols";
import { FURNITURE_FILL, PLAN_THEME as T } from "../../rendering/konva/theme";
import { svgLine } from "../designer/PlanThumbnail";

/** A piece's plan symbol as a small picture, back at the top. Decorative. */
export function FurnitureArt({ kind, width, depth, size = 48 }: { kind: FurnitureKind; width?: number; depth?: number; size?: number }) {
  const spec = FURNITURE_CATALOG[kind];
  const w = width ?? spec.width;
  const d = depth ?? spec.depth;
  const pad = Math.max(w, d) * 0.08;
  const parts = furnitureSymbolLocal(kind, w, d);
  const stroke = Math.max(w, d) / 70;
  return (
    <svg viewBox={`${-w / 2 - pad} ${-d / 2 - pad} ${w + 2 * pad} ${d + 2 * pad}`} width={size} height={size} aria-hidden>
      {/* The symbol's back is at +y; flip so it sits at the top of the picture. */}
      <g transform="scale(1 -1)" stroke={T.furnitureStroke} strokeWidth={stroke} strokeLinejoin="round">
        {parts.map((part, i) => {
          const d = svgLine(part.ring, part.closed);
          return <path key={i} d={d} fill={part.closed && part.tone !== "none" ? FURNITURE_FILL[part.tone] : "none"} />;
        })}
      </g>
    </svg>
  );
}
