import { ArmchairIcon, DoorIcon, OutlineIcon, RoomIcon, SelectIcon, StairsIcon, WallIcon, WindowIcon } from "@/components/ui/icons";
import { design, editor, editorStores } from "../../state/editor";
import type { FurnitureKind } from "@/domain/plan/types";
import { stepAvailable, stepOf, type Step } from "../../state/steps";
import { hasFurniture, inRefine, only3d, type PlanView, type SessionState, type ToolId, type Workspace } from "../../state/stores";
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
  { id: "room", label: "Rooms", key: "R", Icon: RoomIcon, hint: "Click inside an enclosed room to name it and set its use." },
  { id: "wall", label: "Walls", key: "W", Icon: WallIcon, hint: "Click a start point, then click to place each end. Esc finishes the chain." },
  {
    id: "outline",
    label: "House outline",
    key: "O",
    Icon: OutlineIcon,
    hint: "Click the outside corners of the house; walls run straight across or up. Click the first corner or press Enter to finish, Backspace to undo a corner.",
  },
  { id: "door", label: "Doors", key: "D", Icon: DoorIcon, hint: "Hover a wall to preview, click to place a door." },
  { id: "window", label: "Windows", key: "N", Icon: WindowIcon, hint: "Hover a wall to preview, click to place a window." },
  {
    id: "furniture",
    label: "Furniture",
    key: "U",
    Icon: ArmchairIcon,
    hint: "Pick a piece, then click in a room to place it. It turns to sit against the nearest wall; hold Alt to place it freely, Shift+R to turn it.",
  },
  {
    id: "stairs",
    label: "Stairs",
    key: "S",
    Icon: StairsIcon,
    hint: "Click to place stairs up to the next floor; they settle against a wall when close. Shift+R turns them before you place them.",
  },
];

/** Tools that need more than one floor. */
export const MULTI_FLOOR_TOOLS: ReadonlySet<ToolId> = new Set(["stairs"]);

const ALL_TOOLS: ReadonlyArray<ToolId> = TOOLS.map((t) => t.id);
const NO_TOOLS: ReadonlyArray<ToolId> = [];

/**
 * Every tool works in Refine (and from room variations, which they leave for
 * the plan) while the plan is on show; elsewhere, and under the 3D view, the
 * plan is for looking at.
 */
export function toolsFor(s: Pick<SessionState, "workspace" | "designView" | "show3d" | "view3d">): ReadonlyArray<ToolId> {
  return s.workspace === "design" && s.designView !== "board" && s.designView !== "compare" && !only3d(s) ? ALL_TOOLS : NO_TOOLS;
}

export function selectTool(id: ToolId) {
  toolController.reset();
  const s = editorStores.session.getState();
  // On the concept board, picking a tool opens the focused concept to work on; from variations, back to the plan.
  if (s.workspace === "design" && s.designView === "board") openConcept(s.designer.focusPlanId ?? editorStores.project.getState().activePlanId);
  else if (s.workspace === "design" && s.designView === "variations") editor.setDesignView("plan");
  // Tools work on the plan, so one picked over the 3D view brings the plan back.
  if (id !== "select" && only3d(editorStores.session.getState())) editor.setShow3d(false);
  editor.setTool(id);
  if (id === "furniture") requestAnimationFrame(() => toolController.revealBesideCatalog());
}

/** The three ways to see a plan: the 2D plan, the 3D view, or the plan furnished. */
export type ViewChoice = PlanView | "3d";

export const VIEW_CHOICES: ReadonlyArray<{ value: ViewChoice; label: string; key: string }> = [
  { value: "plan", label: "2D Plan", key: "⇧1" },
  { value: "3d", label: "3D View", key: "⇧2" },
  { value: "furnished", label: "Furnished", key: "⇧3" },
];

export const viewChoiceOf = (s: Pick<SessionState, "show3d" | "view">): ViewChoice => (s.show3d ? "3d" : s.view);

/** The user's pick of view; Refine keeps it from then on. */
export function chooseView(view: ViewChoice) {
  toolController.reset();
  const before = editorStores.session.getState();
  if (view === "3d") editor.setShow3d(true);
  else {
    editor.setShow3d(false);
    editor.setView(view, true);
  }
  // Side by side, the plan has half the canvas: reframe it when that changes.
  const after = editorStores.session.getState();
  if (before.view3d.split && before.show3d !== after.show3d) requestAnimationFrame(() => toolController.fitPlan());
}

/** The 3D view beside the plan, or over it. Side by side there's no room for its settings, so they fold away (the 3D bar reopens them). */
export function setSplit(split: boolean) {
  toolController.reset();
  editor.setView3d(split ? { split, panelOpen: false } : { split });
  if (!split) editor.setShow3d(true);
  requestAnimationFrame(() => toolController.fitPlan());
}

/** Opens the Furniture tool with a piece chosen, keeping the plan clear of the catalog. */
export function pickFurniture(kind: FurnitureKind) {
  if (only3d(editorStores.session.getState())) editor.setShow3d(false);
  editor.chooseFurniture(kind);
  requestAnimationFrame(() => toolController.revealBesideCatalog());
}

/** Opens a plan in Refine: furnished when it has furniture, unless the user has picked a view. */
export function openConcept(planId: string) {
  editor.switchPlan(planId);
  if (editorStores.session.getState().workspace !== "design") editor.setWorkspace("design");
  editor.setDesignView("plan");
  if (!editorStores.session.getState().viewChosen) editor.setView(hasFurniture(editor.current()) ? "furnished" : "plan");
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
  // Each step's panels cover a different part of the canvas, so reframe the plan beside them.
  requestAnimationFrame(() => toolController.fitPlan());
}

/** Generate from Requirements: opens Explore straight away (it shows the work in progress), then makes the layouts. */
export async function generateFromRooms() {
  if (editorStores.session.getState().workspace !== "design") selectWorkspace("design");
  else showConcepts();
  await design.generateLayouts();
}

/** Opens the plan in Refine without its furniture, to work on walls, doors and windows. */
export function editWalls() {
  const s = editorStores.session.getState();
  if (!inRefine(s)) openConcept(editorStores.project.getState().activePlanId);
  chooseView("plan");
}

/** Goes to one of the five steps, if it has something to show. */
export function goToStep(step: Step) {
  const s = editorStores.session.getState();
  if (!stepAvailable(editorStores.project.getState(), step) || stepOf(s) === step) return;
  switch (step) {
    case "map":
      selectWorkspace("site");
      return;
    case "requirements":
      selectWorkspace("brief");
      return;
    case "explore":
      if (s.workspace === "design") showConcepts();
      else selectWorkspace("design");
      return;
    case "refine":
      openConcept(s.designer.focusPlanId ?? editorStores.project.getState().activePlanId);
      return;
    case "review":
      // From Explore, the layout in focus is the one reviewed.
      if (s.workspace === "design" && s.designView === "board" && s.designer.focusPlanId) editor.switchPlan(s.designer.focusPlanId);
      selectWorkspace("review");
      return;
  }
}
