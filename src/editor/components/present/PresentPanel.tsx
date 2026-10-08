"use client";

import { useEffect, useState, type ReactNode } from "react";
import { assessPlan } from "@/domain/design/analysis";
import { FLOOR_MATERIALS } from "@/domain/plan/schema";
import type { FloorMaterial, RoomType } from "@/domain/plan/types";
import {
  DEFAULT_APPEARANCE,
  EXTERIOR_FINISHES,
  FRAME_FINISHES,
  ROOF_FINISHES,
  type Appearance,
  type ExteriorFinish,
  type FrameFinish,
  type RoofFinish,
} from "@/domain/project/schema";
import { IconButton, NumberField } from "@/components/ui/controls";
import { AerialIcon, CloseIcon, InteriorIcon, OrbitIcon, SparkleIcon, WalkIcon } from "@/components/ui/icons";
import { previewImage, onViewerChange } from "../../rendering/three/registry";
import { editor, useDocumentState, useProjectState, useSessionState } from "../../state/editor";
import type { CameraMode, LightingPreset, View3DState } from "../../state/stores";
import { MATERIAL_LABEL } from "../inspector/RoomInspector";
import { aim, LIGHTING_LABEL, set3d } from "./actions";

const TABS: ReadonlyArray<{ id: View3DState["panelTab"]; label: string }> = [
  { id: "view", label: "View" },
  { id: "materials", label: "Materials" },
  { id: "lighting", label: "Lighting" },
  { id: "environment", label: "Environment" },
];

const CAMERAS: ReadonlyArray<{ id: CameraMode; label: string; Icon: typeof OrbitIcon }> = [
  { id: "orbit", label: "Orbit", Icon: OrbitIcon },
  { id: "walk", label: "Walk", Icon: WalkIcon },
  { id: "interior", label: "Interior", Icon: InteriorIcon },
  { id: "aerial", label: "Aerial", Icon: AerialIcon },
];

const EXTERIOR_LABEL: Record<ExteriorFinish, string> = { white_render: "White render", brick: "Brick", timber: "Timber cladding", dark_render: "Dark render" };
const EXTERIOR_SWATCH: Record<ExteriorFinish, string> = {
  white_render: "#f1eee7",
  brick: "repeating-linear-gradient(0deg, #9d5b43 0 7px, #d8cfc2 7px 8px)",
  timber: "repeating-linear-gradient(90deg, #8a6847 0 6px, #4e3a28 6px 7px)",
  dark_render: "#33373a",
};
const FRAME_LABEL: Record<FrameFinish, string> = { black: "Black", white: "White", oak: "Oak" };
const FRAME_SWATCH: Record<FrameFinish, string> = { black: "#24282b", white: "#f4f4f1", oak: "#b4885a" };
const ROOF_LABEL: Record<RoofFinish, string> = { membrane: "Flat membrane", zinc: "Zinc" };
const ROOF_SWATCH: Record<RoofFinish, string> = { membrane: "#3b3f42", zinc: "#8d949a" };
const DAY: ReadonlySet<RoomType> = new Set(["living", "kitchen", "kitchen_dining", "dining", "office"]);

/** The "3D view" panel: cameras, display, finishes, light and surroundings. */
export function PresentPanel() {
  const open = useSessionState((s) => s.view3d.panelOpen);
  const tab = useSessionState((s) => s.view3d.panelTab);
  if (!open) {
    return (
      <button type="button" className="ai-launcher floating present-launcher" onClick={() => set3d({ panelOpen: true })} data-testid="open-3d-panel">
        <SparkleIcon width={18} height={18} /> 3D view
      </button>
    );
  }
  return (
    <aside className="present-panel floating" aria-label="3D view settings" data-testid="present-panel">
      <header className="concept-detail-header">
        <div>
          <h2>3D view</h2>
          <p className="detail-sub">Explore your design in 3D.</p>
        </div>
        <IconButton label="Close 3D panel" onClick={() => set3d({ panelOpen: false })}>
          <CloseIcon width={18} height={18} />
        </IconButton>
      </header>
      <div className="panel-tabs" role="tablist">
        {TABS.map((t) => (
          <button key={t.id} type="button" role="tab" aria-selected={tab === t.id} className={tab === t.id ? "is-active" : undefined} onClick={() => set3d({ panelTab: t.id })} data-testid={`present-tab-${t.id}`}>
            {t.label}
          </button>
        ))}
      </div>
      <div className="concept-detail-body present-body">
        {tab === "view" && <ViewTab />}
        {tab === "materials" && <MaterialsTab />}
        {tab === "lighting" && <LightingTab />}
        {tab === "environment" && <EnvironmentTab />}
      </div>
    </aside>
  );
}

/**
 * Stills from preset cameras: the exterior and the main living rooms.
 * Re-rendered (after a pause) whenever the house or its look changes.
 */
function useQuickViews() {
  const level = useDocumentState((s) => s.history.present.levels[0]);
  const appearance = useProjectState((s) => s.appearance);
  const v = useSessionState((s) => s.view3d);
  const [images, setImages] = useState<Record<string, string>>({});
  const [ready, setReady] = useState(0);
  const rooms = assessPlan(level)
    .rooms.filter((r) => DAY.has(r.type))
    .slice(0, 3);
  const key = JSON.stringify([rooms.map((r) => r.id), v.display, v.lighting, v.ground, v.sky, v.sunAzimuth, appearance]);

  useEffect(() => onViewerChange(() => setReady((n) => n + 1)), []);
  useEffect(() => {
    const t = setTimeout(() => {
      const next: Record<string, string> = {};
      const hero = previewImage({ kind: "exterior" }, 560, 320);
      if (hero) next.hero = hero;
      const exterior = previewImage({ kind: "exterior" }, 200, 140);
      if (exterior) next.exterior = exterior;
      for (const r of rooms) {
        const image = previewImage({ kind: "room", roomId: r.id }, 200, 140);
        if (image) next[r.id] = image;
      }
      setImages(next);
    }, 450);
    return () => clearTimeout(t);
    // Rooms are part of the key; `level` covers edits to their shape.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, level, ready]);
  return { images, rooms };
}

function ViewTab() {
  const camera = useSessionState((s) => s.view3d.camera);
  const display = useSessionState((s) => s.view3d.display);
  const { images, rooms } = useQuickViews();
  const toggle = (key: keyof View3DState["display"]) => set3d({ display: { ...display, [key]: !display[key] } });
  return (
    <>
      <div className="present-hero">
        {images.hero ? (
          // eslint-disable-next-line @next/next/no-img-element -- a data URL rendered in the browser; nothing to optimise
          <img src={images.hero} alt="The house from the garden" />
        ) : (
          <span className="three-loading">Rendering…</span>
        )}
      </div>
      <h3 className="detail-heading">Camera</h3>
      <div className="camera-grid" role="radiogroup" aria-label="Camera">
        {CAMERAS.map(({ id, label, Icon }) => (
          <button key={id} type="button" role="radio" aria-checked={camera === id} className={camera === id ? "is-active" : undefined} onClick={() => aim(id)} data-testid={`camera-${id}`}>
            <Icon width={20} height={20} />
            {label}
          </button>
        ))}
      </div>
      <h3 className="detail-heading">Floor</h3>
      <div className="field">
        <select aria-label="Floor" defaultValue="ground" className="plain-select">
          <option value="ground">Ground floor</option>
          <option value="first" disabled>
            First floor (coming soon)
          </option>
        </select>
      </div>
      <h3 className="detail-heading">Display options</h3>
      <div className="toggle-list">
        <Toggle label="Show roof" checked={display.roof} onChange={() => toggle("roof")} testId="display-roof" />
        <Toggle label="Cutaway walls" checked={display.cutaway} onChange={() => toggle("cutaway")} testId="display-cutaway" />
        <Toggle label="Show dimensions" checked={display.dimensions} onChange={() => toggle("dimensions")} testId="display-dimensions" />
        <Toggle label="Show landscape" checked={display.landscape} onChange={() => toggle("landscape")} testId="display-landscape" />
        <Toggle label="Show furniture" checked={false} disabled hint="Coming soon" onChange={() => undefined} testId="display-furniture" />
      </div>
      <h3 className="detail-heading">Quick views</h3>
      <div className="quick-views">
        <QuickView label="Exterior" image={images.exterior} onClick={() => aim("exterior")} testId="quick-exterior" />
        {rooms.map((r) => (
          <QuickView
            key={r.id}
            label={r.name.split(" / ")[0]}
            image={images[r.id]}
            onClick={() => {
              editor.select({ kind: "room", id: r.id });
              aim("interior", r.id);
            }}
            testId={`quick-${r.name}`}
          />
        ))}
      </div>
    </>
  );
}

function QuickView({ label, image, onClick, testId }: { label: string; image?: string; onClick: () => void; testId: string }) {
  return (
    <button type="button" className="quick-view" onClick={onClick} data-testid={testId}>
      <span className="quick-image">
        {/* eslint-disable-next-line @next/next/no-img-element -- a data URL rendered in the browser */}
        {image ? <img src={image} alt="" /> : null}
      </span>
      {label}
    </button>
  );
}

function Toggle({ label, checked, onChange, disabled, hint, testId }: { label: string; checked: boolean; onChange: () => void; disabled?: boolean; hint?: string; testId: string }) {
  return (
    <label className={`toggle-row${disabled ? " is-disabled" : ""}`}>
      <span>
        {label}
        {hint && <small>{hint}</small>}
      </span>
      <input type="checkbox" role="switch" checked={checked} disabled={disabled} onChange={onChange} data-testid={testId} />
    </label>
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

function MaterialsTab() {
  const appearance: Appearance = useProjectState((s) => s.appearance) ?? DEFAULT_APPEARANCE;
  const level = useDocumentState((s) => s.history.present.levels[0]);
  const roof = useSessionState((s) => s.view3d.display.roof);
  return (
    <>
      <Swatches label="Exterior walls" options={EXTERIOR_FINISHES} value={appearance.exterior} names={EXTERIOR_LABEL} swatch={EXTERIOR_SWATCH} onPick={(exterior) => editor.setAppearance({ exterior })} testPrefix="exterior" />
      <Swatches label="Window frames" options={FRAME_FINISHES} value={appearance.frames} names={FRAME_LABEL} swatch={FRAME_SWATCH} onPick={(frames) => editor.setAppearance({ frames })} testPrefix="frames" />
      <Swatches label="Roof" options={ROOF_FINISHES} value={appearance.roof} names={ROOF_LABEL} swatch={ROOF_SWATCH} onPick={(r) => editor.setAppearance({ roof: r })} testPrefix="roof" />
      {!roof && <p className="field-hint">Turn on Show roof in View to see it.</p>}
      <h3 className="detail-heading">Walls</h3>
      <NumberField
        label="Wall height"
        value={level.defaultWallHeight}
        testId="wall-height-all"
        hint="Every wall, as one change you can undo."
        onCommit={(height) => {
          const result = editor.setWallHeights(height);
          return result.ok ? true : (result.issues[0]?.message ?? "Not valid");
        }}
      />
      <h3 className="detail-heading">Floors</h3>
      <div className="floor-finishes">
        {Object.values(level.rooms).map((room) => (
          <label key={room.id} className="floor-finish-row">
            <span>{room.name}</span>
            <select
              value={room.floorMaterial ?? "none"}
              onChange={(e) => {
                const v = e.currentTarget.value;
                editor.dispatch({ type: "updateRoom", roomId: room.id, changes: { floorMaterial: v === "none" ? null : (v as FloorMaterial) } });
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
        ))}
      </div>
    </>
  );
}

function Segmented<T extends string>({ label, options, value, names, onPick, testPrefix }: { label: string; options: readonly T[]; value: T; names: Record<T, string>; onPick: (v: T) => void; testPrefix: string }): ReactNode {
  return (
    <>
      <h3 className="detail-heading">{label}</h3>
      <div className="segmented" role="radiogroup" aria-label={label}>
        {options.map((o) => (
          <button key={o} type="button" role="radio" aria-checked={value === o} className={value === o ? "is-active" : undefined} onClick={() => onPick(o)} data-testid={`${testPrefix}-${o}`}>
            {names[o]}
          </button>
        ))}
      </div>
    </>
  );
}

function LightingTab() {
  const v = useSessionState((s) => s.view3d);
  return (
    <>
      <Segmented label="Time of day" options={["morning", "midday", "evening", "night"] as LightingPreset[]} value={v.lighting} names={LIGHTING_LABEL} onPick={(lighting) => set3d({ lighting })} testPrefix="lighting" />
      <h3 className="detail-heading">Sun direction</h3>
      <div className="position-row">
        <input type="range" min={-180} max={180} step={5} value={v.sunAzimuth} aria-label="Sun direction" onChange={(e) => set3d({ sunAzimuth: Number(e.currentTarget.value) })} data-testid="sun-direction" />
        <output className="position-value">{v.sunAzimuth > 0 ? `+${v.sunAzimuth}` : v.sunAzimuth}°</output>
      </div>
      <div className="toggle-list">
        <Toggle label="Shadows" checked={v.shadows} onChange={() => set3d({ shadows: !v.shadows })} testId="shadows" />
      </div>
      <Segmented label="Sky" options={["clear", "overcast"] as const} value={v.sky} names={{ clear: "Clear", overcast: "Overcast" }} onPick={(sky) => set3d({ sky })} testPrefix="sky" />
    </>
  );
}

function EnvironmentTab() {
  const v = useSessionState((s) => s.view3d);
  return (
    <>
      <div className="toggle-list">
        <Toggle label="Show landscape" checked={v.display.landscape} onChange={() => set3d({ display: { ...v.display, landscape: !v.display.landscape } })} testId="env-landscape" />
      </div>
      <Segmented label="Ground" options={["lawn", "gravel", "paving"] as const} value={v.ground} names={{ lawn: "Lawn", gravel: "Gravel", paving: "Paving" }} onPick={(ground) => set3d({ ground })} testPrefix="ground" />
      <p className="field-hint">Trees and paving are illustrative. Site boundaries and neighbouring buildings are coming later.</p>
    </>
  );
}
