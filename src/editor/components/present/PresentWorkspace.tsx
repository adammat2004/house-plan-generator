"use client";

import dynamic from "next/dynamic";
import { Menu, MenuItem } from "@/components/ui/controls";
import {
  ArmchairIcon,
  BulbIcon,
  ChevronDownIcon,
  CloseIcon,
  ExteriorIcon,
  EyeIcon,
  FitIcon,
  MoreIcon,
  OrbitIcon,
  PaletteIcon,
  PanIcon,
  RoomIcon,
  SunIcon,
  WalkIcon,
} from "@/components/ui/icons";
import { editor, useDocumentState, useSessionState } from "../../state/editor";
import type { CameraMode, LightingPreset, View3DMode, View3DState } from "../../state/stores";
import { toolController } from "../../tools/instance";
import { aim, LIGHTING_LABEL, set3d } from "./actions";
import { PresentPanel } from "./PresentPanel";

/** three.js loads only when the 3D tab is opened. */
const ThreeView = dynamic(() => import("../../rendering/three/ThreeView"), {
  ssr: false,
  loading: () => <div className="three-loading">Loading 3D…</div>,
});

/**
 * Screen 8: the house in 3D beside (or instead of) the plan. 2D and 3D stay
 * in step: both draw the same document, and selecting a room in either
 * highlights it in the other.
 */
export function PresentWorkspace() {
  const present = useSessionState((s) => s.workspace === "present");
  const mode = useSessionState((s) => s.view3d.mode);
  if (!present) return null;
  return (
    <>
      <div className={`three-pane is-${mode}`} aria-hidden={mode === "2d"}>
        <ThreeView active={mode !== "2d"} />
      </div>
      <ModeSwitch mode={mode} />
      <PresentRail />
      <RoomsCard />
      <PresentPanel />
      {mode !== "2d" && <PresentDock />}
      {mode !== "2d" && <LightingPill />}
    </>
  );
}

const MODES: ReadonlyArray<{ id: View3DMode; label: string }> = [
  { id: "2d", label: "2D" },
  { id: "3d", label: "3D" },
  { id: "split", label: "Split" },
];

function ModeSwitch({ mode }: { mode: View3DMode }) {
  return (
    <div className="mode-switch floating" role="radiogroup" aria-label="View">
      {MODES.map((m) => (
        <button
          key={m.id}
          type="button"
          role="radio"
          aria-checked={mode === m.id}
          className={mode === m.id ? "is-active" : undefined}
          onClick={() => {
            set3d({ mode: m.id });
            // The plan's share of the canvas changes, so reframe it.
            requestAnimationFrame(() => toolController.fitPlan());
          }}
          data-testid={`view-${m.id}`}
        >
          {m.label}
        </button>
      ))}
    </div>
  );
}

/** Rail shortcuts into the 3D panel. */
function PresentRail() {
  const tab = useSessionState((s) => s.view3d.panelTab);
  const panelOpen = useSessionState((s) => s.view3d.panelOpen);
  const roomsOpen = useSessionState((s) => s.view3d.roomsOpen);
  const open = (panelTab: View3DState["panelTab"]) => set3d({ panelTab, panelOpen: true });
  const item = (id: View3DState["panelTab"], label: string, Icon: typeof EyeIcon, testId: string) => (
    <button type="button" className={`tool-btn${panelOpen && tab === id ? " is-active" : ""}`} onClick={() => open(id)} data-testid={testId}>
      <Icon width={20} height={20} />
      <span>{label}</span>
    </button>
  );
  return (
    <nav className="floating-toolbar floating" aria-label="3D tools">
      {item("view", "View", EyeIcon, "rail-view")}
      <button type="button" className={`tool-btn${roomsOpen ? " is-active" : ""}`} aria-pressed={roomsOpen} onClick={() => set3d({ roomsOpen: !roomsOpen })} data-testid="rail-rooms">
        <RoomIcon width={20} height={20} />
        <span>Rooms</span>
      </button>
      <button type="button" className="tool-btn" aria-disabled="true" data-tooltip="Furniture is coming soon" data-tooltip-side="right">
        <ArmchairIcon width={20} height={20} />
        <span>Furniture</span>
      </button>
      {item("materials", "Materials", PaletteIcon, "rail-materials")}
      {item("lighting", "Lighting", BulbIcon, "rail-lighting")}
      {item("environment", "Exterior", ExteriorIcon, "rail-environment")}
      <Menu
        label="More"
        className="tool-more"
        summary={
          <span className="tool-btn">
            <MoreIcon width={20} height={20} />
            <span>More</span>
          </span>
        }
      >
        <MenuItem onSelect={() => aim("orbit")}>Reset camera</MenuItem>
        <MenuItem onSelect={() => set3d({ panelOpen: !panelOpen })}>{panelOpen ? "Hide 3D panel" : "Show 3D panel"}</MenuItem>
      </Menu>
    </nav>
  );
}

/** Every room, to jump inside it. */
function RoomsCard() {
  const open = useSessionState((s) => s.view3d.roomsOpen);
  const selection = useSessionState((s) => s.selection);
  const rooms = useDocumentState((s) => s.history.present.levels[0].rooms);
  if (!open) return null;
  return (
    <section className="rooms-card floating" aria-label="Rooms" data-testid="rooms-card">
      <header className="card-header card-header-plain">
        <h2 className="card-kicker">Rooms</h2>
        <button type="button" className="icon-btn" aria-label="Close rooms" onClick={() => set3d({ roomsOpen: false })}>
          <CloseIcon width={16} height={16} />
        </button>
      </header>
      <ul>
        {Object.values(rooms).map((r) => (
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
    </section>
  );
}

const DOCK: ReadonlyArray<{ id: CameraMode | "fit"; label: string; Icon: typeof FitIcon }> = [
  { id: "fit", label: "Fit", Icon: FitIcon },
  { id: "orbit", label: "Orbit", Icon: OrbitIcon },
  { id: "pan", label: "Pan", Icon: PanIcon },
  { id: "walk", label: "Walk", Icon: WalkIcon },
];

function PresentDock() {
  const camera = useSessionState((s) => s.view3d.camera);
  return (
    <div className="present-dock floating" role="toolbar" aria-label="Camera">
      {DOCK.map(({ id, label, Icon }) => (
        <button
          key={id}
          type="button"
          className={`dock-btn${id === camera ? " is-active" : ""}`}
          aria-pressed={id === "fit" ? undefined : id === camera}
          onClick={() => aim(id === "fit" ? "orbit" : id)}
          data-tooltip={id === "walk" ? "Walk: drag to look, WASD or arrows to move" : undefined}
          data-tooltip-side="top"
          data-testid={`dock-${id}`}
        >
          <Icon width={20} height={20} />
          <span>{label}</span>
        </button>
      ))}
    </div>
  );
}

function LightingPill() {
  const lighting = useSessionState((s) => s.view3d.lighting);
  return (
    <Menu
      label="Lighting"
      align="right"
      className="lighting-pill"
      testId="lighting-menu"
      summary={
        <span className="lighting-summary floating">
          <SunIcon width={22} height={22} /> {LIGHTING_LABEL[lighting]} <ChevronDownIcon width={16} height={16} />
        </span>
      }
    >
      {(Object.keys(LIGHTING_LABEL) as LightingPreset[]).map((p) => (
        <MenuItem key={p} onSelect={() => set3d({ lighting: p })} data-testid={`lighting-option-${p}`}>
          {LIGHTING_LABEL[p]}
        </MenuItem>
      ))}
    </Menu>
  );
}
