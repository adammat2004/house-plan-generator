"use client";

import {
  Menu,
  MenuItem,
  SelectField,
  TextField,
} from "@/components/ui/controls";
import {
  ChevronDownIcon,
  DoorIcon,
  MinusIcon,
  PlusIcon,
  SwapIcon,
  WindowIcon,
} from "@/components/ui/icons";
import {
  isGeneratedRoomName,
  ROOM_TYPE_LABEL,
  suggestRoomName,
} from "@/domain/plan/rooms";
import { ROOM_TYPES } from "@/domain/plan/schema";
import type { Level, Opening, RoomType } from "@/domain/plan/types";
import {
  design,
  editor,
  useDocumentState,
  useSessionState,
} from "../../state/editor";
import { activeLevelOf, workingDocument } from "../../state/stores";
import { openingWall, removableOpening, resizeStep } from "../../simple/mode";
import { setRefineMode, useRefineMode } from "../../simple/useRefineMode";
import { addOpeningHere } from "../shell/planActions";

const TYPE_OPTIONS = ROOM_TYPES.map((value) => ({
  value,
  label: ROOM_TYPE_LABEL[value],
}));

/** Simple or Advanced, remembered in this browser. */
export function RefineModeToggle() {
  const mode = useRefineMode();
  return (
    <div
      className="refine-mode segmented"
      role="group"
      aria-label="Editing mode"
      data-testid="refine-mode"
    >
      {(["simple", "advanced"] as const).map((m) => (
        <button
          key={m}
          type="button"
          className={mode === m ? "is-active" : undefined}
          aria-pressed={mode === m}
          onClick={() => setRefineMode(m)}
          data-testid={`mode-${m}`}
        >
          {m === "simple" ? "Simple" : "Advanced"}
        </button>
      ))}
    </div>
  );
}

function OpeningRow({
  level,
  roomId,
  kind,
}: {
  level: Level;
  roomId: string;
  kind: Opening["kind"];
}) {
  const Icon = kind === "door" ? DoorIcon : WindowIcon;
  const removable = removableOpening(level, roomId, kind);
  const wallId = openingWall(level, roomId, kind);
  return (
    <div className="simple-row">
      <button
        type="button"
        className="action-row"
        disabled={!wallId}
        onClick={() => {
          if (!wallId) return;
          addOpeningHere(wallId, kind);
          // Adding selects the new opening; the room stays the thing being changed.
          editor.select({ kind: "room", id: roomId });
        }}
        data-testid={`simple-add-${kind}`}
      >
        <Icon width={18} height={18} /> Add a {kind}
      </button>
      <button
        type="button"
        className="action-row"
        disabled={!removable}
        onClick={() =>
          removable &&
          editor.dispatch({ type: "deleteOpening", openingId: removable })
        }
        data-testid={`simple-remove-${kind}`}
      >
        <MinusIcon width={18} height={18} /> Remove a {kind}
      </button>
    </div>
  );
}

function RoomCard({ level, roomId }: { level: Level; roomId: string }) {
  const room = level.rooms[roomId];
  const others = Object.values(level.rooms).filter((r) => r.id !== roomId);
  const resize = (direction: "bigger" | "smaller") => {
    const command = resizeStep(level, roomId, direction);
    if (typeof command === "string") editor.notify("info", command);
    else if (command) editor.dispatch(command);
    else editor.notify("info", "This room can't get any smaller.");
  };
  const setType = (type: RoomType) => {
    const rename = isGeneratedRoomName(room.name, room.type);
    editor.dispatch({
      type: "updateRoom",
      roomId,
      changes: rename
        ? { type, name: suggestRoomName(level, roomId, type) }
        : { type },
    });
  };
  const rename = (name: string) => {
    const result = editor.dispatch({
      type: "updateRoom",
      roomId,
      changes: { name },
    });
    return result.ok ? true : (result.issues[0]?.message ?? "Not valid");
  };
  return (
    <>
      <div className="card-section">
        <TextField
          label="Name"
          value={room.name}
          testId="simple-room-name"
          onCommit={rename}
        />
        <SelectField
          label="What it's used for"
          value={room.type}
          options={TYPE_OPTIONS}
          testId="simple-room-type"
          onChange={setType}
        />
      </div>
      <div className="card-section">
        <h3>Size</h3>
        <div className="simple-row">
          <button
            type="button"
            className="action-row"
            onClick={() => resize("bigger")}
            data-testid="simple-bigger"
          >
            <PlusIcon width={18} height={18} /> Make bigger
          </button>
          <button
            type="button"
            className="action-row"
            onClick={() => resize("smaller")}
            data-testid="simple-smaller"
          >
            <MinusIcon width={18} height={18} /> Make smaller
          </button>
        </div>
      </div>
      <div className="card-section">
        <h3>Swap places</h3>
        <Menu
          label="Swap with another room"
          testId="simple-swap"
          className="swap-menu"
          summary={
            <span className="action-row">
              <SwapIcon width={18} height={18} /> Swap with another room
              <ChevronDownIcon
                width={16}
                height={16}
                className="action-row-end"
              />
            </span>
          }
        >
          {others.map((r) => (
            <MenuItem
              key={r.id}
              onSelect={() => design.swapRooms(roomId, r.id)}
              data-testid={`simple-swap-with-${r.name}`}
            >
              {r.name}
            </MenuItem>
          ))}
        </Menu>
      </div>
      <div className="card-section">
        <h3>Doors and windows</h3>
        <OpeningRow level={level} roomId={roomId} kind="door" />
        <OpeningRow level={level} roomId={roomId} kind="window" />
      </div>
    </>
  );
}

/** Refine for everyone: pick a room, then a few big, friendly actions. */
export function SimpleRefine() {
  const plan = useDocumentState(workingDocument);
  const levelId = useSessionState((s) => s.activeLevelId);
  const level = activeLevelOf(plan, levelId);
  const selection = useSessionState((s) => s.selection);
  const roomId =
    selection?.kind === "room" && level.rooms[selection.id]
      ? selection.id
      : null;
  return (
    <aside
      className="inspector-card floating simple-card"
      aria-label="Change a room"
      data-testid="simple-panel"
    >
      {roomId ? (
        <RoomCard key={roomId} level={level} roomId={roomId} />
      ) : (
        <div className="card-section">
          <h3>Change a room</h3>
          <p className="field-hint">
            Click a room on the plan to rename it, resize it, swap it or add a
            door or window.
          </p>
        </div>
      )}
    </aside>
  );
}
