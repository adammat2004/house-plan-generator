"use client";

import { useEffect, useState } from "react";
import { connectionSummary, neighbourRooms, roomBounds, roomResizeCommand } from "@/domain/design/analysis";
import { suggestedGoals, type RoomGoal } from "@/domain/design/intent";
import { DEFAULT_INTERIOR_STYLE } from "@/domain/design/renderRequest";
import { deriveRoomRegions, roomFaceIndices } from "@/domain/geometry/derive";
import { formatArea } from "@/domain/geometry/numeric";
import { isGeneratedRoomName, ROOM_TYPE_LABEL, suggestRoomName } from "@/domain/plan/rooms";
import { CIRCULATION_LABEL } from "@/domain/design/circulation";
import { EXTERNAL_WALL_PREFERENCES, FLOOR_MATERIALS, ROOM_TYPES, PAINT_COLOURS } from "@/domain/plan/schema";
import { PAINT_SWATCH } from "@/domain/interior/paint";
import type { ExternalWallPreference, FloorMaterial, Level, Room, RoomType } from "@/domain/plan/types";
import { describeEntity } from "@/domain/commands";
import { ROOM_FURNITURE } from "@/domain/furniture/catalog";
import { canFurnish } from "@/domain/furniture/furnish";
import { furnitureIssues } from "@/domain/furniture/issues";
import { furnitureInRoom } from "@/domain/furniture/layout";
import { INTERIOR_STYLE_LABEL, INTERIOR_STYLES, type InteriorStyle } from "@/domain/project/schema";
import { Button, IconButton, Menu, MenuItem, NumberField, OptionalNumberField, SelectField, TextField } from "@/components/ui/controls";
import { useAreaText } from "@/components/units";
import {
  ArmchairIcon,
  BathIcon,
  BedIcon,
  ChevronDownIcon,
  ChevronRightIcon,
  DeskIcon,
  DoorIcon,
  LeafIcon,
  PinIcon,
  PlusIcon,
  RefreshIcon,
  SofaIcon,
  SparkleIcon,
  SwapIcon,
  WindowIcon,
} from "@/components/ui/icons";
import { MATERIAL_SWATCH } from "../../rendering/konva/theme";
import { design, editor, useDocumentState, useProjectState, useSessionState } from "../../state/editor";
import type { InspectorTab } from "../../state/stores";
import { FurnitureArt } from "../furniture/FurnitureArt";
import { StyleNote } from "../furniture/FurnishInStyleDialog";
import { AiOptions, QuickActions } from "./RoomOptions";
import { pickFurniture } from "../shell/tools";
import { InspectorFrame, MoreSettings, run, Section } from "./frame";

export const ROOM_TYPE_OPTIONS: ReadonlyArray<{ value: RoomType; label: string }> = ROOM_TYPES.map((value) => ({
  value,
  label: ROOM_TYPE_LABEL[value],
}));

export const MATERIAL_LABEL: Record<FloorMaterial, string> = {
  timber: "Herringbone wood",
  boards: "Wood boards",
  tile: "Porcelain tile",
  stone: "Natural stone",
  carpet: "Carpet",
  concrete: "Polished concrete",
  vinyl: "Vinyl",
};

const EXTERNAL_LABEL: Record<ExternalWallPreference, string> = {
  required: "Must have an outside wall",
  preferred: "Prefer an outside wall",
  avoid: "Interior is fine",
};

const NOT_SET = "none" as const;

/** A small picture for the room's use. */
export function RoomTypeIcon({ type, size = 22 }: { type: RoomType; size?: number }) {
  const p = { width: size, height: size };
  if (type === "bedroom" || type === "primary_bedroom") return <BedIcon {...p} />;
  if (type === "bathroom" || type === "ensuite" || type === "wc" || type === "utility") return <BathIcon {...p} />;
  if (type === "office") return <DeskIcon {...p} />;
  if (type === "hall") return <DoorIcon {...p} />;
  return <SofaIcon {...p} />;
}

const TABS: ReadonlyArray<{ value: InspectorTab; label: string }> = [
  { value: "design", label: "Design" },
  { value: "furniture", label: "Furniture" },
  { value: "dimensions", label: "Dimensions" },
  { value: "connections", label: "Connections" },
];

/**
 * A room is a whole object: its walls give it shape, this card gives it
 * purpose. Design comes first, with what people do to a room (make it
 * bigger, add an island, give it more light), its look and its name;
 * the exact sizes wait under Dimensions.
 */
export function RoomInspector({ level, roomId, focusKey }: { level: Level; roomId: string; focusKey: number | null }) {
  const room = level.rooms[roomId];
  const requested = useSessionState((s) => s.panels.inspectorTab);
  const [tab, setTab] = useState<InspectorTab>(requested ?? "design");
  const areaText = useAreaText();
  const region = deriveRoomRegions(level)[roomFaceIndices(level).get(roomId) ?? -1];
  const area = region?.clearArea ?? null;
  const pinned = room.locked === true;
  const floors = useDocumentState((s) => s.history.present.levels.length);

  // A tab asked for from outside (the toolbar's Edit) opens once; the Rooms tool names the room it picks, so its name field must be on show.
  const [seen, setSeen] = useState({ requested, focusKey });
  if (requested !== seen.requested || focusKey !== seen.focusKey) {
    setSeen({ requested, focusKey });
    if (requested) setTab(requested);
    else if (focusKey && focusKey !== seen.focusKey) setTab("design");
  }
  useEffect(() => {
    if (requested) editor.setPanels({ inspectorTab: null });
  }, [requested]);

  return (
    <InspectorFrame
      icon={<RoomTypeIcon type={room.type} />}
      title={room.name}
      actions={
        <IconButton
          label={pinned ? "Unpin room" : "Pin room"}
          tooltip={pinned ? "Unpin: let edits change this room" : "Pin: keep this room's shape, doors and windows"}
          active={pinned}
          onClick={() => run({ type: "updateRoom", roomId, changes: { locked: !pinned } })}
          data-testid="room-pin"
        >
          <PinIcon width={18} height={18} fill={pinned ? "currentColor" : "none"} />
        </IconButton>
      }
      summary={
        <>
          <span className="card-area" data-testid="room-area">
            {area !== null ? areaText(area, 1) : "—"}
          </span>
          <span className="card-subtitle">{floors > 1 ? level.name : room.type === "unspecified" ? "Room" : room.circulation ? CIRCULATION_LABEL[room.circulation] : ROOM_TYPE_LABEL[room.type]}</span>
        </>
      }
    >
      <div className="panel-tabs is-inset" role="tablist">
        {TABS.map((t) => (
          <button key={t.value} type="button" role="tab" aria-selected={tab === t.value} className={tab === t.value ? "is-active" : undefined} onClick={() => setTab(t.value)} data-testid={`room-tab-${t.value}`}>
            {t.label}
          </button>
        ))}
      </div>
      {tab === "design" && <DesignTab level={level} roomId={roomId} focusKey={focusKey} />}
      {tab === "furniture" && <RoomFurniture level={level} roomId={roomId} />}
      {tab === "dimensions" && <Dimensions level={level} roomId={roomId} area={area} />}
      {tab === "connections" && (
        <Section>
          <Connections level={level} roomId={roomId} />
        </Section>
      )}
    </InspectorFrame>
  );
}

/** What people do with a room, its look, and what it is. */
function DesignTab({ level, roomId, focusKey }: { level: Level; roomId: string; focusKey: number | null }) {
  const room = level.rooms[roomId];
  // The quick action picked, whose options the AI Designer shows.
  const [picked, setPicked] = useState<RoomGoal | null>(null);
  const setType = (type: RoomType) => {
    // Generated names follow the type ("Room 2" → "Bedroom 2"); names the user chose are kept.
    const rename = isGeneratedRoomName(room.name, room.type);
    run({ type: "updateRoom", roomId, changes: rename ? { type, name: suggestRoomName(level, roomId, type) } : { type } });
  };
  return (
    <>
      <QuickActions roomId={roomId} type={room.type} picked={picked} onPick={setPicked} />
      <AiOptions level={level} roomId={roomId} picked={picked} onPick={setPicked} />
      <RoomActions level={level} roomId={roomId} />
      <RegenerateArea level={level} roomId={roomId} />
      <StyleAndFinishes roomId={roomId} room={room} />
      <Section title="This room">
        <div className="field-row">
          <SelectField label="Used as" value={room.type} options={ROOM_TYPE_OPTIONS} testId="room-type" onChange={setType} />
          <TextField label="Name" value={room.name} autoFocusKey={focusKey} testId="room-name" onCommit={(name) => run({ type: "updateRoom", roomId, changes: { name } })} />
        </div>
      </Section>
    </>
  );
}

/** The room's exact sizes: area and target, width and depth, and the planner's limits. */
function Dimensions({ level, roomId, area }: { level: Level; roomId: string; area: number | null }) {
  const room = level.rooms[roomId];
  const [targeting, setTargeting] = useState(false);
  const areaText = useAreaText();
  const bounds = roomBounds(level, roomId);
  const resize = (dimension: "width" | "depth", size: number): true | string => {
    const command = roomResizeCommand(level, roomId, dimension, size);
    if (command === null) return true;
    return typeof command === "string" ? command : run(command);
  };
  const showTarget = targeting || room.targetArea !== undefined;
  return (
    <>
      <Section>
        <div className="field">
          <span className="field-label">Area</span>
          <div className="area-row">
            <span className="area-readout">{area !== null ? areaText(area, 2) : "—"}</span>
            {!showTarget && (
              <button type="button" className="btn btn-secondary" onClick={() => setTargeting(true)} data-testid="set-target-area">
                Set target area
              </button>
            )}
          </div>
        </div>
        {showTarget && (
          <OptionalNumberField
            label="Target area"
            value={room.targetArea ?? null}
            unit="m²"
            testId="room-target-area"
            onCommit={(targetArea) => {
              if (targetArea === null) setTargeting(false);
              return run({ type: "updateRoom", roomId, changes: { targetArea } });
            }}
          />
        )}
        {room.targetArea !== undefined && area !== null && <TargetReadout area={area} target={room.targetArea} />}
        {bounds && (
          <div className="field-row">
            <NumberField label="Width" value={bounds.maxX - bounds.minX} testId="room-width" onCommit={(v) => resize("width", v)} />
            <NumberField label="Depth" value={bounds.maxY - bounds.minY} testId="room-depth" onCommit={(v) => resize("depth", v)} />
          </div>
        )}
        <p className="field-hint">Changing the size moves a wall; the room next door gives or takes the space. You can also drag the walls on the plan.</p>
      </Section>
      <MoreSettings>
        <div className="field-row">
          <OptionalNumberField label="Min area" value={room.minArea ?? null} unit="m²" testId="room-min-area" onCommit={(minArea) => run({ type: "updateRoom", roomId, changes: { minArea } })} />
          <OptionalNumberField label="Max area" value={room.maxArea ?? null} unit="m²" testId="room-max-area" onCommit={(maxArea) => run({ type: "updateRoom", roomId, changes: { maxArea } })} />
        </div>
        <SelectField
          label="Outside wall"
          value={room.externalWall ?? NOT_SET}
          options={[{ value: NOT_SET, label: "No preference" }, ...EXTERNAL_WALL_PREFERENCES.map((p) => ({ value: p, label: EXTERNAL_LABEL[p] }))]}
          testId="room-external-wall"
          onChange={(v) => run({ type: "updateRoom", roomId, changes: { externalWall: v === NOT_SET ? null : v } })}
        />
        <p className="field-hint">Area is the clear floor between wall faces.</p>
      </MoreSettings>
    </>
  );
}

/** Which arrangement "Try another arrangement" has reached in each room; 0 is the usual layout. */
const arrangements = new Map<string, number>();

/** What's in the room, and quick ways to lay it out or add to it. */
function RoomFurniture({ level, roomId }: { level: Level; roomId: string }) {
  const room = level.rooms[roomId];
  const items = furnitureInRoom(level, roomId);
  const problems = furnitureIssues(level);
  const standard = canFurnish(room.type);
  const usual = ROOM_FURNITURE[room.type] ?? [];
  const houseStyle = useProjectState((s) => s.appearance?.interiorStyle) ?? DEFAULT_INTERIOR_STYLE;
  return (
    <Section>
      {items.length ? (
        <ul className="furniture-list" data-testid="room-furniture">
          {items.map((item) => (
            <li key={item.id}>
              <button type="button" className="furniture-row" onClick={() => editor.select({ kind: "furniture", id: item.id })}>
                <FurnitureArt kind={item.kind} width={item.width} depth={item.depth} size={32} />
                <span>{describeEntity(level, item.id)}</span>
                {problems.has(item.id) ? <small className="is-problem">In the way</small> : <small>{Math.round(item.width * 1000)} × {Math.round(item.depth * 1000)}</small>}
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <div className="panel-empty" data-testid="room-furniture">
          <ArmchairIcon width={26} height={26} />
          <strong>No furniture yet</strong>
          <p>{standard ? "Furnish the room for a typical layout, or add pieces one at a time." : "Add pieces one at a time with the Furniture tool."}</p>
        </div>
      )}
      <div className="button-row">
        {standard && (
          <Button variant="primary" onClick={() => editor.furnishRoom(roomId)} data-testid="furnish-room">
            <SparkleIcon width={16} height={16} /> {items.length ? "Lay out again" : "Furnish room"}
          </Button>
        )}
        <Button onClick={() => pickFurniture(usual[0] ?? "plant")} data-testid="add-furniture">
          <PlusIcon width={16} height={16} /> Add a piece
        </Button>
      </div>
      {standard && (
        <div className="button-row">
          <Button onClick={() => editor.openFurnishDialog([roomId])} data-testid="furnish-room-in-style">
            <SparkleIcon width={16} height={16} /> Furnish in a style…
          </Button>
          {items.length > 0 && (
            <Button
              onClick={() => {
                const seed = (arrangements.get(roomId) ?? 0) + 1;
                arrangements.set(roomId, seed);
                editor.furnishInStyle(room.interiorStyle ?? houseStyle, [roomId], seed);
              }}
              data-testid="furnish-room-another"
            >
              <RefreshIcon width={16} height={16} /> Try another
            </Button>
          )}
        </div>
      )}
      {items.length > 0 && (
        <button type="button" className="link-btn" onClick={() => editor.clearFurniture(roomId)} data-testid="clear-room-furniture">
          Remove all furniture from this room
        </button>
      )}
    </Section>
  );
}

/** How the room looks: the house's interior style, this room's own style, its walls and its floor. */
function StyleAndFinishes({ roomId, room }: { roomId: string; room: Room }) {
  const houseStyle = useProjectState((s) => s.appearance?.interiorStyle) ?? DEFAULT_INTERIOR_STYLE;
  const floor = room.floorMaterial ?? null;
  const paint = room.wallColour ?? null;
  const shown = room.interiorStyle ?? houseStyle;
  return (
    <Section title="Style and finishes">
      <SelectField
        label="House style"
        value={houseStyle}
        options={INTERIOR_STYLES.map((v) => ({ value: v, label: INTERIOR_STYLE_LABEL[v] }))}
        testId="room-style"
        onChange={(interiorStyle: InteriorStyle) => editor.setAppearance({ interiorStyle })}
      />
      <SelectField
        label="This room"
        value={room.interiorStyle ?? NOT_SET}
        options={[{ value: NOT_SET, label: `Same as the house (${INTERIOR_STYLE_LABEL[houseStyle]})` }, ...INTERIOR_STYLES.map((v) => ({ value: v, label: INTERIOR_STYLE_LABEL[v] }))]}
        testId="room-style-override"
        onChange={(v: string) => run({ type: "updateRoom", roomId, changes: { interiorStyle: v === NOT_SET ? null : (v as InteriorStyle) } })}
      />
      <StyleNote style={shown} />
      <span className="field-label" id={`paint-${roomId}`}>
        Wall paint
      </span>
      <div className="swatch-grid" role="radiogroup" aria-labelledby={`paint-${roomId}`} data-testid="room-wall">
        {PAINT_COLOURS.map((c) => (
          <button
            key={c}
            type="button"
            role="radio"
            aria-checked={paint === c}
            className={paint === c ? "is-active" : undefined}
            onClick={() => run({ type: "updateRoom", roomId, changes: { wallColour: paint === c ? null : c } })}
            data-testid={`paint-${c}`}
          >
            <span className="swatch" style={{ background: PAINT_SWATCH[c].shade }} aria-hidden />
            {PAINT_SWATCH[c].label}
          </button>
        ))}
      </div>
      {!paint && <p className="field-hint">No paint chosen: the walls stay the house&apos;s off-white.</p>}
      <span className="field-label" id={`floor-${roomId}`}>
        Flooring
      </span>
      <div className="swatch-grid" role="radiogroup" aria-labelledby={`floor-${roomId}`} data-testid="room-floor">
        {FLOOR_MATERIALS.map((m) => (
          <button
            key={m}
            type="button"
            role="radio"
            aria-checked={floor === m}
            className={floor === m ? "is-active" : undefined}
            onClick={() => run({ type: "updateRoom", roomId, changes: { floorMaterial: floor === m ? null : m } })}
            data-testid={`finish-${m}`}
          >
            <span className="swatch" style={{ background: MATERIAL_SWATCH[m] }} aria-hidden />
            {MATERIAL_LABEL[m]}
          </button>
        ))}
      </div>
      {!floor && <p className="field-hint">Not chosen yet: the plan shows the floor this kind of room usually has.</p>}
    </Section>
  );
}

const CONNECTION_ICON = {
  door: <DoorIcon width={18} height={18} />,
  outside: <DoorIcon width={18} height={18} />,
  garden: <LeafIcon width={18} height={18} />,
  window: <WindowIcon width={18} height={18} />,
} as const;

/** Doors (and what they lead to) and windows (grouped by the way they face). */
function Connections({ level, roomId }: { level: Level; roomId: string }) {
  const rows = connectionSummary(level, roomId);
  if (!rows.length) return <p className="field-hint">No doors or windows yet.</p>;
  return (
    <ul className="connection-list" data-testid="room-connections">
      {rows.map((r, i) => (
        <li key={i}>
          {CONNECTION_ICON[r.kind]}
          {r.text}
        </li>
      ))}
    </ul>
  );
}

/** Bigger changes: the room redesigned from scratch, or swapped with another. */
function RoomActions({ level, roomId }: { level: Level; roomId: string }) {
  const running = useSessionState((s) => s.designer.status === "running");
  const room = level.rooms[roomId];
  const others = Object.values(level.rooms).filter((r) => r.id !== roomId);
  return (
    <div className="card-section room-actions" data-testid="room-ai-actions">
      <h3>Rework the room</h3>
      <button type="button" className="action-row" disabled={running} onClick={() => void design.openRoomVariations(roomId, suggestedGoals(room.type))} data-testid="redesign-room">
        <SparkleIcon width={18} height={18} /> Redesign this room
        <ChevronRightIcon width={16} height={16} className="action-row-end" />
      </button>
      <Menu
        label="Swap with another room"
        testId="swap-room"
        className="swap-menu"
        summary={
          <span className="action-row">
            <SwapIcon width={18} height={18} /> Swap with another room
            <ChevronDownIcon width={16} height={16} className="action-row-end" />
          </span>
        }
      >
        {others.map((r) => (
          <MenuItem key={r.id} onSelect={() => design.swapRooms(roomId, r.id)} data-testid={`swap-with-${r.name}`}>
            {r.name}
          </MenuItem>
        ))}
      </Menu>
    </div>
  );
}

/**
 * "Regenerate selection": this room and the neighbours ticked, laid out again
 * in the space they share. Pinned rooms and the hall can't be ticked.
 */
function RegenerateArea({ level, roomId }: { level: Level; roomId: string }) {
  const running = useSessionState((s) => s.designer.status === "running");
  const [picked, setPicked] = useState<ReadonlySet<string>>(new Set());
  const neighbours = neighbourRooms(level, roomId).map((id) => level.rooms[id]).filter((r) => r && r.type !== "hall");
  const ids = [roomId, ...neighbours.filter((r) => picked.has(r.id)).map((r) => r.id)];
  const pinned = level.rooms[roomId]?.locked;
  if (!neighbours.length) return null;
  return (
    <Section title="Lay out again">
      <p className="field-hint">Tick the rooms beside it to lay out again together, in the space they share. Everything else stays as it is.</p>
      <div className="chips" role="group" aria-label="Rooms to lay out again">
        {neighbours.map((r) => {
          const on = picked.has(r.id);
          return (
            <button
              key={r.id}
              type="button"
              aria-pressed={on}
              className={`chip${on ? " is-on" : ""}`}
              disabled={!!r.locked}
              title={r.locked ? `${r.name} is pinned` : undefined}
              onClick={() => setPicked((prev) => {
                const next = new Set(prev);
                if (on) next.delete(r.id);
                else next.add(r.id);
                return next;
              })}
              data-testid={`regenerate-with-${r.name}`}
            >
              {r.name}
            </button>
          );
        })}
      </div>
      <button type="button" className="action-row" disabled={running || pinned || ids.length < 2} onClick={() => void design.regenerateArea(ids)} data-testid="regenerate-area">
        <RefreshIcon width={18} height={18} /> {ids.length < 2 ? "Tick a room to go with it" : `Lay out these ${ids.length} rooms again`}
      </button>
    </Section>
  );
}

/** How the actual area compares with the target, at a glance. */
function TargetReadout({ area, target }: { area: number; target: number }) {
  const diff = area - target;
  const ratio = Math.min(area / target, 1.5);
  const close = Math.abs(diff) <= Math.max(0.5, target * 0.05);
  const text = close ? "On target" : diff < 0 ? `${formatArea(-diff)} under target` : `${formatArea(diff)} over target`;
  return (
    <div className={`target-readout${close ? " is-close" : ""}`} data-testid="room-target-readout">
      <div className="target-bar" aria-hidden>
        <span style={{ width: `${(ratio / 1.5) * 100}%` }} />
        <i style={{ left: `${(1 / 1.5) * 100}%` }} />
      </div>
      <span>{text}</span>
    </div>
  );
}
