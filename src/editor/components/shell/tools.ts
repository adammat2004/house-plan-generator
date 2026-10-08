import { DoorIcon, RoomIcon, SelectIcon, WallIcon, WindowIcon } from "@/components/ui/icons";
import { editor, editorStores } from "../../state/editor";
import type { ToolId, Workspace } from "../../state/stores";
import { toolController } from "../../tools/instance";

export interface ToolDef {
  id: ToolId;
  label: string;
  key: string;
  Icon: typeof SelectIcon;
  hint: string;
}

export const TOOLS: ReadonlyArray<ToolDef> = [
  { id: "select", label: "Select", key: "V", Icon: SelectIcon, hint: "Click to select. Drag walls, wall ends, doors and windows to edit them." },
  { id: "room", label: "Room", key: "R", Icon: RoomIcon, hint: "Click inside an enclosed room to name it and set its use." },
  { id: "wall", label: "Wall", key: "W", Icon: WallIcon, hint: "Click a start point, then click to place each end. Esc finishes the chain." },
  { id: "door", label: "Door", key: "D", Icon: DoorIcon, hint: "Hover a wall to preview, click to place a door." },
  { id: "window", label: "Window", key: "N", Icon: WindowIcon, hint: "Hover a wall to preview, click to place a window." },
];

/** Tools offered in each workspace. Design works with whole rooms; the brief shows the plan for reference. */
export const WORKSPACE_TOOLS: Record<Workspace, ReadonlyArray<ToolId>> = {
  structure: ["select", "room", "wall", "door", "window"],
  brief: [],
  design: ["select", "room", "wall", "door"],
  present: [],
};

export const WORKSPACE_HINT: Partial<Record<Workspace, string>> = {
  design: "Click a room to work on it. Draw walls and doors to refine the layout.",
  brief: "Your plan is shown for reference. Drag to pan.",
  present: "Click a room to look at it in 3D.",
};

export function selectTool(id: ToolId) {
  toolController.reset();
  const s = editorStores.session.getState();
  // On the concept board, picking a tool opens the focused concept to work on; from variations, back to the plan.
  if (s.workspace === "design" && s.designView === "board") openConcept(s.designer.focusPlanId ?? editorStores.project.getState().activePlanId);
  else if (s.workspace === "design" && s.designView === "variations") editor.setDesignView("plan");
  editor.setTool(id);
}

/** Opens a plan in Designs for refining. */
export function openConcept(planId: string) {
  editor.switchPlan(planId);
  if (editorStores.session.getState().workspace !== "design") editor.setWorkspace("design");
  editor.setDesignView("plan");
  editor.setDesigner({ focusPlanId: planId });
  requestAnimationFrame(() => toolController.fitPlan());
}

/** Back from a plan to the side-by-side concepts. */
export function showConcepts() {
  toolController.reset();
  editor.setDesignView("board");
}

export function selectWorkspace(workspace: Workspace) {
  const was = editorStores.session.getState().workspace;
  toolController.reset();
  if (was === "design" && workspace === "design") {
    showConcepts();
    return;
  }
  editor.setWorkspace(workspace);
  // The brief panel and the 3D view cover part of the canvas, so reframe the plan beside them.
  const framed = (w: Workspace) => w === "brief" || w === "present";
  if (framed(was) || framed(workspace)) requestAnimationFrame(() => toolController.fitPlan());
}
