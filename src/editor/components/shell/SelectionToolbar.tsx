"use client";

import { useCallback, useState, type ReactNode } from "react";
import { turn } from "@/domain/furniture/geometry";
import type { Id } from "@/domain/plan/types";
import { Menu, MenuItem } from "@/components/ui/controls";
import { CopyIcon, DoorIcon, FlipHingeIcon, FlipSwingIcon, LeafIcon, RefreshIcon, SwapIcon, TargetIcon, TrashIcon, VariationsIcon, WindowIcon } from "@/components/ui/icons";
import { design, editor, useActiveLevel, useDocumentState, useSessionState } from "../../state/editor";
import { canEditPlan, displayedDocument, only3d, type Selection } from "../../state/stores";
import { toolController } from "../../tools/instance";
import { selectionAnchor, selectionBounds } from "../../viewport/anchor";
import { deleteSelection } from "../useKeyboardShortcuts";
import { addOpeningHere, centreOpening } from "./planActions";

/**
 * A small toolbar floating over whatever is selected on the plan, with what
 * people most often do next to that kind of thing: variations of a room, a
 * door in a wall, turning a piece of furniture. Everything here is also in
 * the inspector; this puts it where the eye already is.
 */
export function SelectionToolbar() {
  const editable = useSessionState((s) => canEditPlan(s) && !only3d(s));
  const selection = useSessionState((s) => s.selection);
  const viewport = useSessionState((s) => s.viewport);
  const tool = useSessionState((s) => s.tool);
  const drag = useSessionState((s) => s.drag);
  const plan = useDocumentState(displayedDocument);
  // An option on show isn't the plan: nothing to act on until it's applied or left.
  const staged = useDocumentState((s) => !!s.staged);
  const level = useActiveLevel(true);
  const [width, setWidth] = useState(160);
  // Measured on screen (again for each new selection, whose buttons differ), so it can be centred over it and kept inside the canvas.
  const key = selection ? `${selection.kind}:${selection.id}` : "";
  const bar = useCallback(
    (el: HTMLDivElement | null) => {
      const w = key && el?.offsetWidth;
      if (w) setWidth((current) => (Math.abs(w - current) > 1 ? w : current));
    },
    [key],
  );

  if (!editable || staged || tool !== "select" || drag || !selection) return null;
  const bounds = selectionBounds(level, plan, selection);
  if (!bounds) return null;
  const actions = actionsFor(selection, level);
  if (!actions) return null;
  const at = selectionAnchor(bounds, viewport, width);
  return (
    <div
      ref={bar}
      className="selection-toolbar floating"
      style={{ left: at.left, top: at.top }}
      role="toolbar"
      aria-label={LABEL[selection.kind]}
      data-testid={selection.kind === "room" ? "room-quickbar" : "selection-toolbar"}
    >
      {actions}
    </div>
  );
}

const LABEL: Record<NonNullable<Selection>["kind"], string> = { room: "Room", wall: "Wall", opening: "Door or window", furniture: "Furniture", stairs: "Stairs", house: "House" };

function Action({ label, onClick, children, disabled, testId, active }: { label: string; onClick: () => void; children: ReactNode; disabled?: boolean; testId?: string; active?: boolean }) {
  return (
    <button type="button" className={active ? "is-active" : undefined} aria-pressed={active} disabled={disabled} onClick={onClick} data-tooltip={label} data-tooltip-side="top" aria-label={label} data-testid={testId}>
      {children}
    </button>
  );
}

const Divider = () => <span className="selection-toolbar-divider" aria-hidden />;

function Delete({ label }: { label: string }) {
  return (
    <Action label={label} onClick={deleteSelection} testId="toolbar-delete">
      <TrashIcon width={18} height={18} />
    </Action>
  );
}

/** Opens the inspector on what's selected: for a room, on its sizes. */
function Edit({ room = false }: { room?: boolean }) {
  return (
    <button type="button" className="quick-text" onClick={() => editor.setPanels({ inspectorCollapsed: false, ...(room ? { inspectorTab: "dimensions" as const } : {}) })} data-testid="toolbar-edit">
      Edit
    </button>
  );
}

function actionsFor(selection: NonNullable<Selection>, level: ReturnType<typeof editor.activeLevel>): ReactNode {
  switch (selection.kind) {
    case "room":
      return <RoomActions roomId={selection.id} />;
    case "wall": {
      const wall = level.walls[selection.id];
      if (!wall) return null;
      const outside = wall.role === "external";
      const garden = level.rearWallId === wall.id;
      return (
        <>
          <Action label="Add a door here" onClick={() => addOpeningHere(wall.id, "door")} testId="toolbar-add-door">
            <DoorIcon width={18} height={18} />
          </Action>
          <Action label="Add a window here" onClick={() => addOpeningHere(wall.id, "window")} testId="toolbar-add-window">
            <WindowIcon width={18} height={18} />
          </Action>
          {outside && (
            <Action label={garden ? "This side faces the garden" : "Faces the garden"} active={garden} onClick={() => !garden && editor.dispatch({ type: "setRearWall", wallId: wall.id })} testId="toolbar-garden-side">
              <LeafIcon width={18} height={18} />
            </Action>
          )}
          <Divider />
          <Edit />
          {!outside && <Delete label="Delete wall" />}
        </>
      );
    }
    case "opening": {
      const opening = level.openings[selection.id];
      if (!opening) return null;
      return (
        <>
          {opening.kind === "door" && (
            <>
              <Action label="Hinge on the other side" onClick={() => editor.dispatch({ type: "updateOpening", openingId: opening.id, changes: { hinge: opening.hinge === "start" ? "end" : "start" } })} testId="toolbar-flip-hinge">
                <FlipHingeIcon width={18} height={18} />
              </Action>
              <Action label="Open into the other room" onClick={() => editor.dispatch({ type: "updateOpening", openingId: opening.id, changes: { swingSide: opening.swingSide === "left" ? "right" : "left" } })} testId="toolbar-flip-swing">
                <FlipSwingIcon width={18} height={18} />
              </Action>
            </>
          )}
          <Action label="Centre on the wall" onClick={() => centreOpening(opening)} testId="toolbar-centre">
            <TargetIcon width={18} height={18} />
          </Action>
          <Divider />
          <Edit />
          <Delete label={opening.kind === "door" ? "Delete door" : "Delete window"} />
        </>
      );
    }
    case "furniture":
      return (
        <>
          <Action label="Duplicate" onClick={() => editor.duplicateFurniture(selection.id)} testId="toolbar-duplicate">
            <CopyIcon width={18} height={18} />
          </Action>
          <Action label="Turn" onClick={() => editor.rotateFurniture(selection.id)} testId="toolbar-turn">
            <RefreshIcon width={18} height={18} />
          </Action>
          <Divider />
          <Edit />
          <Delete label="Delete" />
        </>
      );
    case "stairs": {
      const stairs = editor.current().staircases?.[selection.id];
      if (!stairs) return null;
      return (
        <>
          <Action label="Turn" onClick={() => editor.dispatch({ type: "updateStairs", staircaseId: stairs.id, changes: { rotation: turn(stairs.rotation, -1) } })} testId="toolbar-turn">
            <RefreshIcon width={18} height={18} />
          </Action>
          <Divider />
          <Edit />
          <Delete label="Delete stairs" />
        </>
      );
    }
    case "house":
      return null;
  }
}

function RoomActions({ roomId }: { roomId: Id }) {
  const running = useSessionState((s) => s.designer.status === "running");
  const level = useActiveLevel(true);
  const others = Object.values(level.rooms).filter((r) => r.id !== roomId);
  return (
    <>
      <Action label="Generate variations" disabled={running} onClick={() => void design.openRoomVariations(roomId)} testId="toolbar-variations">
        <VariationsIcon width={18} height={18} />
      </Action>
      <Menu label="Swap with another room" className="quick-swap" summary={<SwapIcon width={18} height={18} />}>
        {others.map((r) => (
          <MenuItem key={r.id} onSelect={() => design.swapRooms(roomId, r.id)}>
            Swap with {r.name}
          </MenuItem>
        ))}
      </Menu>
      <Action
        label="Zoom to room"
        onClick={() => {
          const b = selectionBounds(level, editor.current(), { kind: "room", id: roomId });
          if (b) toolController.zoomTo({ minX: b.minX - 1, minY: b.minY - 1, maxX: b.maxX + 1, maxY: b.maxY + 1 }, true);
        }}
        testId="toolbar-zoom"
      >
        <TargetIcon width={18} height={18} />
      </Action>
      <Divider />
      <Edit room />
    </>
  );
}
