import { createStore, type StoreApi } from "zustand/vanilla";
import { normaliseBrief, type HouseBrief } from "@/domain/brief/schema";
import { applyCommand, type CommandResult, type PlanCommand, type PlanIssue } from "@/domain/commands";
import { DEFAULT_HOUSE, DOOR_PRESET, WINDOW_PRESET } from "@/domain/plan/defaults";
import type { RoomGoal } from "@/domain/design/intent";
import type { Id, PlanDocument, Point2 } from "@/domain/plan/types";
import {
  DEFAULT_APPEARANCE,
  MAX_PLANS,
  nextPlanLabel,
  PROJECT_FORMAT,
  PROJECT_SCHEMA_VERSION,
  projectFromPlan,
  type Appearance,
  type PlanVariantMeta,
  type ProjectDetails,
  type ProjectDocument,
} from "@/domain/project/schema";
import { DEFAULT_VIEWPORT, type Viewport } from "../viewport/viewport";
import { createHistory, pushHistory, redoHistory, undoHistory, type History } from "./history";
import { newIdPrefix } from "./ids";

/** "house" selects the envelope as a whole; its id is the level id. */
export type EntityKind = "wall" | "opening" | "room" | "house";
export type Selection = { kind: EntityKind; id: Id } | null;
export type ToolId = "select" | "wall" | "room" | "door" | "window";
/**
 * Same canvas, different jobs: Structure edits the shell, Brief collects what
 * the house needs (the plan is shown but not editable), Design works with
 * rooms, and Present (the "3D" tab) shows the house in 3D.
 */
export type Workspace = "structure" | "brief" | "design" | "present";

export type View3DMode = "2d" | "3d" | "split";
export type CameraMode = "orbit" | "pan" | "walk" | "interior" | "aerial" | "exterior";
export type LightingPreset = "morning" | "midday" | "evening" | "night";

/** How the 3D view is set up. Session-only: the house's look itself is in the project's appearance. */
export interface View3DState {
  mode: View3DMode;
  camera: CameraMode;
  /** Bumped to ask the camera to reframe even when the mode is unchanged. */
  cameraKey: number;
  /** The room the interior camera stands in (else the selected or largest day room). */
  interiorRoomId: Id | null;
  display: { roof: boolean; cutaway: boolean; dimensions: boolean; landscape: boolean };
  lighting: LightingPreset;
  shadows: boolean;
  /** Turns the sun around the house, degrees. */
  sunAzimuth: number;
  ground: "lawn" | "gravel" | "paving";
  sky: "clear" | "overcast";
  panelTab: "view" | "materials" | "lighting" | "environment";
  panelOpen: boolean;
  roomsOpen: boolean;
}

export const DEFAULT_VIEW3D: View3DState = {
  mode: "3d",
  camera: "orbit",
  cameraKey: 0,
  interiorRoomId: null,
  display: { roof: false, cutaway: false, dimensions: false, landscape: true },
  lighting: "midday",
  shadows: true,
  sunAzimuth: 0,
  ground: "lawn",
  sky: "clear",
  panelTab: "view",
  panelOpen: true,
  roomsOpen: false,
};
export type DragKind = "drag-wall" | "drag-end" | "drag-opening" | "drag-opening-edge";

export interface PanelState {
  inspectorCollapsed: boolean;
  layersOpen: boolean;
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
  state: "open" | "applied" | "saved";
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
  lastResult: { tone: "success" | "info" | "error"; message: string; notes: string[] } | null;
  /** The concept shown in the board's detail panel. */
  focusPlanId: Id | null;
  /** The AI Designer panel beside a plan in Designs. */
  panelOpen: boolean;
  chat: ChatMessage[];
}

/**
 * Designs shows every concept side by side, one concept opened for refining,
 * or one room of it beside its variations.
 */
export type DesignView = "board" | "plan" | "variations";

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

export interface Settings {
  snapEnabled: boolean;
  gridVisible: boolean;
  gridSize: number;
  internalThickness: number;
  door: { width: number; height: number };
  window: { width: number; height: number; sillHeight: number };
}

export interface SessionState {
  workspace: Workspace;
  designView: DesignView;
  variations: VariationsState | null;
  view3d: View3DState;
  tool: ToolId;
  selection: Selection;
  hover: Selection;
  viewport: Viewport;
  settings: Settings;
  cursor: Point2 | null;
  snap: SnapIndicator | null;
  wallDraft: WallDraft | null;
  openingDraft: OpeningDraft | null;
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
  const documents = createStore<DocumentState>(() => ({
    history: createHistory(active),
    preview: null,
    notice: null,
    revision: 0,
  }));
  const session = createStore<SessionState>(() => ({
    workspace: "structure",
    designView: "board",
    variations: null,
    view3d: DEFAULT_VIEW3D,
    tool: "select",
    selection: null,
    hover: null,
    viewport: DEFAULT_VIEWPORT,
    settings: {
      snapEnabled: true,
      gridVisible: true,
      gridSize: 0.1,
      internalThickness: DEFAULT_HOUSE.internalThickness,
      door: { ...DOOR_PRESET },
      window: { ...WINDOW_PRESET },
    },
    cursor: null,
    snap: null,
    wallDraft: null,
    openingDraft: null,
    panning: false,
    drag: null,
    panels: { inspectorCollapsed: false, layersOpen: false },
    designer: { status: "idle", lastResult: null, focusPlanId: null, panelOpen: true, chat: [] },
    ready: false,
    createDialogOpen: false,
    roomNameFocus: null,
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
    activePlanId: p.activePlanId,
    plans: p.plans.map((meta) => ({ ...meta, document: meta.id === p.activePlanId ? present : p.parked[meta.id].present })),
  };
}

let noticeCounter = 0;

/** Tools offered while refining a design: rooms, walls and doors, not windows or the shell. */
const DESIGN_TOOLS: ReadonlySet<ToolId> = new Set(["select", "room", "wall", "door"]);

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

  /** Drops the selection or hover if the entity no longer exists. */
  const reconcileSelection = (doc: PlanDocument) => {
    const level = doc.levels[0];
    const exists = (s: Selection) =>
      !s ||
      (s.kind === "wall" && !!level.walls[s.id]) ||
      (s.kind === "opening" && !!level.openings[s.id]) ||
      (s.kind === "room" && !!level.rooms[s.id]) ||
      (s.kind === "house" && level.id === s.id);
    const { selection, hover } = session.getState();
    if (!exists(selection) || !exists(hover)) {
      session.setState({ selection: exists(selection) ? selection : null, hover: exists(hover) ? hover : null });
    }
  };

  const commit = (next: PlanDocument) => {
    const state = documents.getState();
    documents.setState({
      history: pushHistory(state.history, next),
      preview: null,
      revision: state.revision + 1,
    });
    reconcileSelection(next);
  };

  const withPrefix = (command: PlanCommand): PlanCommand =>
    command.idPrefix ? command : { ...command, idPrefix: newIdPrefix() };

  return {
    current,
    notify,

    clearNotice() {
      documents.setState({ notice: null });
    },

    /** Applies and commits a command as one undoable history entry. */
    dispatch(command: PlanCommand): CommandResult {
      const result = applyCommand(current(), withPrefix(command));
      if (!result.ok) {
        reportFailure(result);
        return result;
      }
      if (result.changed) commit(result.document);
      if (documents.getState().notice?.tone === "error") documents.setState({ notice: null });
      return result;
    },

    /**
     * Validates a gesture step without committing. Invalid steps keep the
     * last valid preview on screen and record why the step was refused.
     */
    preview(command: PlanCommand): CommandResult {
      const result = applyCommand(current(), command);
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
      commit(preview.document);
      return true;
    },

    cancelPreview() {
      if (documents.getState().preview) documents.setState({ preview: null });
    },

    undo(): boolean {
      const state = documents.getState();
      if (state.preview || state.history.past.length === 0) return false;
      const history = undoHistory(state.history);
      documents.setState({ history, revision: state.revision + 1, notice: null });
      reconcileSelection(history.present);
      return true;
    },

    redo(): boolean {
      const state = documents.getState();
      if (state.preview || state.history.future.length === 0) return false;
      const history = redoHistory(state.history);
      documents.setState({ history, revision: state.revision + 1, notice: null });
      reconcileSelection(history.present);
      return true;
    },

    /** Starts a new single-plan project from a document, without an undo entry. */
    load(doc: PlanDocument) {
      this.loadProject(projectFromPlan(doc, { now: now(), brief: project.getState().brief }));
    },

    /** Replaces the whole project (startup, opening a project file, recovery). Not undoable. */
    loadProject(next: ProjectDocument) {
      const { project: state, active } = projectState(next, project.getState().revision + 1);
      project.setState(state, true);
      documents.setState((s) => ({ history: createHistory(active), preview: null, revision: s.revision + 1 }));
      session.setState({ selection: null, hover: null, wallDraft: null, openingDraft: null, snap: null, drag: null });
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
      project.setState({ activePlanId: planId, parked, revision: p.revision + 1 });
      documents.setState({ history, preview: null, revision: state.revision + 1, notice: null });
      session.setState({ selection: null, hover: null, wallDraft: null, openingDraft: null, snap: null, drag: null });
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

    select(selection: Selection) {
      session.setState({ selection });
    },

    setTool(tool: ToolId) {
      // The brief shows the plan for reference only; Designs offers the design tools.
      const { workspace } = session.getState();
      if (tool !== "select" && (workspace === "brief" || workspace === "present" || (workspace === "design" && !DESIGN_TOOLS.has(tool)))) return;
      if (documents.getState().preview) documents.setState({ preview: null });
      session.setState({ tool, wallDraft: null, openingDraft: null, snap: null, hover: null });
    },

    setWorkspace(workspace: Workspace) {
      const s = session.getState();
      if (s.workspace === workspace) return;
      if (documents.getState().preview) documents.setState({ preview: null });
      const keep = s.selection && (workspace === "structure" || (workspace === "design" && (s.selection.kind === "room" || s.selection.kind === "house")));
      session.setState({
        workspace,
        // Designs opens on the side-by-side comparison.
        designView: "board",
        variations: null,
        tool: "select",
        selection: keep ? s.selection : null,
        hover: null,
        wallDraft: null,
        openingDraft: null,
        snap: null,
        drag: null,
      });
    },

    setDesignView(designView: DesignView) {
      if (documents.getState().preview) documents.setState({ preview: null });
      session.setState({
        designView,
        hover: null,
        wallDraft: null,
        openingDraft: null,
        snap: null,
        drag: null,
        ...(designView !== "variations" ? { variations: null } : { tool: "select" as ToolId }),
        ...(designView === "board" ? { selection: null, tool: "select" as ToolId } : {}),
      });
    },

    setView3d(patch: Partial<View3DState>) {
      session.setState((s) => ({ view3d: { ...s.view3d, ...patch } }));
    },

    setAppearance(patch: Partial<Appearance>) {
      project.setState((p) => ({ appearance: { ...DEFAULT_APPEARANCE, ...p.appearance, ...patch }, revision: p.revision + 1 }));
    },

    /** Sets every wall (and the level default) to one height, as one undoable step. */
    setWallHeights(height: number): CommandResult {
      const doc = current();
      let next = doc;
      for (const wallId of Object.keys(doc.levels[0].walls)) {
        const result = applyCommand(next, { type: "updateWall", wallId, height });
        if (!result.ok) {
          reportFailure(result);
          return result;
        }
        next = result.document;
      }
      next = { ...next, levels: [{ ...next.levels[0], defaultWallHeight: height }, ...next.levels.slice(1)] };
      return this.dispatch({ type: "replaceDocument", document: next });
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

/** The document currently displayed: an active preview, else the committed document. */
export function displayedDocument(state: DocumentState): PlanDocument {
  return state.preview?.document ?? state.history.present;
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
