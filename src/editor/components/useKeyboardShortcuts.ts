"use client";

import { useEffect } from "react";
import { editor, editorStores } from "../state/editor";
import { toolController } from "../tools/instance";
import { STEPS } from "../state/steps";
import type { ToolId } from "../state/stores";
import { turn } from "@/domain/furniture/geometry";
import { inRefine } from "../state/stores";
import { selectionBounds } from "../viewport/anchor";
import { chooseView, goToStep, selectTool, VIEW_CHOICES } from "./shell/tools";

const TOOL_KEYS: Record<string, ToolId> = { v: "select", w: "wall", r: "room", d: "door", n: "window", u: "furniture", o: "outline", s: "stairs", e: "erase" };
/** Arrow keys nudge furniture by this much (m); with Shift, ten times as far. */
const NUDGE = 0.05;
const ARROWS: Record<string, [number, number]> = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, 1], ArrowDown: [0, -1] };

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
  const level = editor.activeLevel();
  if (!selection) return;
  if (selection.kind === "opening") editor.dispatch({ type: "deleteOpening", openingId: selection.id });
  else if (selection.kind === "wall") {
    if (level.walls[selection.id]?.role === "external") {
      editor.notify("info", "External walls make up the house outline and can't be deleted. Change the house's size or shape instead.");
    } else editor.dispatch({ type: "deleteWall", wallId: selection.id });
  } else if (selection.kind === "furniture") editor.dispatch({ type: "deleteFurniture", furnitureId: selection.id });
  else if (selection.kind === "stairs") editor.dispatch({ type: "deleteStairs", staircaseId: selection.id });
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
      // Phones look but don't edit: only moving around the plan and between steps works there.
      const edits = !editorStores.session.getState().readOnly;
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
      if (edits && mod && key === "d" && furnitureId) {
        e.preventDefault();
        editor.duplicateFurniture(furnitureId);
        return;
      }
      if (mod || e.altKey) return;
      // Shift+1, 2, 3: the 2D plan, the 3D view, or the plan furnished (by key position, whatever the layout prints on it).
      const viewIndex = e.shiftKey && /^Digit[123]$/.test(e.code) ? Number(e.code.slice(5)) - 1 : -1;
      if (viewIndex >= 0) {
        const s = editorStores.session.getState();
        if (!e.repeat && (inRefine(s) || s.workspace === "review")) {
          e.preventDefault();
          chooseView(VIEW_CHOICES[viewIndex].value);
        }
        return;
      }
      if (edits && ARROWS[e.key] && furnitureId && !toolController.isGestureActive()) {
        e.preventDefault();
        const [dx, dy] = ARROWS[e.key];
        const step = e.shiftKey ? NUDGE * 10 : NUDGE;
        editor.nudgeFurniture(furnitureId, dx * step, dy * step);
        return;
      }
      if (edits && e.shiftKey && key === "r" && !e.repeat) {
        // Turns the selected piece, or the one the Furniture tool is about to place.
        const s = editorStores.session.getState();
        const stairs = selection?.kind === "stairs" ? editor.current().staircases?.[selection.id] : undefined;
        if (furnitureId) editor.rotateFurniture(furnitureId);
        else if (stairs) editor.dispatch({ type: "updateStairs", staircaseId: stairs.id, changes: { rotation: turn(stairs.rotation, -1) } });
        else if (s.tool === "furniture") {
          editorStores.session.setState({ settings: { ...s.settings, furniture: { ...s.settings.furniture, rotation: turn(s.settings.furniture.rotation, -1) } } });
        } else if (s.tool === "stairs") {
          editorStores.session.setState({ settings: { ...s.settings, stairs: { ...s.settings.stairs, rotation: turn(s.settings.stairs.rotation, -1) } }, stairsDraft: null });
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
        // Putting a camera down: stop.
        if (editorStores.session.getState().cameraPick) {
          editorStores.session.setState({ cameraPick: null });
          return;
        }
        // An option on show goes first: back to the plan as it is.
        if (editorStores.documents.getState().staged) {
          editor.unstage();
          return;
        }
        // Comparing plans: back to the plan.
        if (editorStores.session.getState().designView === "compare") {
          editor.setDesignView("plan");
          return;
        }
        if (!toolController.cancel() && editorStores.session.getState().tool !== "select") selectTool("select");
        return;
      }
      if (editorStores.session.getState().tool === "outline" && (e.key === "Enter" || e.key === "Backspace")) {
        e.preventDefault();
        if (e.key === "Enter") toolController.finishOutline();
        else toolController.undoOutlineCorner();
        return;
      }
      if (edits && (e.key === "Delete" || e.key === "Backspace")) {
        if (toolController.isGestureActive()) return;
        e.preventDefault();
        deleteSelection();
        return;
      }
      if (edits && TOOL_KEYS[key] && !e.repeat) {
        // Stairs need a floor to go up to.
        if (TOOL_KEYS[key] === "stairs" && editor.current().levels.length < 2) return;
        selectTool(TOOL_KEYS[key]);
        return;
      }
      if (e.key === "PageUp" || e.key === "PageDown") {
        // Up a floor, or down one.
        const plan = editor.current();
        const i = plan.levels.findIndex((l) => l.id === editor.activeLevel().id) + (e.key === "PageUp" ? 1 : -1);
        if (plan.levels.length > 1 && i >= 0 && i < plan.levels.length) {
          e.preventDefault();
          editor.setActiveLevel(plan.levels[i].id);
        }
        return;
      }
      if (key === "l" && !e.repeat) {
        const { layersOpen } = editorStores.session.getState().panels;
        editor.setPanels({ layersOpen: !layersOpen });
        return;
      }
      const step = STEPS.find((st) => st.key === key);
      if (step && !e.repeat) {
        goToStep(step.id);
        return;
      }
      if (key === "f" && e.shiftKey) {
        // Shift+F: in close on what's picked.
        const s = editorStores.session.getState();
        const b = selectionBounds(editor.activeLevel(), editor.current(), s.selection);
        if (b) toolController.zoomTo({ minX: b.minX - 1.5, minY: b.minY - 1.5, maxX: b.maxX + 1.5, maxY: b.maxY + 1.5 }, true);
      } else if (key === "f") toolController.fitPlan(true);
      else if (key === "+" || key === "=") toolController.zoomBy(1.25, true);
      else if (key === "-" || key === "_") toolController.zoomBy(1 / 1.25, true);
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
