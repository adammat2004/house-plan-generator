"use client";

import { useState } from "react";
import { connectionSummary, neighbourRooms, roomBounds, roomResizeCommand } from "@/domain/design/analysis";
import { ROOM_GOAL_LABEL, suggestedGoals } from "@/domain/design/intent";
import { deriveRoomRegions, roomFaceIndices } from "@/domain/geometry/derive";
import { formatArea } from "@/domain/geometry/numeric";
import { isGeneratedRoomName, ROOM_TYPE_LABEL, suggestRoomName } from "@/domain/plan/rooms";
import { EXTERNAL_WALL_PREFERENCES, FLOOR_MATERIALS, ROOM_TYPES } from "@/domain/plan/schema";
import type { ExternalWallPreference, FloorMaterial, Level, RoomType } from "@/domain/plan/types";
import { describeEntity } from "@/domain/commands";
import { ROOM_FURNITURE } from "@/domain/furniture/catalog";
import { canFurnish } from "@/domain/furniture/furnish";
import { furnitureIssues } from "@/domain/furniture/issues";
import { furnitureInRoom } from "@/domain/furniture/layout";
import { Button, IconButton, Menu, MenuItem, NumberField, OptionalNumberField, SelectField, TextField } from "@/components/ui/controls";
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
  VariationsIcon,
  WindowIcon,
} from "@/components/ui/icons";
import { MATERIAL_SWATCH } from "../../rendering/konva/theme";
import { design, editor, useSessionState } from "../../state/editor";
import { FurnitureArt } from "../furniture/FurnitureArt";
import { pickFurniture } from "../shell/tools";
import { InspectorFrame, MoreSettings, run, Section } from "./frame";

export const ROOM_TYPE_OPTIONS: ReadonlyArray<{ value: RoomType; label: string }> = ROOM_TYPES.map((value) => ({
  value,
  label: ROOM_TYPE_LABEL[value],
}));

export const MATERIAL_LABEL: Record<FloorMaterial, string> = {
  timber: "Herringbone wood",
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

type Tab = "details" | "furniture" | "materials" | "ai";

/** A room is a whole object: its walls give it shape, this card gives it purpose. */
export function RoomInspector({ level, roomId, focusKey }: { level: Level; roomId: string; focusKey: number | null }) {
  const room = level.rooms[roomId];
  const workspace = useSessionState((s) => s.workspace);
  const [tab, setTab] = useState<Tab>("details");
  const region = deriveRoomRegions(level)[roomFaceIndices(level).get(roomId) ?? -1];
  const area = region?.clearArea ?? null;
  const designing = workspace === "design";
  const tabs: Tab[] = designing ? ["details", "furniture", "materials", "ai"] : ["details", "materials"];
  const pinned = room.locked === true;

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
            {area !== null ? formatArea(area) : "—"}
          </span>
          <span className="card-subtitle">{room.type === "unspecified" ? "Room" : ROOM_TYPE_LABEL[room.type]}</span>
        </>
      }
    >
      <div className="panel-tabs is-inset" role="tablist">
        {tabs.map((t) => (
          <button key={t} type="button" role="tab" aria-selected={tab === t} className={tab === t ? "is-active" : undefined} onClick={() => setTab(t)} data-testid={`room-tab-${t}`}>
            {t === "ai" ? "AI" : t[0].toUpperCase() + t.slice(1)}
          </button>
        ))}
      </div>
      {tab === "details" && <Details level={level} roomId={roomId} area={area} focusKey={focusKey} designing={designing} />}
      {tab === "furniture" && <RoomFurniture level={level} roomId={roomId} />}
      {tab === "materials" && <Materials roomId={roomId} value={room.floorMaterial ?? null} />}
      {tab === "ai" && (
        <>
          <RoomSuggestions roomId={roomId} type={room.type} />
          <RegenerateArea level={level} roomId={roomId} />
        </>
      )}
    </InspectorFrame>
  );
}

function Details({ level, roomId, area, focusKey, designing }: { level: Level; roomId: string; area: number | null; focusKey: number | null; designing: boolean }) {
  const room = level.rooms[roomId];
  const [targeting, setTargeting] = useState(false);
  const bounds = roomBounds(level, roomId);
  const setType = (type: RoomType) => {
    // Generated names follow the type ("Room 2" → "Bedroom 2"); names the user chose are kept.
    const rename = isGeneratedRoomName(room.name, room.type);
    run({ type: "updateRoom", roomId, changes: rename ? { type, name: suggestRoomName(level, roomId, type) } : { type } });
  };
  const resize = (dimension: "width" | "depth", size: number): true | string => {
    const command = roomResizeCommand(level, roomId, dimension, size);
    if (command === null) return true;
    return typeof command === "string" ? command : run(command);
  };
  const showTarget = targeting || room.targetArea !== undefined;
  return (
    <>
      <Section>
        <SelectField label="Room type" value={room.type} options={ROOM_TYPE_OPTIONS} testId="room-type" onChange={setType} />
        <TextField label="Name" value={room.name} autoFocusKey={focusKey} testId="room-name" onCommit={(name) => run({ type: "updateRoom", roomId, changes: { name } })} />
        <div className="field">
          <span className="field-label">Area</span>
          <div className="area-row">
            <span className="area-readout">{area !== null ? formatArea(area) : "—"}</span>
            {!showTarget && (
              <button type="button" className="btn btn-outline" onClick={() => setTargeting(true)} data-testid="set-target-area">
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
        <p className="field-hint">Changing the size moves a wall; the room next door gives or takes the space.</p>
        <MaterialSelect roomId={roomId} value={room.floorMaterial ?? null} />
      </Section>
      <Section title="Connections">
        <Connections level={level} roomId={roomId} />
      </Section>
      {designing && <RoomActions level={level} roomId={roomId} />}
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

/** What's in the room, and quick ways to lay it out or add to it. */
function RoomFurniture({ level, roomId }: { level: Level; roomId: string }) {
  const room = level.rooms[roomId];
  const items = furnitureInRoom(level, roomId);
  const problems = furnitureIssues(level);
  const standard = canFurnish(room.type);
  const usual = ROOM_FURNITURE[room.type] ?? [];
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
      {items.length > 0 && (
        <button type="button" className="link-btn" onClick={() => editor.clearFurniture(roomId)} data-testid="clear-room-furniture">
          Remove all furniture from this room
        </button>
      )}
    </Section>
  );
}

/** Floor finish with a swatch of the material. */
function MaterialSelect({ roomId, value }: { roomId: string; value: FloorMaterial | null }) {
  return (
    <div className="field">
      <label htmlFor={`finish-${roomId}`}>Floor finish</label>
      <div className="swatch-select">
        <span className="swatch" style={{ background: value ? MATERIAL_SWATCH[value] : undefined }} aria-hidden />
        <select
          id={`finish-${roomId}`}
          value={value ?? NOT_SET}
          data-testid="room-floor"
          onChange={(e) => {
            const v = e.currentTarget.value;
            run({ type: "updateRoom", roomId, changes: { floorMaterial: v === NOT_SET ? null : (v as FloorMaterial) } });
          }}
        >
          <option value={NOT_SET}>Not set</option>
          {FLOOR_MATERIALS.map((m) => (
            <option key={m} value={m}>
              {MATERIAL_LABEL[m]}
            </option>
          ))}
        </select>
        <ChevronDownIcon width={16} height={16} aria-hidden />
      </div>
    </div>
  );
}

function Materials({ roomId, value }: { roomId: string; value: FloorMaterial | null }) {
  return (
    <Section title="Floor finish">
      <div className="swatch-grid" role="radiogroup" aria-label="Floor finish">
        {FLOOR_MATERIALS.map((m) => (
          <button
            key={m}
            type="button"
            role="radio"
            aria-checked={value === m}
            className={value === m ? "is-active" : undefined}
            onClick={() => run({ type: "updateRoom", roomId, changes: { floorMaterial: value === m ? null : m } })}
            data-testid={`finish-${m}`}
          >
            <span className="swatch" style={{ background: MATERIAL_SWATCH[m] }} aria-hidden />
            {MATERIAL_LABEL[m]}
          </button>
        ))}
      </div>
      <p className="field-hint">Shown on the plan in Designs and on the floor in 3D.</p>
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

function RoomActions({ level, roomId }: { level: Level; roomId: string }) {
  const running = useSessionState((s) => s.designer.status === "running");
  const room = level.rooms[roomId];
  const others = Object.values(level.rooms).filter((r) => r.id !== roomId);
  return (
    <div className="card-section room-actions" data-testid="room-ai-actions">
      <h3>Room actions</h3>
      <button type="button" className="action-row" disabled={running} onClick={() => void design.openRoomVariations(roomId, suggestedGoals(room.type))} data-testid="redesign-room">
        <SparkleIcon width={18} height={18} /> Redesign this room
      </button>
      <button type="button" className="action-row" disabled={running} onClick={() => void design.openRoomVariations(roomId)} data-testid="room-variations">
        <VariationsIcon width={18} height={18} /> Generate variations
      </button>
      <Menu
        label="Swap with another room"
        testId="swap-room"
        className="swap-menu"
        summary={
          <span className="action-row">
            <SwapIcon width={18} height={18} /> Swap with another room
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

/** Goals that suit the room, each a request to the room planner. */
function RoomSuggestions({ roomId, type }: { roomId: string; type: RoomType }) {
  const running = useSessionState((s) => s.designer.status === "running");
  return (
    <Section title="Suggestions">
      <div className="suggestion-list">
        {suggestedGoals(type).map((goal) => (
          <button key={goal} type="button" className="suggestion-row" disabled={running} onClick={() => void design.redesignRoom(roomId, [goal])} data-testid={`suggest-${goal}`}>
            {ROOM_GOAL_LABEL[goal]}
            <ChevronRightIcon width={16} height={16} />
          </button>
        ))}
      </div>
      <p className="field-hint">Options appear in the AI Designer. Nothing changes until you apply one.</p>
      <button type="button" className="link-btn" onClick={() => editor.setDesigner({ panelOpen: true })}>
        Open the AI Designer
      </button>
    </Section>
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
