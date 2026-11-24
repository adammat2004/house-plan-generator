"use client";

import { floorLabel } from "@/domain/plan/levels";
import { FLOOR_MATERIALS } from "@/domain/plan/schema";
import type { FloorMaterial, Level, Room } from "@/domain/plan/types";
import {
  DEFAULT_APPEARANCE,
  EXTERIOR_FINISHES,
  FRAME_FINISHES,
  ROOF_FINISHES_FOR,
  type Appearance,
  type ExteriorFinish,
  type FrameFinish,
  type RoofFinish,
} from "@/domain/project/schema";
import { Button, IconButton, NumberField, SegmentedControl, Tabs, Toggle } from "@/components/ui/controls";
import { AerialIcon, CloseIcon, FitIcon, InteriorIcon, OrbitIcon, WalkIcon } from "@/components/ui/icons";
import { editor, useDocumentState, useProjectState, useSessionState } from "../../state/editor";
import type { CameraMode, LightingPreset, View3DState } from "../../state/stores";
import { MATERIAL_LABEL } from "../inspector/RoomInspector";
import { aim, LIGHTING_LABEL, set3d } from "./actions";

const TABS: ReadonlyArray<{ value: View3DState["panelTab"]; label: string }> = [
  { value: "camera", label: "Camera" },
  { value: "look", label: "Look" },
  { value: "show", label: "Show" },
];

const CAMERAS: ReadonlyArray<{ id: CameraMode; label: string; Icon: typeof OrbitIcon }> = [
  { id: "orbit", label: "Orbit", Icon: OrbitIcon },
  { id: "walk", label: "Walk", Icon: WalkIcon },
  { id: "interior", label: "Inside", Icon: InteriorIcon },
  { id: "aerial", label: "Above", Icon: AerialIcon },
];

const LIGHTING: ReadonlyArray<{ value: LightingPreset; label: string }> = (["morning", "midday", "evening", "night"] as const).map((value) => ({ value, label: LIGHTING_LABEL[value] }));

const EXTERIOR_LABEL: Record<ExteriorFinish, string> = { white_render: "White render", brick: "Brick", timber: "Timber cladding", dark_render: "Dark render" };
const EXTERIOR_SWATCH: Record<ExteriorFinish, string> = {
  white_render: "#f1eee7",
  brick: "repeating-linear-gradient(0deg, #9d5b43 0 7px, #d8cfc2 7px 8px)",
  timber: "repeating-linear-gradient(90deg, #8a6847 0 6px, #4e3a28 6px 7px)",
  dark_render: "#33373a",
};
const FRAME_LABEL: Record<FrameFinish, string> = { black: "Black", white: "White", oak: "Oak" };
const FRAME_SWATCH: Record<FrameFinish, string> = { black: "#24282b", white: "#f4f4f1", oak: "#b4885a" };
const ROOF_LABEL: Record<RoofFinish, string> = { membrane: "Flat membrane", zinc: "Zinc", slate: "Slate", tile: "Clay tile" };
const ROOF_SWATCH: Record<RoofFinish, string> = { membrane: "#3b3f42", zinc: "#8d949a", slate: "#4b5157", tile: "#9b5a45" };

/** The 3D view's one panel: where the camera is, how the house looks, and what's shown. Its button is on the 3D bar. */
export function PresentPanel() {
  const open = useSessionState((s) => s.view3d.panelOpen);
  const tab = useSessionState((s) => s.view3d.panelTab);
  if (!open) return null;
  return (
    <aside className="present-panel floating" aria-label="3D view settings" data-testid="present-panel">
      <header className="present-header">
        <h2>Your house in 3D</h2>
        <IconButton label="Close panel" onClick={() => set3d({ panelOpen: false })}>
          <CloseIcon width={18} height={18} />
        </IconButton>
      </header>
      <div className="present-tabs">
        <Tabs label="3D view settings" value={tab} tabs={TABS} onChange={(panelTab) => set3d({ panelTab })} testIdPrefix="present-tab" />
      </div>
      <div className="present-body">
        {tab === "camera" && <CameraTab />}
        {tab === "look" && <LookTab />}
        {tab === "show" && <ShowTab />}
      </div>
    </aside>
  );
}

/** Rooms floor by floor; a house of one floor is one group with no heading. */
function useFloorsOfRooms(): Array<{ level: Level; label: string | null; rooms: Room[] }> {
  const plan = useDocumentState((s) => s.history.present);
  return plan.levels.map((level, i) => ({ level, label: plan.levels.length > 1 ? floorLabel(plan, i) : null, rooms: Object.values(level.rooms) }));
}

function CameraTab() {
  const camera = useSessionState((s) => s.view3d.camera);
  const selection = useSessionState((s) => s.selection);
  const floors = useFloorsOfRooms();
  return (
    <>
      <div className="camera-grid" role="radiogroup" aria-label="Camera">
        {CAMERAS.map(({ id, label, Icon }) => (
          <button key={id} type="button" role="radio" aria-checked={camera === id} className={camera === id ? "is-active" : undefined} onClick={() => aim(id)} data-testid={`camera-${id}`}>
            <Icon width={20} height={20} />
            {label}
          </button>
        ))}
      </div>
      <p className="field-hint">{camera === "walk" ? "Drag to look around. Move with W, A, S and D or the arrow keys." : "Drag to turn the house. Scroll to zoom."}</p>
      <Button className="btn-block" onClick={() => aim("orbit")} data-testid="camera-reset">
        <FitIcon width={16} height={16} /> Reset view
      </Button>
      <h3 className="detail-heading">Go inside</h3>
      {floors.map(({ level, label, rooms }) => (
        <div key={level.id} role={label ? "group" : undefined} aria-label={label ?? undefined}>
          {label && <p className="floor-group-label">{label}</p>}
          <ul className="room-jump">
            {rooms.map((r) => (
              <li key={r.id}>
                <button
                  type="button"
                  className={selection?.kind === "room" && selection.id === r.id ? "is-active" : undefined}
                  onClick={() => {
                    editor.select({ kind: "room", id: r.id });
                    aim("interior", r.id);
                  }}
                  data-testid={`room-view-${r.name}`}
                >
                  {r.name}
                </button>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </>
  );
}

function Swatches<T extends string>({ label, options, value, names, swatch, onPick, testPrefix }: { label: string; options: readonly T[]; value: T; names: Record<T, string>; swatch: Record<T, string>; onPick: (v: T) => void; testPrefix: string }) {
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

function LookTab() {
  const v = useSessionState((s) => s.view3d);
  const appearance: Appearance = useProjectState((s) => s.appearance) ?? DEFAULT_APPEARANCE;
  const floors = useFloorsOfRooms();
  const roofForm = appearance.roofForm ?? "flat";
  return (
    <>
      <h3 className="detail-heading">Time of day</h3>
      <SegmentedControl label="Time of day" value={v.lighting} options={LIGHTING} onChange={(lighting) => set3d({ lighting })} testIdPrefix="lighting" />
      <h3 className="detail-heading">Sky</h3>
      <SegmentedControl
        label="Sky"
        value={v.sky}
        options={[
          { value: "clear", label: "Clear" },
          { value: "overcast", label: "Overcast" },
        ]}
        onChange={(sky) => set3d({ sky })}
        testIdPrefix="sky"
      />
      <h3 className="detail-heading">Sun direction</h3>
      <div className="position-row">
        <input type="range" min={-180} max={180} step={5} value={v.sunAzimuth} aria-label="Sun direction" onChange={(e) => set3d({ sunAzimuth: Number(e.currentTarget.value) })} data-testid="sun-direction" />
        <output className="position-value">{v.sunAzimuth > 0 ? `+${v.sunAzimuth}` : v.sunAzimuth}°</output>
      </div>
      <div className="toggle-list">
        <Toggle label="Shadows" checked={v.shadows} onChange={() => set3d({ shadows: !v.shadows })} testId="shadows" />
      </div>

      <Swatches label="Outside walls" options={EXTERIOR_FINISHES} value={appearance.exterior} names={EXTERIOR_LABEL} swatch={EXTERIOR_SWATCH} onPick={(exterior) => editor.setAppearance({ exterior })} testPrefix="exterior" />
      <Swatches label="Window frames" options={FRAME_FINISHES} value={appearance.frames} names={FRAME_LABEL} swatch={FRAME_SWATCH} onPick={(frames) => editor.setAppearance({ frames })} testPrefix="frames" />
      <h3 className="detail-heading">Roof shape</h3>
      <SegmentedControl
        label="Roof shape"
        value={roofForm}
        options={[
          { value: "hipped", label: "Hipped" },
          { value: "gabled", label: "Gabled" },
          { value: "flat", label: "Flat" },
        ]}
        onChange={(form) => editor.setAppearance({ roofForm: form, ...(ROOF_FINISHES_FOR[form].includes(appearance.roof) ? {} : { roof: ROOF_FINISHES_FOR[form][0] }) })}
        testIdPrefix="roof-form"
      />
      <Swatches label="Roof" options={ROOF_FINISHES_FOR[roofForm]} value={appearance.roof} names={ROOF_LABEL} swatch={ROOF_SWATCH} onPick={(roof) => editor.setAppearance({ roof })} testPrefix="roof" />
      {!v.display.roof && <p className="field-hint">Turn on Roof under Show to see it.</p>}

      <h3 className="detail-heading">Floor finishes</h3>
      <div className="floor-finishes">
        {floors.flatMap(({ level, label, rooms }) => [
          ...(label ? [<p key={`${level.id}-label`} className="floor-group-label">{label}</p>] : []),
          ...rooms.map((room) => (
          <label key={room.id} className="floor-finish-row">
            <span>{room.name}</span>
            <select
              value={room.floorMaterial ?? "none"}
              onChange={(e) => {
                const value = e.currentTarget.value;
                editor.dispatch({ type: "updateRoom", roomId: room.id, changes: { floorMaterial: value === "none" ? null : (value as FloorMaterial) } });
              }}
              data-testid={`floor-finish-${room.name}`}
            >
              <option value="none">Not set</option>
              {FLOOR_MATERIALS.map((m) => (
                <option key={m} value={m}>
                  {MATERIAL_LABEL[m]}
                </option>
              ))}
            </select>
          </label>
          )),
        ])}
      </div>
      <h3 className="detail-heading">Ceilings</h3>
      {floors.map(({ level, label }) => (
        <NumberField
          key={level.id}
          label={label ? `${label} wall height` : "Wall height"}
          value={level.defaultWallHeight}
          testId={label ? `wall-height-${level.id}` : "wall-height-all"}
          hint={label ? undefined : "Every wall, as one change you can undo."}
          onCommit={(height) => {
            const result = editor.setWallHeights(height, level.id);
            return result.ok ? true : (result.issues[0]?.message ?? "Not valid");
          }}
        />
      ))}
      {floors.length > 1 && <p className="field-hint">Each floor&rsquo;s walls, as one change you can undo. The floors above move up or down with it.</p>}
    </>
  );
}

function ShowTab() {
  const v = useSessionState((s) => s.view3d);
  const plan = useDocumentState((s) => s.history.present);
  const toggle = (key: keyof View3DState["display"]) => set3d({ display: { ...v.display, [key]: !v.display[key] } });
  const upTo = v.upTo && plan.levels.some((l) => l.id === v.upTo) ? v.upTo : "all";
  return (
    <>
      {plan.levels.length > 1 && (
        <>
          <h3 className="detail-heading">Floors</h3>
          <SegmentedControl
            label="Floors shown"
            value={upTo}
            options={[...plan.levels.map((l, i) => ({ value: l.id, label: floorLabel(plan, i) })), { value: "all", label: "All" }]}
            onChange={(value) => set3d({ upTo: value === "all" ? null : value })}
            testIdPrefix="show-floors"
          />
          <p className="field-hint">Choose a floor to leave off the ones above it, and look in from above.</p>
        </>
      )}
      <div className="toggle-list">
        <Toggle label="Roof" checked={v.display.roof} onChange={() => toggle("roof")} testId="display-roof" />
        <Toggle label="Cut away the walls" hint="See into rooms from outside" checked={v.display.cutaway} onChange={() => toggle("cutaway")} testId="display-cutaway" />
        <Toggle label="Furniture" checked={v.display.furniture} onChange={() => toggle("furniture")} testId="display-furniture" />
        <Toggle label="Dimensions" checked={v.display.dimensions} onChange={() => toggle("dimensions")} testId="display-dimensions" />
        <Toggle label="Garden" checked={v.display.landscape} onChange={() => toggle("landscape")} testId="display-landscape" />
      </div>
      <h3 className="detail-heading">Ground</h3>
      <SegmentedControl
        label="Ground"
        value={v.ground}
        options={[
          { value: "lawn", label: "Lawn" },
          { value: "gravel", label: "Gravel" },
          { value: "paving", label: "Paving" },
        ]}
        onChange={(ground) => set3d({ ground })}
        testIdPrefix="ground"
      />
      <p className="field-hint">The garden and trees are there for the picture; they aren&rsquo;t part of the plan.</p>
    </>
  );
}
