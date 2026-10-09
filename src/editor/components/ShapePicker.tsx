"use client";

import {
  defaultShapeParams,
  presetOutline,
  SHAPE_DEFAULT_SIZE,
  SHAPE_PRESET_INFO,
  SHAPE_PRESETS,
  type ShapePreset,
} from "@/domain/geometry/outlinePresets";

/** A small drawing of a preset at its typical size, street side down. */
export function ShapeIcon({ shape, size = 28 }: { shape: ShapePreset; size?: number }) {
  const { width, depth } = SHAPE_DEFAULT_SIZE[shape];
  const outline = presetOutline(shape, defaultShapeParams(shape, width, depth));
  const span = Math.max(width, depth);
  const pad = span * 0.08;
  const points = outline.map((p) => `${p.x + (span - width) / 2},${depth - p.y + (span - depth) / 2}`).join(" ");
  return (
    <svg width={size} height={size} viewBox={`${-pad} ${-pad} ${span + 2 * pad} ${span + 2 * pad}`} aria-hidden>
      <polygon points={points} fill="currentColor" fillOpacity={0.14} stroke="currentColor" strokeWidth={span * 0.06} strokeLinejoin="round" />
    </svg>
  );
}

/** Choose the house's outline from the presets. */
export function ShapePicker({ value, onChange, label = "House shape" }: { value: ShapePreset; onChange: (shape: ShapePreset) => void; label?: string }) {
  return (
    <div className="shape-picker" role="radiogroup" aria-label={label}>
      {SHAPE_PRESETS.map((shape) => (
        <button
          key={shape}
          type="button"
          role="radio"
          aria-checked={value === shape}
          className={`shape-option${value === shape ? " is-active" : ""}`}
          title={SHAPE_PRESET_INFO[shape].description}
          data-testid={`shape-${shape}`}
          onClick={() => onChange(shape)}
        >
          <ShapeIcon shape={shape} />
          <span>{SHAPE_PRESET_INFO[shape].label}</span>
        </button>
      ))}
    </div>
  );
}
