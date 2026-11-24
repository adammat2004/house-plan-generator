"use client";

import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { ROOM_PICK_GROUPS, ROOM_PICK_SPECS, type RoomPick, type RoomPicks } from "@/domain/brief/rooms";
import { BRIEF_LIMITS, HOUSE_SHAPE_LABEL, parsePlacementKey, placementKey, roomSizeOf, withPicks, type HouseBrief, type RoomSize, type SizedRoom } from "@/domain/brief/schema";
import { assessHouse } from "@/domain/design/analysis";
import { pickRoomName, programFromBrief } from "@/domain/design/program";
import { ENSUITE_TARGET } from "@/domain/design/roomRules";
import type { PlanDocument } from "@/domain/plan/types";
import { roomColour } from "@/design/roomColours";
import { IconButton, Menu } from "@/components/ui/controls";
import { ChevronDownIcon, FitIcon, MinusIcon, PlusIcon, RedoIcon, SparkleIcon, TrashIcon, UndoIcon } from "@/components/ui/icons";
import { useAreaText } from "@/components/units";
import { editor, editorStores, useProjectState, useSessionState } from "../../state/editor";
import { generateFromRooms } from "../shell/tools";
import { HouseShapeChips, StoreyChips } from "./BriefFields";
import { clearPlacements, PICK_DRAG_TYPE, PlaceGrid } from "./Placements";
import { PICK_ROOM_TYPE, RoomTile } from "./RoomTile";

/**
 * The Studio: Requirements as one canvas. The live plan fills the screen;
 * a "My rooms" card floats on the left with a tile per room, canvas controls
 * along the top, a live 3D card on the right, and the house's size with the
 * Create button along the bottom.
 */

/** The size group a pick's S/M/L changes: every room of that group together. */
const SIZE_GROUP: Partial<Record<RoomPick, SizedRoom>> = {
  master_bedroom: "bedrooms",
  double_bedroom: "bedrooms",
  single_bedroom: "bedrooms",
  kitchen: "kitchen",
  kitchen_dining: "kitchen",
  open_plan: "living",
  living_room: "living",
};

const SIZE_LETTER: Record<RoomSize, string> = { compact: "S", standard: "M", generous: "L" };
const SIZE_NAME: Record<RoomSize, string> = { compact: "Small", standard: "Medium", generous: "Large" };
const SIZE_GROUP_NAME: Record<SizedRoom, string> = { bedrooms: "every bedroom", kitchen: "the kitchen", living: "the living space" };

/** Every picked room one by one, in the list's order: the nth room of each pick. */
export function roomInstances(picks: RoomPicks): Array<{ pick: RoomPick; n: number }> {
  return ROOM_PICK_GROUPS.flatMap((g) => g.picks).flatMap((pick) => Array.from({ length: picks[pick] ?? 0 }, (_, i) => ({ pick, n: i + 1 })));
}

/** A room's name on its tile: "Bedroom 2", or the pick's label when there's one of it. */
const tileName = (pick: RoomPick, n: number, picks: RoomPicks) => ((picks[pick] ?? 0) > 1 ? `${ROOM_PICK_SPECS[pick].label} ${n}` : ROOM_PICK_SPECS[pick].label);

/**
 * Takes the nth room of a pick out of the brief. Rooms placed after it
 * move up one, so each placement stays with the room it was made for.
 */
export function removeRoom(brief: HouseBrief, picks: RoomPicks, pick: RoomPick, n: number): HouseBrief {
  const placements: Record<string, { u: number; v: number }> = {};
  for (const [key, at] of Object.entries(brief.placements ?? {})) {
    const k = parsePlacementKey(key);
    if (!k || k.pick !== pick) placements[key] = at;
    else if (k.n < n) placements[key] = at;
    else if (k.n > n) placements[placementKey(pick, k.n - 1)] = at;
  }
  const { placements: _drop, ...rest } = brief;
  void _drop;
  return withPicks(Object.keys(placements).length ? { ...rest, placements } : rest, { ...picks, [pick]: (picks[pick] ?? 0) - 1 });
}

/** Whether one more of a pick fits the brief's limits. */
function canAdd(pick: RoomPick, picks: RoomPicks): boolean {
  const spec = ROOM_PICK_SPECS[pick];
  const count = picks[pick] ?? 0;
  if (count >= spec.max) return false;
  if (pick === "ensuite" && !picks.master_bedroom) return false;
  const total = (group: string) => ROOM_PICK_GROUPS.find((g) => g.group === group)!.picks.reduce((s, p) => s + (picks[p] ?? 0), 0);
  if (spec.group === "bedrooms" && total("bedrooms") >= BRIEF_LIMITS.maxBedrooms) return false;
  if (spec.group === "bathrooms" && total("bathrooms") >= BRIEF_LIMITS.maxBathrooms) return false;
  return true;
}

// ── My rooms: a tile per room ───────────────────────────────────────────────

/** How much of the house you placed and how much the planner lays out, as one bar. */
export function MixBar({ brief, picks }: { brief: HouseBrief; picks: RoomPicks }) {
  const total = roomInstances(picks).length;
  const placed = Object.keys(brief.placements ?? {}).length;
  const yours = total ? Math.round((placed / total) * 100) : 0;
  return (
    <div className="mix-bar" data-testid="mix-bar">
      <div className="mix-bar-track" aria-hidden>
        <span className="mix-bar-ai" style={{ width: `${100 - yours}%` }} />
        <span className="mix-bar-you" style={{ width: `${yours}%` }} />
      </div>
      <div className="mix-bar-labels">
        <span>
          <SparkleIcon width={13} height={13} /> {100 - yours}% laid out for you
        </span>
        <span>{yours}% placed by you</span>
      </div>
    </div>
  );
}

export function RoomTiles({ brief, picks, onHover }: { brief: HouseBrief; picks: RoomPicks; onHover: (pick: RoomPick | null) => void }) {
  const areaText = useAreaText();
  const program = useMemo(() => programFromBrief(brief), [brief]);
  const [selected, setSelected] = useState<string | null>(null);
  const targetOf = (pick: RoomPick, n: number) => (pick === "ensuite" ? ENSUITE_TARGET : (program.spaces.find((s) => s.name === pickRoomName(pick, n, picks))?.target ?? null));
  const instances = roomInstances(picks);
  if (!instances.length) {
    return (
      <p className="studio-empty" data-testid="studio-no-rooms">
        No rooms yet. Add the rooms your house needs.
      </p>
    );
  }
  const chosen = instances.find((i) => placementKey(i.pick, i.n) === selected) ?? null;
  return (
    <>
      <ul className="studio-tiles" data-testid="studio-tiles" aria-label="Your rooms">
        {instances.map(({ pick, n }) => {
          const key = placementKey(pick, n);
          const placed = !!brief.placements?.[key];
          const group = SIZE_GROUP[pick];
          const size = group ? roomSizeOf(brief, group) : "standard";
          const target = targetOf(pick, n);
          const name = tileName(pick, n, picks);
          const type = PICK_ROOM_TYPE[pick];
          return (
            <li
              key={key}
              className={`studio-tile${placed ? " is-placed" : ""}${key === selected ? " is-selected" : ""}`}
              style={{ "--tile": roomColour(type) } as CSSProperties}
              draggable
              onDragStart={(e) => {
                e.dataTransfer.setData(PICK_DRAG_TYPE, key);
                e.dataTransfer.effectAllowed = "move";
              }}
              onPointerEnter={() => onHover(pick)}
              onPointerLeave={() => onHover(null)}
              title={`Drag onto the plan to say roughly where ${name.toLowerCase()} goes`}
              data-testid={`tile-${pick}-${n}`}
            >
              <button
                type="button"
                className="studio-tile-btn"
                aria-pressed={key === selected}
                aria-label={`${name}: ${SIZE_NAME[size].toLowerCase()}${target ? `, about ${areaText(target)}` : ""}${placed ? ", placed on the plan" : ""}`}
                onClick={() => setSelected(key === selected ? null : key)}
                data-testid={`tile-menu-${pick}-${n}`}
              >
                <RoomTile type={type} size={28} className="studio-tile-icon" />
                <span className="studio-tile-name">{name}</span>
                <span className="studio-tile-size">
                  <b>{group ? SIZE_LETTER[size] : "M"}</b>
                  {target ? ` ${areaText(target)}` : ""}
                </span>
                {placed && <span className="studio-tile-pin" aria-hidden />}
              </button>
            </li>
          );
        })}
      </ul>
      {chosen && <TileEditor key={selected} brief={brief} picks={picks} pick={chosen.pick} n={chosen.n} onDone={() => setSelected(null)} />}
    </>
  );
}

/** One room's size, place and count, under the tiles. */
function TileEditor({ brief, picks, pick, n, onDone }: { brief: HouseBrief; picks: RoomPicks; pick: RoomPick; n: number; onDone: () => void }) {
  const key = placementKey(pick, n);
  const group = SIZE_GROUP[pick];
  const size = group ? roomSizeOf(brief, group) : null;
  return (
    <section className="studio-tile-editor" aria-label={tileName(pick, n, picks)} data-testid="tile-editor">
      <header>
        <strong>{tileName(pick, n, picks)}</strong>
        <button type="button" className="link-btn" onClick={onDone}>
          Done
        </button>
      </header>
      {group && size && (
        <>
          <p className="menu-note">Size, for {SIZE_GROUP_NAME[group]}</p>
          <div className="studio-size-row" role="radiogroup" aria-label="Room size">
            {(["compact", "standard", "generous"] as const).map((s) => (
              <button
                key={s}
                type="button"
                role="radio"
                aria-checked={s === size}
                className={`chip${s === size ? " is-on" : ""}`}
                onClick={() => editor.setBrief({ ...brief, roomSizes: { ...brief.roomSizes, [group]: s } })}
                data-testid={`tile-size-${pick}-${n}-${SIZE_LETTER[s]}`}
              >
                {SIZE_LETTER[s]} <small>{SIZE_NAME[s]}</small>
              </button>
            ))}
          </div>
        </>
      )}
      <div className="studio-place">
        <PlaceGrid pick={pick} brief={brief} picks={picks} placeKey={key} />
      </div>
      <div className="studio-tile-actions">
        {canAdd(pick, picks) && (
          <button type="button" className="btn btn-secondary btn-sm" onClick={() => editor.setBrief(withPicks(brief, { ...picks, [pick]: (picks[pick] ?? 0) + 1 }))} data-testid={`tile-add-${pick}-${n}`}>
            <PlusIcon width={14} height={14} /> Add another
          </button>
        )}
        <button
          type="button"
          className="btn btn-ghost btn-sm is-danger"
          onClick={() => {
            editor.setBrief(removeRoom(brief, picks, pick, n));
            onDone();
          }}
          data-testid={`tile-remove-${pick}-${n}`}
        >
          <TrashIcon width={14} height={14} /> Remove
        </button>
      </div>
    </section>
  );
}

/** Opens Design history in the panel: every Create, with its layouts and rooms. */
export function DesignHistoryButton({ onClick }: { onClick: () => void }) {
  const runs = useProjectState((s) => new Set(s.plans.flatMap((p) => (p.origin.kind === "generated" ? [p.origin.requestId] : []))).size);
  if (!runs) return null;
  return (
    <button type="button" className="btn btn-secondary btn-md studio-history" onClick={onClick} data-testid="design-history">
      Design history <span className="studio-history-count">{runs}</span>
    </button>
  );
}

// ── Canvas controls ─────────────────────────────────────────────────────────

const MAX_HISTORY = 50;

/**
 * Undo and redo for the brief while the Studio is open: every change to the
 * rooms, sizes and placements, from anywhere, is a step.
 */
export function useBriefHistory() {
  const history = useRef<{ past: HouseBrief[]; future: HouseBrief[]; applying: boolean }>({ past: [], future: [], applying: false });
  // What the buttons show; the stacks themselves live in the ref.
  const [depth, setDepth] = useState({ past: 0, future: 0 });
  const sync = () => setDepth({ past: history.current.past.length, future: history.current.future.length });
  useEffect(
    () =>
      editorStores.project.subscribe((state, prev) => {
        if (state.brief === prev.brief || state.id !== prev.id) return;
        const h = history.current;
        if (h.applying) return;
        h.past.push(prev.brief);
        if (h.past.length > MAX_HISTORY) h.past.shift();
        h.future = [];
        setDepth({ past: h.past.length, future: 0 });
      }),
    [],
  );
  const step = (from: "past" | "future") => {
    const h = history.current;
    const brief = h[from].pop();
    if (!brief) return;
    (from === "past" ? h.future : h.past).push(editorStores.project.getState().brief);
    h.applying = true;
    try {
      editor.setBrief(brief);
    } finally {
      h.applying = false;
    }
    sync();
  };
  return { canUndo: depth.past > 0, canRedo: depth.future > 0, undo: () => step("past"), redo: () => step("future") };
}

export const ZOOM_STEPS = [0.5, 0.67, 0.8, 1, 1.25, 1.5, 2, 2.5, 3] as const;

export function StudioControls({
  zoom,
  onZoom,
  history,
  brief,
  plan,
}: {
  zoom: number;
  onZoom: (zoom: number) => void;
  history: ReturnType<typeof useBriefHistory>;
  brief: HouseBrief;
  plan: boolean;
}) {
  const out = [...ZOOM_STEPS].reverse().find((z) => z < zoom - 1e-3);
  const into = ZOOM_STEPS.find((z) => z > zoom + 1e-3);
  return (
    <div className="canvas-dock floating studio-controls" role="toolbar" aria-label="Canvas" data-testid="studio-controls">
      {plan && (
        <>
          <IconButton label="Zoom out" disabled={!out} onClick={() => out && onZoom(out)} data-testid="studio-zoom-out">
            <MinusIcon width={20} height={20} />
          </IconButton>
          <span className="zoom-readout" aria-live="polite" data-testid="studio-zoom-readout">
            {Math.round(zoom * 100)}%
          </span>
          <IconButton label="Zoom in" disabled={!into} onClick={() => into && onZoom(into)} data-testid="studio-zoom-in">
            <PlusIcon width={20} height={20} />
          </IconButton>
          <IconButton label="Fit the plan" onClick={() => onZoom(1)} data-testid="studio-zoom-fit">
            <FitIcon width={20} height={20} />
          </IconButton>
          <span className="dock-divider" aria-hidden />
        </>
      )}
      <IconButton label="Undo" disabled={!history.canUndo} onClick={history.undo} data-testid="studio-undo">
        <UndoIcon width={20} height={20} />
      </IconButton>
      <IconButton label="Redo" disabled={!history.canRedo} onClick={history.redo} data-testid="studio-redo">
        <RedoIcon width={20} height={20} />
      </IconButton>
      <span className="dock-divider" aria-hidden />
      <button type="button" className="btn btn-ghost dock-fit" disabled={!brief.placements} onClick={() => clearPlacements(brief)} data-tooltip="Take every placed room off the plan" data-testid="clear-placements">
        <TrashIcon width={18} height={18} /> Clear
      </button>
    </div>
  );
}

// ── Create bar ──────────────────────────────────────────────────────────────

/** Total and heated floor area: heated leaves out the garage. */
export function areasOf(plan: PlanDocument | null): { total: number; heated: number } | null {
  if (!plan) return null;
  const a = assessHouse(plan);
  const garage = a.rooms.filter((r) => r.type === "garage").reduce((s, r) => s + r.area, 0);
  return { total: a.totalArea, heated: a.totalArea - garage };
}

export function CreateBar({ plan, picks }: { plan: PlanDocument | null; picks: RoomPicks }) {
  const brief = useProjectState((s) => s.brief);
  const auto = useProjectState((s) => s.sizing?.footprint === "auto");
  const status = useSessionState((s) => s.designer.status);
  const areaText = useAreaText();
  const areas = areasOf(plan);
  const running = status === "running";
  const update = (patch: Partial<HouseBrief>) => editor.setBrief({ ...brief, ...patch });
  return (
    <div className="studio-create" data-chrome="bottom" data-testid="studio-create">
      <div className="studio-facts" aria-live="polite" data-testid="rooms-preview-facts">
        <span className="studio-fact">
          Total <strong>{areas ? areaText(areas.total) : "–"}</strong>
        </span>
        <span className="studio-fact">
          Heated <strong>{areas ? areaText(areas.heated) : "–"}</strong>
        </span>
        <span className="studio-fact is-plain">
          {brief.bedrooms} bed · {brief.bathrooms} bath
        </span>
        <StoreyChips value={brief.storeys} onChange={(storeys) => update({ storeys })} />
        {auto && (
          <Menu
            label="House shape"
            align="right"
            className="studio-shape"
            testId="studio-shape"
            summary={
              <span className="studio-shape-summary">
                {HOUSE_SHAPE_LABEL[brief.houseShape ?? "rectangle"]} <ChevronDownIcon width={14} height={14} />
              </span>
            }
          >
            <p className="menu-note">The house is shaped and sized from your rooms. Any shape mixes rectangles with L, T and U houses.</p>
            <HouseShapeChips value={brief.houseShape} onChange={(houseShape) => update({ houseShape })} />
          </Menu>
        )}
      </div>
      <button type="button" className="btn btn-primary btn-lg studio-create-btn" disabled={running || !roomInstances(picks).length} onClick={() => void generateFromRooms()} data-testid="generate-layouts">
        <SparkleIcon width={18} height={18} /> {running ? "Creating…" : "Create"}
      </button>
    </div>
  );
}
