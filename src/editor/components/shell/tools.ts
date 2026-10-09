import { ArmchairIcon, DoorIcon, OutlineIcon, RoomIcon, SelectIcon, WallIcon, WindowIcon } from "@/components/ui/icons";
import { design, editor, editorStores } from "../../state/editor";
import type { FurnitureKind } from "@/domain/plan/types";
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
  {
    id: "outline",
    label: "Outline",
    key: "O",
    Icon: OutlineIcon,
    hint: "Click the outside corners of the house; walls run straight across or up. Click the first corner or press Enter to finish, Backspace to undo a corner.",
  },
  { id: "door", label: "Door", key: "D", Icon: DoorIcon, hint: "Hover a wall to preview, click to place a door." },
  { id: "window", label: "Window", key: "N", Icon: WindowIcon, hint: "Hover a wall to preview, click to place a window." },
  {
    id: "furniture",
    label: "Furniture",
    key: "U",
    Icon: ArmchairIcon,
    hint: "Pick a piece, then click in a room to place it. It turns to sit against the nearest wall; hold Alt to place it freely, Shift+R to turn it.",
  },
];

/** Tools offered in each workspace. Design works with whole rooms; the brief shows the plan for reference. */
export const WORKSPACE_TOOLS: Record<Workspace, ReadonlyArray<ToolId>> = {
  structure: ["select", "room", "wall", "outline", "door", "window"],
  brief: [],
  design: ["select", "room", "wall", "door", "furniture"],
  present: [],
};

export const WORKSPACE_HINT: Partial<Record<Workspace, string>> = {
  design: "Click a room or a piece of furniture to work on it. Drag furniture, inside walls, doors and windows to move them.",
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
  if (id === "furniture") requestAnimationFrame(() => toolController.revealBesideCatalog());
}

/** Opens the Furniture tool with a piece chosen, keeping the plan clear of the catalog. */
export function pickFurniture(kind: FurnitureKind) {
  editor.chooseFurniture(kind);
  requestAnimationFrame(() => toolController.revealBesideCatalog());
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

/** Runs Generate from the Rooms step, opening the concepts when layouts come back. */
export async function generateFromRooms() {
  const ids = await design.generateLayouts();
  if (ids.length) selectWorkspace("design");
}

/**
 * The top bar's Next: Structure → Rooms → Design → 3D. From Rooms it
 * generates layouts; in Design it opens the focused concept in 3D.
 */
export async function nextStep() {
  const s = editorStores.session.getState();
  if (s.workspace === "structure") selectWorkspace("brief");
  else if (s.workspace === "brief") await generateFromRooms();
  else if (s.workspace === "design") {
    const focus = s.designer.focusPlanId;
    if (s.designView === "board" && focus) editor.switchPlan(focus);
    selectWorkspace("present");
  }
}
