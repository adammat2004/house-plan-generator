"use client";

import { EXTERIOR_PRESET_IDS, EXTERIOR_PRESETS, effectiveRoofPitch, matchingPreset, takesWallColour } from "@/domain/project/exterior";
import {
  DEFAULT_APPEARANCE,
  DOOR_COLOURS,
  EXTERIOR_FINISHES,
  FRAME_FINISHES,
  ROOF_FINISHES_FOR,
  ROOF_PITCH_RANGE,
  WALL_COLOURS,
  type Appearance,
  type DoorColour,
  type ExteriorFinish,
  type FrameFinish,
  type RoofFinish,
  type WallColour,
} from "@/domain/project/schema";
import { Button, SegmentedControl } from "@/components/ui/controls";
import { DOOR_COLOUR, EXTERIOR, FRAMES, ROOF, WALL_COLOUR } from "@/editor/rendering/three/exteriorPalette";
import { editor, useProjectState, useSessionState } from "../../state/editor";

const EXTERIOR_LABEL: Record<ExteriorFinish, string> = {
  white_render: "White render",
  brick: "Brick",
  painted_brick: "Painted brick",
  timber: "Timber cladding",
  stone: "Stone",
  dark_render: "Dark render",
};
const EXTERIOR_SWATCH: Record<ExteriorFinish, string> = {
  white_render: EXTERIOR.white_render,
  brick: "repeating-linear-gradient(0deg, #9d5b43 0 7px, #d8cfc2 7px 8px)",
  painted_brick: "repeating-linear-gradient(0deg, #f1eee7 0 7px, #c9c5bd 7px 8px)",
  timber: "repeating-linear-gradient(90deg, #8a6847 0 6px, #4e3a28 6px 7px)",
  stone: "repeating-linear-gradient(0deg, #b9b1a3 0 8px, #8c867b 8px 9px)",
  dark_render: EXTERIOR.dark_render,
};
const WALL_COLOUR_LABEL: Record<WallColour, string> = { white: "White", cream: "Cream", sage: "Sage", sky: "Sky", stone_grey: "Stone grey", sand: "Sand", terracotta: "Terracotta", charcoal: "Charcoal" };
const FRAME_LABEL: Record<FrameFinish, string> = { black: "Black", white: "White", oak: "Oak", grey: "Grey", bronze: "Bronze" };
const DOOR_LABEL: Record<DoorColour, string> = { white: "White", black: "Black", navy: "Navy", green: "Green", red: "Red", yellow: "Yellow", oak: "Oak" };
const ROOF_LABEL: Record<RoofFinish, string> = { membrane: "Flat membrane", zinc: "Zinc", slate: "Slate", tile: "Clay tile" };

export function Swatches<T extends string>({ label, options, value, names, swatch, onPick, testPrefix }: { label: string; options: readonly T[]; value: T | undefined; names: Record<T, string>; swatch: Record<T, string>; onPick: (v: T) => void; testPrefix: string }) {
  return (
    <>
      <h3 className="detail-heading">{label}</h3>
      <div className="finish-grid" role="radiogroup" aria-label={label}>
        {options.map((o) => (
          <button key={o} type="button" role="radio" aria-checked={value === o} className={value === o ? "is-active" : undefined} onClick={() => onPick(o)} data-testid={`${testPrefix}-${o}`}>
            <span className="finish-swatch" style={{ background: swatch[o] }} aria-hidden />
            {names[o]}
          </button>
        ))}
      </div>
    </>
  );
}

/** A little elevation of the house a preset makes, drawn from the same palette as the 3D scene. */
function PresetArt({ id }: { id: (typeof EXTERIOR_PRESET_IDS)[number] }) {
  const { look } = EXTERIOR_PRESETS[id];
  const wall = look.wallColour && takesWallColour(look.exterior) ? WALL_COLOUR[look.wallColour] : EXTERIOR[look.exterior];
  const roof = ROOF[look.roof];
  const frame = FRAMES[look.frames];
  const door = DOOR_COLOUR[look.doorColour];
  const steep = Math.tan((look.roofPitch * Math.PI) / 180) * 24;
  return (
    <svg viewBox="0 0 96 64" className="preset-art" aria-hidden>
      <rect x="0" y="52" width="96" height="12" fill="var(--surface-3)" />
      <rect x="14" y="26" width="68" height="28" fill={look.exterior === "brick" ? "#9d5b43" : look.exterior === "timber" ? "#8c6a49" : wall} />
      {look.roofForm === "flat" && <rect x="11" y="22" width="74" height="5" fill={roof} />}
      {look.roofForm === "gabled" && <polygon points={`10,27 48,${27 - steep} 86,27`} fill={roof} />}
      {look.roofForm === "hipped" && <polygon points={`10,27 28,${27 - steep * 0.75} 68,${27 - steep * 0.75} 86,27`} fill={roof} />}
      <rect x="22" y="33" width="14" height="12" fill="none" stroke={frame} strokeWidth="2" />
      <rect x="60" y="33" width="14" height="12" fill="none" stroke={frame} strokeWidth="2" />
      <rect x="42" y="36" width="12" height="18" fill={door} />
    </svg>
  );
}

/** The house's whole outside look: style cards first, then the single choices behind them. */
export function ExteriorLook() {
  const appearance: Appearance = useProjectState((s) => s.appearance) ?? DEFAULT_APPEARANCE;
  const undoDepth = useSessionState((s) => s.view3d.lookUndoDepth);
  const roofForm = appearance.roofForm ?? "flat";
  const active = matchingPreset(appearance);
  const range = roofForm === "flat" ? null : ROOF_PITCH_RANGE[roofForm];
  const pitch = effectiveRoofPitch(appearance);
  return (
    <>
      <h3 className="detail-heading">Style</h3>
      <div className="preset-grid" role="radiogroup" aria-label="House style">
        {EXTERIOR_PRESET_IDS.map((id) => (
          <button key={id} type="button" role="radio" aria-checked={active === id} className={active === id ? "is-active" : undefined} onClick={() => editor.applyExteriorPreset(id)} data-testid={`preset-${id}`}>
            <PresetArt id={id} />
            <span className="preset-name">{EXTERIOR_PRESETS[id].label}</span>
            <span className="preset-blurb">{EXTERIOR_PRESETS[id].blurb}</span>
          </button>
        ))}
      </div>
      {undoDepth > 0 && (
        <Button variant="ghost" onClick={() => editor.undoLook()} data-testid="undo-look">
          Undo last style change
        </Button>
      )}

      <Swatches label="Outside walls" options={EXTERIOR_FINISHES} value={appearance.exterior} names={EXTERIOR_LABEL} swatch={EXTERIOR_SWATCH} onPick={(exterior) => editor.setExterior({ exterior })} testPrefix="exterior" />
      {takesWallColour(appearance.exterior) && (
        <Swatches label="Wall colour" options={WALL_COLOURS} value={appearance.wallColour} names={WALL_COLOUR_LABEL} swatch={WALL_COLOUR} onPick={(wallColour) => editor.setExterior({ wallColour })} testPrefix="wall-colour" />
      )}
      <Swatches label="Window frames" options={FRAME_FINISHES} value={appearance.frames} names={FRAME_LABEL} swatch={FRAMES} onPick={(frames) => editor.setExterior({ frames })} testPrefix="frames" />
      <Swatches label="Front door" options={DOOR_COLOURS} value={appearance.doorColour ?? "white"} names={DOOR_LABEL} swatch={DOOR_COLOUR} onPick={(doorColour) => editor.setExterior({ doorColour })} testPrefix="door" />

      <h3 className="detail-heading">Roof shape</h3>
      <SegmentedControl
        label="Roof shape"
        value={roofForm}
        options={[
          { value: "hipped", label: "Hipped" },
          { value: "gabled", label: "Gabled" },
          { value: "flat", label: "Flat" },
        ]}
        onChange={(form) => editor.setExterior({ roofForm: form })}
        testIdPrefix="roof-form"
      />
      {range && pitch !== undefined && (
        <>
          <h3 className="detail-heading">Roof pitch</h3>
          <div className="position-row">
            <input type="range" min={range.min} max={range.max} step={1} value={pitch} aria-label="Roof pitch" onChange={(e) => editor.setExterior({ roofPitch: Number(e.currentTarget.value) })} data-testid="roof-pitch" />
            <output className="position-value">{pitch}°</output>
          </div>
        </>
      )}
      <Swatches label="Roof" options={ROOF_FINISHES_FOR[roofForm]} value={appearance.roof} names={ROOF_LABEL} swatch={ROOF} onPick={(roof) => editor.setExterior({ roof })} testPrefix="roof" />
    </>
  );
}
