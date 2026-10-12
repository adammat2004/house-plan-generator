"use client";

import type { ReactNode } from "react";
import {
  HOUSE_SHAPE_LABEL,
  HOUSE_SHAPES,
  ROOM_SIZE_LABEL,
  ROOM_SIZES,
  roomSizeOf,
  SIZED_ROOM_LABEL,
  SIZED_ROOMS,
  type HouseBrief,
  type HouseShape,
  type RoomSize,
  type SizedRoom,
} from "@/domain/brief/schema";
import { ShapeIcon } from "../ShapePicker";

/** Pieces of the brief form shared by the Rooms step. */

export const toggle = <T extends string>(list: T[], item: T) => (list.includes(item) ? list.filter((x) => x !== item) : [...list, item]);

export function BriefSection({ title, hint, children }: { title: string; hint?: string; children: ReactNode }) {
  return (
    <fieldset className="brief-section">
      <legend>{title}</legend>
      {hint && <p className="field-hint">{hint}</p>}
      {children}
    </fieldset>
  );
}

/** The shape of house to plan when its size comes from the rooms; no preference means a rectangle. */
export function HouseShapeChips({ value, onChange, testPrefix = "brief" }: { value: HouseShape | undefined; onChange: (shape: HouseShape) => void; testPrefix?: string }) {
  const current = value ?? "rectangle";
  return (
    <div className="chips" role="radiogroup" aria-label="House shape">
      {HOUSE_SHAPES.map((shape) => {
        const on = shape === current;
        return (
          <button key={shape} type="button" role="radio" aria-checked={on} className={`chip${on ? " is-on" : ""}`} data-testid={`${testPrefix}-shape-${shape}`} onClick={() => onChange(shape)}>
            {shape !== "any" && <ShapeIcon shape={shape} size={16} />}
            {HOUSE_SHAPE_LABEL[shape]}
          </button>
        );
      })}
    </div>
  );
}

/** One storey, or two with the bedrooms upstairs. */
export function StoreyChips({ value, onChange, testPrefix = "brief" }: { value: 1 | 2 | undefined; onChange: (storeys: 1 | 2) => void; testPrefix?: string }) {
  const current = value ?? 1;
  return (
    <div className="chips" role="radiogroup" aria-label="Storeys">
      {([1, 2] as const).map((n) => {
        const on = n === current;
        return (
          <button key={n} type="button" role="radio" aria-checked={on} className={`chip${on ? " is-on" : ""}`} data-testid={`${testPrefix}-storeys-${n}`} onClick={() => onChange(n)}>
            {n === 1 ? "One storey" : "Two storeys"}
          </button>
        );
      })}
    </div>
  );
}

/** Approximate sizes of the living space, kitchen and bedrooms. */
export function BriefSizeFields({ brief, onChange, testPrefix = "brief" }: { brief: HouseBrief; onChange: (patch: Partial<HouseBrief>) => void; testPrefix?: string }) {
  const applies: Record<SizedRoom, boolean> = { living: brief.requiredSpaces.includes("living"), kitchen: brief.requiredSpaces.includes("kitchen"), bedrooms: brief.bedrooms > 0 };
  return (
    <div className="size-rows">
      {SIZED_ROOMS.map((group) => (
        <SizeRow key={group} group={group} value={roomSizeOf(brief, group)} disabled={!applies[group]} testPrefix={testPrefix} onChange={(size) => onChange({ roomSizes: { ...brief.roomSizes, [group]: size } })} />
      ))}
    </div>
  );
}

function SizeRow({ group, value, disabled, testPrefix, onChange }: { group: SizedRoom; value: RoomSize; disabled: boolean; testPrefix: string; onChange: (size: RoomSize) => void }) {
  const labelId = `${testPrefix}-size-${group}`;
  return (
    <div className={`size-row${disabled ? " is-disabled" : ""}`}>
      <span id={labelId}>{SIZED_ROOM_LABEL[group]}</span>
      <div className="segmented" role="radiogroup" aria-labelledby={labelId}>
        {ROOM_SIZES.map((size) => (
          <button
            key={size}
            type="button"
            role="radio"
            aria-checked={size === value}
            className={size === value ? "is-active" : undefined}
            disabled={disabled}
            onClick={() => onChange(size)}
            data-testid={`${testPrefix}-size-${group}-${size}`}
          >
            {ROOM_SIZE_LABEL[size]}
          </button>
        ))}
      </div>
    </div>
  );
}
