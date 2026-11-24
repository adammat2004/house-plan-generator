import { createStore, type StoreApi } from "zustand/vanilla";
import { normaliseBrief, type HouseBrief } from "@/domain/brief/schema";
import { applyCommand, type CommandResult, type PlanCommand, type PlanIssue } from "@/domain/commands";
import { DEFAULT_HOUSE, DOOR_PRESET, STAIR_PRESET, WINDOW_PRESET } from "@/domain/plan/defaults";
import type { RoomGoal } from "@/domain/design/intent";
import type { ProposalImpact } from "@/domain/design/impact";
import { FURNITURE_CATALOG } from "@/domain/furniture/catalog";
import { furnishPlanCommand, furnishRoom } from "@/domain/furniture/furnish";
import { furnitureInRoom } from "@/domain/furniture/layout";
import { levelKeepOut } from "@/domain/geometry/stairs";
import { turn } from "@/domain/furniture/geometry";
import { changedLevelId, levelById, levelIndex, levelOf, storeyName } from "@/domain/plan/levels";
import type { Furniture, FurnitureKind, FurnitureRotation, Id, Level, PlanDocument, Point2, Staircase, StairShape } from "@/domain/plan/types";
import {
  DEFAULT_APPEARANCE,
  MAX_PLANS,
  nextPlanLabel,
  PROJECT_FORMAT,
  PROJECT_SCHEMA_VERSION,
  projectFromPlan,
  type Appearance,
  type Sizing,
  type PlanVariantMeta,
  type ProjectDetails,
  type ProjectDocument,
} from "@/domain/project/schema";
import type { Site } from "@/domain/project/site";
import { applyExteriorPreset, setExteriorAppearance, type ExteriorChange, type ExteriorPresetId } from "@/domain/project/exterior";
import { DEFAULT_VIEWPORT, type Viewport } from "../viewport/viewport";
import { createHistory, pushHistory, redoHistory, undoHistory, type History } from "./history";
import { newIdPrefix } from "./ids";

/** "house" selects the envelope as a whole; its id is the level id. "stairs" are a staircase, by its id. */
export type EntityKind = "wall" | "opening" | "room" | "house" | "furniture" | "stairs";
export type Selection = { kind: EntityKind; id: Id } | null;
export type ToolId = "select" | "wall" | "room" | "door" | "window" | "furniture" | "outline" | "stairs" | "erase";

/** A house outline being drawn: outside-face corners so far, and where the next one would go. */
export interface OutlineDraft {
  points: Point2[];
  cursor: Point2 | null;
  /** Why the outline, closed now, wouldn't make a house; null when it would. */
  problem: string | null;
}
/**
 * Same canvas, different jobs, one per step: Site (Map) places the house on
 * its plot, Brief (Requirements) collects what the house needs, Design holds
 * the layouts (Explore) and Refine (one plan, every part of it editable), and
 * Review sums the chosen design up. Outside Refine the plan is for looking at.
 */
export type Workspace = "site" | "brief" | "design" | "review";

/**
 * How Refine and Review draw the plan: "plan" is the plan without furniture,
 * for working on the layout; "furnished" adds the furniture, which can then
 * be picked and moved. Walls, doors and windows can be edited in both. The
 * 3D view (`show3d`) goes over either, or beside it when split.
 */
export type PlanView = "plan" | "furnished";
export type CameraMode = "orbit" | "pan" | "walk" | "interior" | "aerial" | "exterior";
/**
 * Where the Map step is in its wizard. Session-only: it isn't the real
 * site data (`ProjectState.site`), only which screen to show. "ask" is the
 * opening choice; it's skipped once the project already has a dream plot or
 * a traced site, so returning to Map goes straight back to where you were.
 */
export interface SiteUiState {
  mode: "ask" | "dream" | "trace";
  /** Which guided task is open, while `mode` is "trace". */
  stage: "find" | "trace" | "road" | "entrance" | "wastewater" | "done";
  /** Set by SiteMap when the satellite map itself can't load, so the legacy plot form fills in (design review R4). */
  mapFailed: boolean;
}

export const DEFAULT_SITE_UI: SiteUiState = { mode: "ask", stage: "find", mapFailed: false };

export type LightingPreset = "morning" | "midday" | "evening" | "night";

/** How the 3D view is set up. Session-only: the house's look itself is in the project's appearance. */
export interface View3DState {
  /** The 3D view beside the plan rather than over it. */
  split: boolean;
  camera: CameraMode;
  /** Bumped to ask the camera to reframe even when the mode is unchanged. */
  cameraKey: number;
  /** The room the interior camera stands in (else the selected or largest day room). */
  interiorRoomId: Id | null;
  display: { roof: boolean; cutaway: boolean; dimensions: boolean; landscape: boolean; furniture: boolean };
  /** In a house of several floors, the highest floor shown (the cutaway cuts it); every floor when null. */
  upTo: Id | null;
  lighting: LightingPreset;
  shadows: boolean;
  /** Turns the sun around the house, degrees. */
  sunAzimuth: number;
  ground: "lawn" | "gravel" | "paving";
  sky: "clear" | "overcast";
  panelTab: "camera" | "look" | "show";
  panelOpen: boolean;
  /** How many exterior look changes (a style preset, a finish) can be taken back with `undoLook`. */
  lookUndoDepth: number;
}

export const DEFAULT_VIEW3D: View3DState = {
  split: false,
  camera: "orbit",
  cameraKey: 0,
  interiorRoomId: null,
  display: { roof: false, cutaway: false, dimensions: false, landscape: true, furniture: true },
  upTo: null,
  lighting: "midday",
  shadows: true,
  sunAzimuth: 0,
  ground: "lawn",
  sky: "clear",
  panelTab: "camera",
  panelOpen: true,
  lookUndoDepth: 0,
};
export type DragKind = "drag-wall" | "drag-end" | "drag-opening" | "drag-opening-edge" | "drag-furniture" | "drag-furniture-size" | "drag-outline" | "drag-corner" | "drag-stairs";

/** A line drawn while dragging to show what the dragged thing lines up with, in world metres. */
export interface Guide {
  a: Point2;
  b: Point2;
}

/** The room inspector's tabs; see RoomInspector. */
export type InspectorTab = "design" | "furniture" | "dimensions" | "connections";

export interface PanelState {
  inspectorCollapsed: boolean;
  layersOpen: boolean;
  /** A tab asked for from outside the inspector (the selection toolbar's Edit); the inspector opens it, then clears this. */
  inspectorTab: InspectorTab | null;
}

/**
 * Project-level state around the plan being edited: the brief and the
 * alternative plans. The active plan's undo history lives in the document
 * store; the other plans keep theirs here, so switching plans never loses
 * undo steps.
 */
export interface ProjectState {
  id: Id;
  name: string;
  brief: HouseBrief;
  details: ProjectDetails | undefined;
  appearance: Appearance | undefined;
  /** Where generated layouts get their house size; undefined means the user's own house. */
  sizing: Sizing | undefined;
  /** The plot, its gaps and north (Map); undefined until set. */
  site: Site | undefined;
  /** Ordered as shown in the variation tray. */
  plans: PlanVariantMeta[];
  activePlanId: Id;
  parked: Record<Id, History>;
  /** Increments on every project-level change (brief, plans, names). */
  revision: number;
}

/** A room-level change offered in the AI Designer, applied only when the user asks. */
export interface Proposal {
  id: string;
  /** Short name, e.g. "Larger kitchen". */
  title: string;
  summary: string;
  goal?: RoomGoal;
  /** The planner's key for this option, so "more" never repeats it. */
  variant?: string;
  document: PlanDocument;
  roomIds: Id[];
  /** The plan it was made from; once the plan changes, the proposal is stale. */
  source: PlanDocument;
  /** "saved" once kept as a plan of its own. Whether it's applied is worked out from the history (design.statusOf), so undo puts it back. */
  state: "open" | "applied" | "saved";
  /** What it changes, measured on the plans (null when the room can't be followed). */
  impact?: ProposalImpact | null;
  /** "A", "B", "C" among the options shown together. */
  letter?: string;
}

/**
 * An option shown on the plan without becoming part of it: the canvas, the
 * inspector and 3D draw `document`, while the history, autosave and undo
 * stay on the plan as it is. Nothing can be edited until it's applied or
 * left; changing the plan any other way leaves it.
 */
export interface Staged {
  proposalId: string;
  document: PlanDocument;
  /** The plan it was made from: it's only shown while that is the plan. */
  source: PlanDocument;
  roomIds: Id[];
  /** "B · Open plan", and the size change, for the banner. */
  title: string;
  delta: string | null;
  /** True while "hold to compare" shows the plan as it is. */
  peek: boolean;
}

export interface ChatMessage {
  id: number;
  role: "user" | "assistant";
  text: string;
  proposals?: Proposal[];
  /** Offer to generate new layouts after the brief changed. */
  offerGenerate?: boolean;
}

export interface DesignerState {
  status: "idle" | "running";
  /** What the last request produced, shown in the brief. */
  lastResult: { tone: "success" | "info" | "error"; message: string; notes: string[]; /** Offer to size houses from the rooms instead. */ offerAutoSize?: boolean } | null;
  /** The concept shown in the board's detail panel. */
  focusPlanId: Id | null;
  /** The AI Designer panel beside a plan in Designs. */
  panelOpen: boolean;
  chat: ChatMessage[];
  /** Whether Claude reads requests ("available"), or the built-in rules do ("off"). */
  ai: "unknown" | "available" | "off";
  /** The last whole-plan generation, for the Layouts page (see design.ts). Null before any. */
  generation: Generation | null;
}

/**
 * One run of "make layouts". Every run ends in done, nofit or failed:
 *
 *   reading (notes, AI on) ─▶ planning ─┬─▶ done    layouts added
 *        │ AI fails: noted, carries on ─┤
 *   (no notes / AI off) ───────────────▶├─▶ nofit   the rooms don't fit; message says why
 *                                       └─▶ failed  something broke; layouts already there stay
 */
export interface Generation {
  phase: "reading" | "planning" | "done" | "nofit" | "failed";
  /** ms since epoch; the Layouts page shows its loading state for at least a moment from here. */
  startedAt: number;
  message?: string;
}

/**
 * Designs shows every concept side by side, one concept opened for refining,
 * or one room of it beside its variations.
 */
export type DesignView = "board" | "plan" | "variations" | "compare";

/** "Generate variations" on a room: the current room beside alternatives to it. */
export interface VariationsState {
  roomId: Id;
  /** The plan the options were made from; applying requires it to still be current. */
  source: PlanDocument;
  options: Proposal[];
  /** The option shown in the detail panel ("current" for the room as it is). */
  focusId: string;
  /** Two options (or "current") side by side. */
  compare: [string, string] | null;
}

export interface Notice {
  id: number;
  tone: "error" | "info" | "success";
  message: string;
  entityIds: Id[];
}

export interface Preview {
  document: PlanDocument;
  /** Why the latest pointer position couldn't be applied; the preview shows the last valid state. */
  issue: PlanIssue | null;
  changed: boolean;
  createdIds: Id[];
}

export interface DocumentState {
  history: History;
  preview: Preview | null;
  staged: Staged | null;
  notice: Notice | null;
  /** Increments on every committed change (edits, undo, redo, load). */
  revision: number;
}

export type SnapKind = "endpoint" | "junction" | "wall" | "centre" | "grid" | "free";

export interface SnapIndicator {
  point: Point2;
  kind: SnapKind;
}

export interface WallDraft {
  start: Point2;
  end: Point2;
  valid: boolean;
}

export interface OpeningDraft {
  wallId: Id;
  kind: "door" | "window";
  offset: number;
  width: number;
  valid: boolean;
  message: string | null;
}

/** The piece the Furniture tool is about to place, following the pointer. */
export interface FurnitureDraft {
  item: Omit<Furniture, "id">;
  /** Where it would land is clear of walls, doors and other pieces. */
  clear: boolean;
}

/** Stairs the Stairs tool would place, and whether they'd fit there. */
export interface StairsDraft {
  staircase: Staircase;
  valid: boolean;
  message: string | null;
}

export interface Settings {
  snapEnabled: boolean;
  gridVisible: boolean;
  gridSize: number;
  internalThickness: number;
  door: { width: number; height: number };
  window: { width: number; height: number; sillHeight: number };
  /** What the Furniture tool places, and which way free-standing pieces face. */
  furniture: { kind: FurnitureKind; rotation: FurnitureRotation };
  /** What the Stairs tool places. */
  stairs: { shape: StairShape; turn: "left" | "right"; rotation: FurnitureRotation; width: number; going: number };
}

export interface SessionState {
  /** The floor shown on the plan and edited; null (or a floor that's gone) is the ground floor. */
  activeLevelId: Id | null;
  workspace: Workspace;
  designView: DesignView;
  /** Refine's view of the plan; see PlanView. */
  view: PlanView;
  /** Set once the user picks a view, after which Refine stops choosing one for them. */
  viewChosen: boolean;
  /** The house in 3D, over the plan (or beside it when `view3d.split`), in Refine and Review. */
  show3d: boolean;
  variations: VariationsState | null;
  /** The two plans side by side in "compare", left and right. */
  comparePlans: [Id, Id] | null;
  view3d: View3DState;
  site: SiteUiState;
  tool: ToolId;
  /** Rooms brushed over with the Erase tool, to be laid out again together. */
  erased: Id[];
  /** The Furnish & Render panel is open over Refine. */
  renderOpen: boolean;
  /** Putting a camera down on the plan: waiting for where it stands (eye null), then for what it looks at. */
  cameraPick: { eye: Point2 | null } | null;
  /** Cameras put down this session, newest first, for the Furnish & Render panel. */
  cameraSpots: Array<{ id: string; roomId: Id; eye: Point2; look: Point2 }>;
  selection: Selection;
  hover: Selection;
  viewport: Viewport;
  /** True while the view is as Fit left it; any manual pan or zoom clears it, and only a fitted view refits itself. */
  viewportFitted: boolean;
  /** The scale Fit last chose, for showing zoom as a percentage. */
  fitScale: number | null;
  settings: Settings;
  cursor: Point2 | null;
  snap: SnapIndicator | null;
  /** Alignment lines while a drag snaps to something in line with it. */
  guides: Guide[];
  wallDraft: WallDraft | null;
  openingDraft: OpeningDraft | null;
  furnitureDraft: FurnitureDraft | null;
  stairsDraft: StairsDraft | null;
  outlineDraft: OutlineDraft | null;
  /** A drawn outline waiting for the user to confirm it replaces a house with rooms in it. */
  outlineConfirm: { outline: Point2[] } | null;
  panning: boolean;
  /** The drag gesture in progress, if any (drives live measurement overlays). */
  drag: DragKind | null;
  panels: PanelState;
  designer: DesignerState;
  /** Set once the saved plan (if any) has been loaded. */
  ready: boolean;
  createDialogOpen: boolean;
  /** Bumped when the Room tool picks a room, so the inspector focuses its name. */
  roomNameFocus: number | null;
  /**
   * Plans can be looked at but not changed: touch-only phones (see
   * `readOnlyQuery` in shell/phone.ts). The brief, the plot and switching
   * plans still work.
   */
  readOnly: boolean;
}

export interface EditorStores {
  documents: StoreApi<DocumentState>;
  session: StoreApi<SessionState>;
  project: StoreApi<ProjectState>;
}

const now = () => new Date().toISOString();

/** Splits a project into the active plan's history and parked histories for the rest. */
function projectState(project: ProjectDocument, revision: number): { project: ProjectState; active: PlanDocument } {
  const active = project.plans.find((p) => p.id === project.activePlanId) ?? project.plans[0];
  const parked: Record<Id, History> = {};
  for (const plan of project.plans) if (plan.id !== active.id) parked[plan.id] = createHistory(plan.document);
  return {
    active: active.document,
    project: {
      id: project.id,
      name: project.name,
      brief: project.brief,
      details: project.details,
      appearance: project.appearance,
      sizing: project.sizing,
      site: project.site,
      plans: project.plans.map(({ id, label, parentId, origin, scope, createdAt }) => ({ id, label, parentId, origin, scope, createdAt })),
      activePlanId: active.id,
      parked,
      revision,
    },
  };
}

export function createEditorStores(initial: PlanDocument | ProjectDocument): EditorStores {
  const start = "format" in initial ? initial : projectFromPlan(initial, { now: now() });
  const { project: initialProject, active } = projectState(start, 0);
  const project = createStore<ProjectState>(() => initialProject);
  /** The looks before each exterior change, newest last; session only, like the 3D view's other settings. */
  const lookUndo: Appearance[] = [];
  function changeLook(next: (current: Appearance | undefined) => Appearance) {
    const before = project.getState().appearance ?? DEFAULT_APPEARANCE;
    const after = next(before);
    if (JSON.stringify(after) === JSON.stringify(before)) return;
    lookUndo.push(before);
    if (lookUndo.length > 30) lookUndo.shift();
    project.setState((p) => ({ appearance: after, revision: p.revision + 1 }));
    session.setState((s) => ({ view3d: { ...s.view3d, lookUndoDepth: lookUndo.length } }));
  }
  const documents = createStore<DocumentState>(() => ({
    history: createHistory(active),
    preview: null,
    staged: null,
    notice: null,
    revision: 0,
  }));
  const session = createStore<SessionState>(() => ({
    activeLevelId: null,
    workspace: "design",
    designView: "plan",
    view: "plan",
    viewChosen: false,
    show3d: false,
    variations: null,
    comparePlans: null,
    view3d: DEFAULT_VIEW3D,
    site: DEFAULT_SITE_UI,
    tool: "select",
    erased: [],
    renderOpen: false,
    cameraPick: null,
    cameraSpots: [],
    selection: null,
    hover: null,
    viewport: DEFAULT_VIEWPORT,
    viewportFitted: false,
    fitScale: null,
    settings: {
      snapEnabled: true,
      gridVisible: true,
      gridSize: 0.1,
      internalThickness: DEFAULT_HOUSE.internalThickness,
      door: { ...DOOR_PRESET },
      window: { ...WINDOW_PRESET },
      furniture: { kind: "sofa_3", rotation: 0 },
      stairs: { shape: "straight", turn: "right", rotation: 0, width: STAIR_PRESET.width, going: STAIR_PRESET.going },
    },
    cursor: null,
    snap: null,
    guides: [],
    wallDraft: null,
    openingDraft: null,
    furnitureDraft: null,
    stairsDraft: null,
    outlineDraft: null,
    outlineConfirm: null,
    panning: false,
    drag: null,
    panels: { inspectorCollapsed: false, layersOpen: false, inspectorTab: null },
    // The AI Designer starts folded away, so the plan has the room; asking for anything opens it.
    designer: { status: "idle", lastResult: null, focusPlanId: null, panelOpen: false, chat: [], ai: "unknown", generation: null },
    ready: false,
    createDialogOpen: false,
    roomNameFocus: null,
    readOnly: false,
  }));
  return { documents, session, project };
}

/** The whole project as saved and exported: every plan's committed document. */
export function projectDocument({ documents, project }: Pick<EditorStores, "documents" | "project">): ProjectDocument {
  const p = project.getState();
  const present = documents.getState().history.present;
  return {
    format: PROJECT_FORMAT,
    schemaVersion: PROJECT_SCHEMA_VERSION,
    id: p.id,
    name: p.name,
    brief: p.brief,
    ...(p.details ? { details: p.details } : {}),
    ...(p.appearance ? { appearance: p.appearance } : {}),
    ...(p.sizing ? { sizing: p.sizing } : {}),
    ...(p.site ? { site: p.site } : {}),
    activePlanId: p.activePlanId,
    plans: p.plans.map((meta) => ({ ...meta, document: meta.id === p.activePlanId ? present : p.parked[meta.id].present })),
  };
}

/** The floor being edited: the one chosen, if the plan has it, else the ground floor. */
export const activeLevelOf = (doc: PlanDocument, levelId: Id | null): Level => (levelId ? levelById(doc, levelId) : undefined) ?? doc.levels[0];

/** Commands that make something without naming what they act on: they act on the floor being edited. */
const ON_ACTIVE_FLOOR: ReadonlySet<PlanCommand["type"]> = new Set(["addWall", "addFurniture", "createOutline"]);

let noticeCounter = 0;

/** Refine: one plan open, with every part of it editable. */
export const inRefine = (s: Pick<SessionState, "workspace" | "designView">) => s.workspace === "design" && s.designView === "plan";

/**
 * Whether the plan is drawn schematically: the 2D Plan view in Refine and
 * Review, rooms filled by their use. Elsewhere (and in Furnished) the plan
 * shows its floor finishes, furniture and garden.
 */
export const showsSchematic = (s: Pick<SessionState, "workspace" | "designView" | "view">) => s.view === "plan" && (inRefine(s) || s.workspace === "review");

/** Whether the 3D view is on show: in Refine and Review, when chosen. */
export const in3d = (s: Pick<SessionState, "workspace" | "designView" | "show3d">) => s.show3d && (inRefine(s) || s.workspace === "review");

/** Whether the 3D view covers the whole canvas, leaving no plan to work on. */
export const only3d = (s: Pick<SessionState, "workspace" | "designView" | "show3d" | "view3d">) => in3d(s) && !s.view3d.split;

/** Whether the plan on show can be changed now: in Refine, with the plan in view, on a device that edits. */
export const canEditPlan = (s: Pick<SessionState, "workspace" | "designView" | "readOnly" | "show3d" | "view3d">) => !s.readOnly && inRefine(s) && !only3d(s);

/** Whether a plan holds any furniture, on any floor; Refine opens furnished when it does. */
export const hasFurniture = (doc: PlanDocument) => doc.levels.some((l) => Object.keys(l.furniture).length > 0);

/**
 * Editor operations coordinating the document history with session state.
 * Everything here is framework-free so it can run in tests.
 */
export function createEditorActions({ documents, session, project }: EditorStores) {
  const current = () => documents.getState().history.present;

  const notify = (tone: Notice["tone"], message: string, entityIds: Id[] = []) => {
    documents.setState({ notice: { id: ++noticeCounter, tone, message, entityIds } });
  };

  const reportFailure = (result: CommandResult) => {
    if (!result.ok) notify("error", result.issues[0]?.message ?? "That edit isn't valid.", result.issues[0]?.entityIds ?? []);
  };

  const activeLevel = () => activeLevelOf(current(), session.getState().activeLevelId);

  /** Drops the selection or hover if the entity is no longer on the floor being edited, and the floor if it's gone. */
  const reconcileSelection = (doc: PlanDocument) => {
    const { activeLevelId } = session.getState();
    if (activeLevelId && !levelById(doc, activeLevelId)) session.setState({ activeLevelId: null });
    const level = activeLevelOf(doc, session.getState().activeLevelId);
    const exists = (s: Selection) =>
      !s ||
      (s.kind === "wall" && !!level.walls[s.id]) ||
      (s.kind === "opening" && !!level.openings[s.id]) ||
      (s.kind === "room" && !!level.rooms[s.id]) ||
      (s.kind === "furniture" && !!level.furniture[s.id]) ||
      (s.kind === "house" && level.id === s.id) ||
      (s.kind === "stairs" && !!doc.staircases?.[s.id]);
    const { selection, hover } = session.getState();
    if (!exists(selection) || !exists(hover)) {
      session.setState({ selection: exists(selection) ? selection : null, hover: exists(hover) ? hover : null });
    }
  };

  /** Shows a floor; drops anything half-done on the one before. */
  const showLevel = (levelId: Id | null) => {
    if (session.getState().activeLevelId === levelId) return;
    if (documents.getState().preview) documents.setState({ preview: null });
    session.setState({ activeLevelId: levelId, selection: null, hover: null, erased: [], wallDraft: null, openingDraft: null, furnitureDraft: null, stairsDraft: null, outlineDraft: null, snap: null, drag: null });
  };

  /** After undo or redo, shows the floor that changed, and says so. */
  const followChange = (before: PlanDocument, after: PlanDocument, verb: string) => {
    if (after.levels.length < 2) return;
    const changed = changedLevelId(before, after);
    if (!changed || changed === activeLevel().id) return;
    showLevel(changed === after.levels[0].id ? null : changed);
    notify("info", `${verb} on the ${storeyName(levelIndex(after, changed)).toLowerCase()}.`);
  };

  const readOnly = () => session.getState().readOnly;
  const READ_ONLY: CommandResult = { ok: false, issues: [{ code: "read-only", message: "Editing works on a computer.", entityIds: [] }] };
  const STAGED: CommandResult = { ok: false, issues: [{ code: "read-only", message: "Apply the option on show, or go back to your plan, to make other changes.", entityIds: [] }] };
  const staged = () => documents.getState().staged;
  const unstage = () => {
    if (documents.getState().staged) documents.setState({ staged: null });
  };

  /** Every plan change lands here (dispatch and gestures); undo and redo check the same gate. */
  const commit = (next: PlanDocument): boolean => {
    if (staged()) return false;
    if (readOnly()) {
      if (documents.getState().preview) documents.setState({ preview: null });
      return false;
    }
    const state = documents.getState();
    documents.setState({
      history: pushHistory(state.history, next),
      preview: null,
      revision: state.revision + 1,
    });
    reconcileSelection(next);
    return true;
  };

  const withPrefix = (command: PlanCommand): PlanCommand =>
    command.idPrefix ? command : { ...command, idPrefix: newIdPrefix() };

  /** On a house of several floors, what the command makes goes on the floor being edited. */
  const onActiveFloor = (command: PlanCommand): PlanCommand => {
    if (command.levelId !== undefined || current().levels.length < 2) return command;
    const creates = ON_ACTIVE_FLOOR.has(command.type) || (command.type === "replaceFurniture" && Array.isArray(command.remove) && command.remove.length === 0);
    return creates ? { ...command, levelId: activeLevel().id } : command;
  };

  /**
   * Switches Refine between the plan and the furnished plan. Leaving the
   * furniture behind drops anything to do with it: the selection, the
   * Furniture tool and the piece it was about to place. `chosen` marks the
   * user's own pick, after which Refine keeps it.
   */
  const setView = (view: PlanView, chosen = false) => {
    const s = session.getState();
    if (chosen && !s.viewChosen) session.setState({ viewChosen: true });
    if (s.view === view) return;
    if (view === "plan") {
      if (documents.getState().preview) documents.setState({ preview: null });
      session.setState({
        view,
        ...(s.selection?.kind === "furniture" ? { selection: null } : {}),
        ...(s.hover?.kind === "furniture" ? { hover: null } : {}),
        ...(s.tool === "furniture" ? { tool: "select" as ToolId } : {}),
        furnitureDraft: null,
      });
    } else session.setState({ view });
  };

  return {
    current,
    activeLevel,
    notify,
    setView,

    clearNotice() {
      documents.setState({ notice: null });
    },

    /** Applies and commits a command as one undoable history entry. */
    dispatch(command: PlanCommand): CommandResult {
      const result = applyCommand(current(), withPrefix(onActiveFloor(command)));
      if (!result.ok) {
        reportFailure(result);
        return result;
      }
      if (result.changed && !commit(result.document)) return staged() ? STAGED : READ_ONLY;
      if (documents.getState().notice?.tone === "error") documents.setState({ notice: null });
      return result;
    },

    /**
     * Validates a gesture step without committing. Invalid steps keep the
     * last valid preview on screen and record why the step was refused.
     */
    preview(command: PlanCommand): CommandResult {
      if (readOnly()) return READ_ONLY;
      if (staged()) return STAGED;
      const result = applyCommand(current(), onActiveFloor(command));
      const previous = documents.getState().preview;
      if (result.ok) {
        documents.setState({
          preview: { document: result.document, issue: null, changed: result.changed, createdIds: result.createdIds },
        });
      } else {
        documents.setState({
          preview: {
            document: previous?.document ?? current(),
            issue: result.issues[0] ?? null,
            changed: previous?.changed ?? false,
            createdIds: previous?.createdIds ?? [],
          },
        });
      }
      return result;
    },

    /** Commits the previewed state as a single history entry. */
    commitPreview(): boolean {
      const preview = documents.getState().preview;
      if (!preview) return false;
      const committing = preview.changed && preview.document !== current();
      if (preview.issue) notify(committing ? "info" : "error", preview.issue.message, preview.issue.entityIds);
      if (!committing) {
        documents.setState({ preview: null });
        return false;
      }
      return commit(preview.document);
    },

    cancelPreview() {
      if (documents.getState().preview) documents.setState({ preview: null });
    },

    undo(): boolean {
      const state = documents.getState();
      // Undo first leaves an option on show, which was never part of the plan.
      if (state.staged) {
        unstage();
        return true;
      }
      if (readOnly() || state.preview || state.history.past.length === 0) return false;
      const history = undoHistory(state.history);
      documents.setState({ history, revision: state.revision + 1, notice: null });
      reconcileSelection(history.present);
      followChange(state.history.present, history.present, "Undone");
      return true;
    },

    redo(): boolean {
      const state = documents.getState();
      if (readOnly() || state.preview || state.staged || state.history.future.length === 0) return false;
      const history = redoHistory(state.history);
      documents.setState({ history, revision: state.revision + 1, notice: null });
      reconcileSelection(history.present);
      followChange(state.history.present, history.present, "Redone");
      return true;
    },

    /** Shows and edits another floor (null is the ground floor). Looking works on phones too. */
    setActiveLevel(levelId: Id | null) {
      const doc = current();
      const target = levelId ? levelById(doc, levelId) : undefined;
      showLevel(!target || target.id === doc.levels[0].id ? null : target.id);
    },

    /** Adds a floor on top, over the whole of the one below, and shows it. */
    addFloor(): CommandResult {
      const result = this.dispatch({ type: "addLevel" });
      if (result.ok && result.changed) {
        const added = result.document.levels[result.document.levels.length - 1];
        showLevel(added.id);
        notify("success", `Added the ${added.name.toLowerCase()}. Draw its walls, then put in stairs.`);
      }
      return result;
    },

    /** Removes a floor and what's on it, as one change you can undo. */
    removeFloor(levelId: Id): CommandResult {
      const name = levelById(current(), levelId)?.name;
      const result = this.dispatch({ type: "removeLevel", levelId });
      if (result.ok && result.changed) notify("success", `Removed the ${(name ?? "floor").toLowerCase()}. Undo to bring it back.`);
      return result;
    },

    /** Starts a new single-plan project from a document, without an undo entry. */
    load(doc: PlanDocument) {
      this.loadProject(projectFromPlan(doc, { now: now(), brief: project.getState().brief }));
    },

    /** Replaces the whole project (startup, opening a project file, recovery). Not undoable. */
    loadProject(next: ProjectDocument) {
      const { project: state, active } = projectState(next, project.getState().revision + 1);
      project.setState(state, true);
      documents.setState((s) => ({ history: createHistory(active), preview: null, staged: null, revision: s.revision + 1 }));
      session.setState({ activeLevelId: null, selection: null, hover: null, erased: [], wallDraft: null, openingDraft: null, furnitureDraft: null, stairsDraft: null, snap: null, drag: null });
    },

    renameProject(name: string): true | string {
      const trimmed = name.trim();
      if (!trimmed) return "Project name can't be empty.";
      if (trimmed.length > 200) return "Project name must be at most 200 characters.";
      if (trimmed !== project.getState().name) project.setState((p) => ({ name: trimmed, revision: p.revision + 1 }));
      return true;
    },

    setBrief(brief: HouseBrief) {
      const next = normaliseBrief(brief);
      if (JSON.stringify(next) !== JSON.stringify(project.getState().brief)) {
        project.setState((p) => ({ brief: next, revision: p.revision + 1 }));
      }
    },

    /** Makes another plan the one being edited. Each plan keeps its own undo history. */
    switchPlan(planId: Id): boolean {
      const p = project.getState();
      if (planId === p.activePlanId || !p.parked[planId]) return false;
      const state = documents.getState();
      const parked = { ...p.parked, [p.activePlanId]: state.history };
      const history = parked[planId];
      delete parked[planId];
      // The same floor of the other plan, if it has one.
      const floor = levelIndex(state.history.present, activeLevel().id);
      const sameFloor = floor > 0 ? history.present.levels[floor]?.id : undefined;
      project.setState({ activePlanId: planId, parked, revision: p.revision + 1 });
      documents.setState({ history, preview: null, staged: null, revision: state.revision + 1, notice: null });
      session.setState({ activeLevelId: sameFloor ?? null, selection: null, hover: null, erased: [], wallDraft: null, openingDraft: null, furnitureDraft: null, stairsDraft: null, snap: null, drag: null });
      return true;
    },

    /**
     * Adds plans next to the existing ones, never replacing any. The first
     * added plan becomes active unless `activate` is false.
     */
    addPlans(entries: Array<{ meta: Omit<PlanVariantMeta, "id" | "label" | "createdAt">; document: PlanDocument; label?: string }>, activate = true): Id[] {
      const p = project.getState();
      if (p.plans.length + entries.length > MAX_PLANS) {
        notify("error", `A project can hold up to ${MAX_PLANS} plans. Delete some variations first.`);
        return [];
      }
      const labels = p.plans.map((plan) => plan.label);
      const ids = new Set([...p.plans.map((plan) => plan.id)]);
      const added: PlanVariantMeta[] = [];
      const parked = { ...p.parked };
      for (const entry of entries) {
        let id = entry.document.id;
        while (ids.has(id)) id = `${entry.document.id}-${newIdPrefix()}`;
        ids.add(id);
        const label = entry.label ?? nextPlanLabel(labels);
        labels.push(label);
        added.push({ ...entry.meta, id, label, createdAt: now() });
        parked[id] = createHistory(entry.document.id === id ? entry.document : { ...entry.document, id });
      }
      project.setState({ plans: [...p.plans, ...added], parked, revision: p.revision + 1 });
      if (activate && added[0]) this.switchPlan(added[0].id);
      return added.map((a) => a.id);
    },

    /** "+ Variation": copies a plan (the active one by default) as a new plan derived from it. */
    duplicatePlan(planId?: Id, activate = true): Id | null {
      const p = project.getState();
      const from = planId ?? p.activePlanId;
      const source = from === p.activePlanId ? documents.getState().history.present : p.parked[from]?.present;
      if (!source) return null;
      const [id] = this.addPlans(
        [{ meta: { parentId: from, origin: { kind: "user" }, scope: { kind: "plan" } }, document: { ...source, id: `${from}-v${newIdPrefix()}` } }],
        activate,
      );
      return id ?? null;
    },

    /** A plan's committed document, whether or not it is the one being edited. */
    planDocument(planId: Id): PlanDocument | null {
      const p = project.getState();
      return planId === p.activePlanId ? documents.getState().history.present : (p.parked[planId]?.present ?? null);
    },

    /** Whether a plan has been edited since it was created or loaded. */
    planEdited(planId: Id): boolean {
      const p = project.getState();
      return planId === p.activePlanId ? documents.getState().history.past.length > 0 : (p.parked[planId]?.past.length ?? 0) > 0;
    },

    renamePlan(planId: Id, label: string): true | string {
      const trimmed = label.trim();
      if (!trimmed || trimmed.length > 60) return "Use 1–60 characters.";
      project.setState((p) => ({ plans: p.plans.map((plan) => (plan.id === planId ? { ...plan, label: trimmed } : plan)), revision: p.revision + 1 }));
      return true;
    },

    /** Removes a plan. The last plan can't be deleted; children are re-parented to its parent. */
    deletePlan(planId: Id): boolean {
      const p = project.getState();
      const target = p.plans.find((plan) => plan.id === planId);
      if (!target || p.plans.length <= 1) return false;
      if (planId === p.activePlanId) {
        const index = p.plans.indexOf(target);
        const fallback = p.plans.find((plan) => plan.id === target.parentId) ?? p.plans[index === 0 ? 1 : index - 1];
        this.switchPlan(fallback.id);
      }
      const q = project.getState();
      const parked = { ...q.parked };
      delete parked[planId];
      project.setState({
        plans: q.plans.filter((plan) => plan.id !== planId).map((plan) => (plan.parentId === planId ? { ...plan, parentId: target.parentId } : plan)),
        parked,
        revision: q.revision + 1,
      });
      return true;
    },

    /** Selects something on the plan. Furniture shows only when furnished, so picking a piece shows it. */
    select(selection: Selection) {
      if (selection?.kind === "furniture") setView("furnished");
      session.setState({ selection });
    },

    /** The rooms brushed with Erase. */
    setErased(erased: Id[]) {
      session.setState({ erased });
    },

    /** Opens or closes the Furnish & Render panel. */
    setRenderOpen(renderOpen: boolean) {
      session.setState({ renderOpen });
    },

    setTool(tool: ToolId) {
      // Only Refine edits; elsewhere the plan is for looking at, as it is while an option is on show.
      if (tool !== "select" && (!canEditPlan(session.getState()) || staged())) return;
      if (documents.getState().preview) documents.setState({ preview: null });
      // Furniture is placed where it can be seen.
      if (tool === "furniture") setView("furnished");
      session.setState({ tool, erased: [], wallDraft: null, openingDraft: null, furnitureDraft: null, stairsDraft: null, outlineDraft: null, snap: null, hover: null });
    },

    /** Touch-only phones look but don't edit. Turning it on drops any gesture in progress. */
    setReadOnly(on: boolean) {
      if (session.getState().readOnly === on) return;
      if (!on) return session.setState({ readOnly: false });
      if (documents.getState().preview) documents.setState({ preview: null });
      session.setState({ readOnly: true, tool: "select", drag: null, wallDraft: null, openingDraft: null, furnitureDraft: null, stairsDraft: null, outlineDraft: null, snap: null });
    },

    setWorkspace(workspace: Workspace) {
      const s = session.getState();
      if (s.workspace === workspace) return;
      if (documents.getState().preview) documents.setState({ preview: null });
      unstage();
      // A room stays picked going to Review (whose plan picks rooms); Refine keeps anything.
      const keep = !!s.selection && (workspace === "design" || (workspace === "review" && s.selection.kind === "room"));
      session.setState({
        workspace,
        // Designs opens on the side-by-side comparison.
        designView: "board",
        variations: null,
        comparePlans: null,
        tool: "select",
        selection: keep ? s.selection : null,
        hover: null,
        wallDraft: null,
        openingDraft: null,
        furnitureDraft: null,
        stairsDraft: null,
        outlineDraft: null,
        snap: null,
        drag: null,
      });
    },

    setDesignView(designView: DesignView) {
      if (documents.getState().preview) documents.setState({ preview: null });
      if (designView !== "plan") unstage();
      session.setState({
        designView,
        hover: null,
        wallDraft: null,
        openingDraft: null,
        furnitureDraft: null,
        stairsDraft: null,
        snap: null,
        drag: null,
        ...(designView !== "variations" ? { variations: null } : { tool: "select" as ToolId }),
        ...(designView !== "compare" ? { comparePlans: null } : { tool: "select" as ToolId, selection: null }),
        ...(designView === "board" ? { selection: null, tool: "select" as ToolId } : {}),
      });
    },

    /** Shows an option on the plan without changing the plan (see Staged). */
    stage(next: Omit<Staged, "peek">) {
      if (documents.getState().preview) documents.setState({ preview: null });
      documents.setState({ staged: { ...next, peek: false } });
    },

    /** Back to the plan as it is. */
    unstage,

    /** "Hold to compare": the plan as it is while held, the option again on release. */
    peekStaged(peek: boolean) {
      const s = documents.getState().staged;
      if (s && s.peek !== peek) documents.setState({ staged: { ...s, peek } });
    },

    setView3d(patch: Partial<View3DState>) {
      session.setState((s) => ({ view3d: { ...s.view3d, ...patch } }));
    },

    setSiteUi(patch: Partial<SiteUiState>) {
      session.setState((s) => ({ site: { ...s.site, ...patch } }));
    },

    /** Shows the house in 3D, or the plan again. Covering the plan drops any tool or gesture in progress. */
    setShow3d(show3d: boolean) {
      const s = session.getState();
      if (s.show3d === show3d) return;
      if (show3d && !s.view3d.split) {
        if (documents.getState().preview) documents.setState({ preview: null });
        session.setState({ show3d, tool: "select", hover: null, drag: null, wallDraft: null, openingDraft: null, furnitureDraft: null, stairsDraft: null, outlineDraft: null, snap: null });
      } else session.setState({ show3d });
    },

    /** Switches between sizing houses from the rooms and using the user's own house. */
    setSizing(sizing: Sizing | undefined) {
      project.setState((p) => ({ sizing, revision: p.revision + 1 }));
    },

    /** The plot, its gaps and north. */
    setSite(site: Site | undefined) {
      project.setState((p) => ({ site, revision: p.revision + 1 }));
    },

    setAppearance(patch: Partial<Appearance>) {
      project.setState((p) => ({ appearance: { ...DEFAULT_APPEARANCE, ...p.appearance, ...patch }, revision: p.revision + 1 }));
    },

    /** Applies a whole exterior style preset as one step that `undoLook` takes back. */
    applyExteriorPreset(id: ExteriorPresetId) {
      changeLook((a) => applyExteriorPreset(a, id));
    },

    /** A validated exterior edit (roof shape and finish stay consistent, pitch stays in range); one step for `undoLook`. */
    setExterior(change: ExteriorChange) {
      changeLook((a) => setExteriorAppearance(a, change));
    },

    /** Takes back the last exterior change. False when there is none. */
    undoLook(): boolean {
      const before = lookUndo.pop();
      if (!before) return false;
      project.setState((p) => ({ appearance: before, revision: p.revision + 1 }));
      session.setState((s) => ({ view3d: { ...s.view3d, lookUndoDepth: lookUndo.length } }));
      return true;
    },

    /** Sets every wall on a floor (the ground floor by default) and its ceiling height, as one undoable step; floors above restack. */
    setWallHeights(height: number, levelId?: Id): CommandResult {
      return this.dispatch({ type: "updateLevel", wallHeight: height, ...(levelId ? { levelId } : {}) });
    },

    /** Picks what the Furniture tool places and switches to it. */
    chooseFurniture(kind: FurnitureKind) {
      session.setState((s) => ({ settings: { ...s.settings, furniture: { ...s.settings.furniture, kind } } }));
      this.setTool("furniture");
    },

    /** Turns a piece of furniture a quarter turn about its centre: clockwise (−1) or counterclockwise (+1). */
    rotateFurniture(furnitureId: Id, direction: 1 | -1 = -1): CommandResult | null {
      const item = levelOf(current(), furnitureId)?.furniture[furnitureId];
      if (!item) return null;
      return this.dispatch({ type: "updateFurniture", furnitureId, changes: { rotation: turn(item.rotation, direction) } });
    },

    /** Moves a piece of furniture by a small step, one undo entry per nudge. */
    nudgeFurniture(furnitureId: Id, dx: number, dy: number): CommandResult | null {
      const item = levelOf(current(), furnitureId)?.furniture[furnitureId];
      if (!item) return null;
      return this.dispatch({ type: "updateFurniture", furnitureId, changes: { position: { x: item.position.x + dx, y: item.position.y + dy } } });
    },

    /** Copies a piece beside the original and selects the copy. */
    duplicateFurniture(furnitureId: Id): Id | null {
      const level = levelOf(current(), furnitureId);
      const item = level?.furniture[furnitureId];
      if (!level || !item) return null;
      const id = `${newIdPrefix()}-furniture`;
      const result = this.dispatch({ type: "addFurniture", levelId: level.id, item: { ...item, id, position: { x: item.position.x + 0.3, y: item.position.y - 0.3 } } });
      if (!result.ok) return null;
      this.select({ kind: "furniture", id });
      return id;
    },

    /** Lays out every room on the floor being edited again (or only empty rooms), as one undoable step. */
    furnishAll(replace: boolean, quiet = false): number {
      const command = furnishPlanCommand(current(), newIdPrefix(), replace, activeLevel().id);
      if (!command) {
        if (!quiet) notify("info", "Every room already has furniture, or none of them is a kind I can furnish.");
        return 0;
      }
      const result = this.dispatch(command);
      if (!result.ok) return 0;
      setView("furnished");
      const added = command.type === "replaceFurniture" ? command.add.length : 0;
      notify("success", `Placed ${added} piece${added === 1 ? "" : "s"} of furniture. Undo to take them out.`);
      return added;
    },

    /** Lays a room out again from its type, replacing what's in it, as one undoable step. */
    furnishRoom(roomId: Id): boolean {
      const level = levelOf(current(), roomId) ?? activeLevel();
      const result = furnishRoom(level, roomId, newIdPrefix(), { keepOut: levelKeepOut(current(), level.id) });
      if (!result) return false;
      if (!result.items.length) {
        notify("info", result.missing.length ? `${level.rooms[roomId].name} is too small for ${FURNITURE_CATALOG[result.missing[0]].label.toLowerCase()}.` : `I don't have a standard layout for ${level.rooms[roomId].name.toLowerCase()}. Add pieces with the Furniture tool.`);
        return false;
      }
      if (!this.dispatch({ type: "replaceFurniture", levelId: level.id, remove: result.remove, add: result.items }).ok) return false;
      setView("furnished");
      const missing = result.missing.map((k) => FURNITURE_CATALOG[k].label.toLowerCase());
      if (missing.length) notify("info", `There wasn't room for: ${missing.join(", ")}.`);
      return true;
    },

    /** Removes the furniture in one room, or in every room. */
    clearFurniture(roomId?: Id): boolean {
      const level = (roomId && levelOf(current(), roomId)) || activeLevel();
      const ids = roomId ? furnitureInRoom(level, roomId).map((f) => f.id) : Object.keys(level.furniture);
      if (!ids.length) return false;
      return this.dispatch({ type: "replaceFurniture", levelId: level.id, remove: ids, add: [] }).ok;
    },

    /** Two of the project's plans side by side (designView "compare"); either side can be changed there. */
    comparePlansSideBySide(left: Id, right: Id) {
      this.setDesignView("compare");
      session.setState({ comparePlans: [left, right] });
    },

    setVariations(patch: Partial<VariationsState> | null) {
      session.setState((s) => ({ variations: patch === null ? null : s.variations ? { ...s.variations, ...patch } : (patch as VariationsState) }));
    },

    setDesigner(patch: Partial<DesignerState>) {
      session.setState((s) => ({ designer: { ...s.designer, ...patch } }));
    },

    setPanels(patch: Partial<PanelState>) {
      session.setState((s) => ({ panels: { ...s.panels, ...patch } }));
    },
  };
}

export type EditorActions = ReturnType<typeof createEditorActions>;

/** The plan being worked on: a drag's preview, else the committed document; never an option on show. */
export function workingDocument(state: DocumentState): PlanDocument {
  return state.preview?.document ?? state.history.present;
}

/** The plan as committed, or the option on show over it (what 3D draws: it doesn't follow drags). */
export function committedOrStaged(state: DocumentState): PlanDocument {
  const s = state.staged;
  return s && !s.peek && s.source === state.history.present ? s.document : state.history.present;
}

/** The document currently displayed: an active preview, else an option on show, else the committed document. */
export function displayedDocument(state: DocumentState): PlanDocument {
  if (state.preview) return state.preview.document;
  const s = state.staged;
  return s && !s.peek && s.source === state.history.present ? s.document : state.history.present;
}

/** Autosave watches committed plan edits and project-level changes, nothing else. */
export function projectAutosaveSource(stores: EditorStores) {
  return {
    subscribe(onChange: () => void) {
      const a = stores.documents.subscribe(onChange);
      const b = stores.project.subscribe(onChange);
      return () => {
        a();
        b();
      };
    },
    key: () => [stores.documents.getState().history.present, stores.project.getState().revision] as const,
    snapshot: () => projectDocument(stores),
  };
}
