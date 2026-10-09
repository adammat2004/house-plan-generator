"use client";

import { useEffect } from "react";
import { editor, editorStores } from "../state/editor";
import { toolController } from "../tools/instance";
import type { ToolId, Workspace } from "../state/stores";
import { turn } from "@/domain/furniture/geometry";
import { selectTool, selectWorkspace } from "./shell/tools";

const TOOL_KEYS: Record<string, ToolId> = { v: "select", w: "wall", r: "room", d: "door", n: "window", u: "furniture", o: "outline" };
/** Arrow keys nudge furniture by this much (m); with Shift, ten times as far. */
const NUDGE = 0.05;
const ARROWS: Record<string, [number, number]> = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, 1], ArrowDown: [0, -1] };
const WORKSPACE_KEYS: Record<string, Workspace> = { "1": "structure", "2": "brief", "3": "design", "4": "present" };

function isTextInput(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  const tag = target.tagName;
  if (tag === "TEXTAREA" || tag === "SELECT") return true;
  if (tag === "INPUT") {
    const type = (target as HTMLInputElement).type;
    return !["checkbox", "radio", "button", "submit", "range", "file"].includes(type);
  }
  return false;
}

export function deleteSelection() {
  const selection = editorStores.session.getState().selection;
  const level = editor.current().levels[0];
  if (!selection) return;
  if (selection.kind === "opening") editor.dispatch({ type: "deleteOpening", openingId: selection.id });
  else if (selection.kind === "wall") {
    if (level.walls[selection.id]?.role === "external") {
      editor.notify("info", "External walls make up the house outline and can't be deleted. Change the house's size or shape instead.");
    } else editor.dispatch({ type: "deleteWall", wallId: selection.id });
  } else if (selection.kind === "furniture") editor.dispatch({ type: "deleteFurniture", furnitureId: selection.id });
  else if (selection.kind === "room") editor.notify("info", "Rooms come from their walls. Delete a wall to merge rooms.");
}

/** Global shortcuts. Never intercepts typing in text fields. */
export function useKeyboardShortcuts() {
  useEffect(() => {
    const isMac = /Mac|iPhone|iPad/.test(navigator.platform);
    const onKeyDown = (e: KeyboardEvent) => {
      if (isTextInput(e.target)) return;
      if (editorStores.session.getState().createDialogOpen) return;
      const mod = isMac ? e.metaKey : e.ctrlKey;
      const key = e.key.toLowerCase();
      if (mod && key === "z") {
        e.preventDefault();
        if (e.shiftKey) editor.redo();
        else editor.undo();
        return;
      }
      if (mod && key === "y" && !isMac) {
        e.preventDefault();
        editor.redo();
        return;
      }
      const selection = editorStores.session.getState().selection;
      const furnitureId = selection?.kind === "furniture" ? selection.id : null;
      if (mod && key === "d" && furnitureId) {
        e.preventDefault();
        editor.duplicateFurniture(furnitureId);
        return;
      }
      if (mod || e.altKey) return;
      if (ARROWS[e.key] && furnitureId && !toolController.isGestureActive()) {
        e.preventDefault();
        const [dx, dy] = ARROWS[e.key];
        const step = e.shiftKey ? NUDGE * 10 : NUDGE;
        editor.nudgeFurniture(furnitureId, dx * step, dy * step);
        return;
      }
      if (e.shiftKey && key === "r" && !e.repeat) {
        // Turns the selected piece, or the one the Furniture tool is about to place.
        const s = editorStores.session.getState();
        if (furnitureId) editor.rotateFurniture(furnitureId);
        else if (s.tool === "furniture") {
          editorStores.session.setState({ settings: { ...s.settings, furniture: { ...s.settings.furniture, rotation: turn(s.settings.furniture.rotation, -1) } } });
        }
        return;
      }
      if (e.key === " ") {
        // Space still activates focused buttons and menus.
        if (e.target instanceof HTMLElement && e.target.closest("button, summary, a, [role='menuitem']")) return;
        if (!e.repeat) toolController.setSpaceHeld(true);
        e.preventDefault();
        return;
      }
      if (e.key === "Escape") {
        if (!toolController.cancel() && editorStores.session.getState().tool !== "select") selectTool("select");
        return;
      }
      if (editorStores.session.getState().tool === "outline" && (e.key === "Enter" || e.key === "Backspace")) {
        e.preventDefault();
        if (e.key === "Enter") toolController.finishOutline();
        else toolController.undoOutlineCorner();
        return;
      }
      if (e.key === "Delete" || e.key === "Backspace") {
        if (toolController.isGestureActive()) return;
        e.preventDefault();
        deleteSelection();
        return;
      }
      if (TOOL_KEYS[key] && !e.repeat) {
        selectTool(TOOL_KEYS[key]);
        return;
      }
      if (key === "l" && !e.repeat) {
        const { layersOpen } = editorStores.session.getState().panels;
        editor.setPanels({ layersOpen: !layersOpen });
        return;
      }
      if (WORKSPACE_KEYS[key] && !e.repeat) {
        selectWorkspace(WORKSPACE_KEYS[key]);
        return;
      }
      if (key === "f") toolController.fitPlan();
      else if (key === "+" || key === "=") toolController.zoomBy(1.25);
      else if (key === "-" || key === "_") toolController.zoomBy(1 / 1.25);
    };
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.key === " ") toolController.setSpaceHeld(false);
    };
    const onBlur = () => toolController.setSpaceHeld(false);
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    window.addEventListener("blur", onBlur);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
      window.removeEventListener("blur", onBlur);
    };
  }, []);
}
