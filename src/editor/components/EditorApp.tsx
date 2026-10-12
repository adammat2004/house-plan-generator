"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { BRAND } from "@/components/brand";
import { startAutosave } from "@/persistence/autosave";
import { browserLibrary } from "@/persistence/browserLibrary";
import { readProjectFile } from "@/persistence/jsonFile";
import { loadPreviousRevision, loadStartupProject, type PlanStorage } from "@/persistence/planStorage";
import { design, editor, editorStores, renders, useProjectState, useSessionState } from "../state/editor";
import { saveStatusStore, setSaveStatus } from "../state/saveStatus";
import { stepAvailable } from "../state/steps";
import { DEFAULT_VIEW3D, hasFurniture, in3d, inRefine, projectAutosaveSource, projectDocument } from "../state/stores";
import { toolController } from "../tools/instance";
import { worldToScreen } from "../viewport/viewport";
import { CreateHouseDialog, type CreateHouseValues } from "./CreateHouseDialog";
import { OutlineConfirmDialog } from "./OutlineConfirmDialog";
import { AiDesignerPanel } from "./designer/AiDesignerPanel";
import { BriefPanel } from "./designer/BriefPanel";
import { ConceptBoard } from "./designer/ConceptBoard";
import { PlanPill } from "./designer/RefineChrome";
import { PlanCompare } from "./designer/PlanCompare";
import { RoomVariations } from "./designer/RoomVariations";
import { ThreeStage } from "./present/PresentWorkspace";
import { InspectorCard } from "./inspector/InspectorCard";
import { ReviewPanel } from "./review/ReviewPanel";
import { MapWorkspace } from "./site/MapWorkspace";
import { export3dModel, export3dPng, exportPlanPng, exportPresentationPng, exportProjectFile } from "./shell/exports";
import { CanvasDock } from "./shell/CanvasControls";
import { FloorCard } from "./shell/FloorCard";
import { SelectionToolbar } from "./shell/SelectionToolbar";
import { StagedBanner } from "./shell/StagedBanner";
import { FloatingToolbar } from "./shell/FloatingToolbar";
import { LayersPanel } from "./shell/LayersPanel";
import { NoticeToast, StatusHint } from "./shell/StatusHint";
import { ToolOptions } from "./shell/ToolOptions";
import { useReadOnlySync } from "./shell/phone";
import { ReadOnlyNote } from "./shell/ReadOnlyNote";
import { selectTool } from "./shell/tools";
import { TopBar } from "./shell/TopBar";
import { useKeyboardShortcuts } from "./useKeyboardShortcuts";

const PlanCanvas = dynamic(() => import("./PlanCanvas"), {
  ssr: false,
  loading: () => <div className="plan-canvas plan-canvas-loading">Loading plan…</div>,
});

declare global {
  interface Window {
    /** Read-only hooks for automated browser tests and debugging. */
    __floorPlanEditor?: {
      /** The plan being edited. */
      getDocument: () => unknown;
      /** The whole project as it would be saved. */
      getProject: () => unknown;
      getSession: () => unknown;
      worldToScreen: (p: { x: number; y: number }) => { x: number; y: number };
      historySize: () => { past: number; future: number };
    };
  }
}

const fitSoon = () => requestAnimationFrame(() => toolController.fitPlan());

type Phase = { kind: "loading" } | { kind: "ready" } | { kind: "unavailable"; message: string };

interface EditorAppProps {
  /** The library project to open; edits autosave back to it. */
  projectId: string | null;
  /** "draw" starts with the wall tool, for projects begun from scratch; "refine" opens the active plan. */
  start?: string | null;
}

export default function EditorApp({ projectId, start }: EditorAppProps) {
  const storage = useRef<PlanStorage | null>(null);
  const [phase, setPhase] = useState<Phase>({ kind: "loading" });
  const ready = useSessionState((s) => s.ready);
  const dialogOpen = useSessionState((s) => s.createDialogOpen);
  const internalThickness = useSessionState((s) => s.settings.internalThickness);
  const fileInput = useRef<HTMLInputElement>(null);
  const roomFocusKey = useSessionState((s) => s.roomNameFocus);
  const projectName = useProjectState((s) => s.name);
  const workspace = useSessionState((s) => s.workspace);
  const refining = useSessionState(inRefine);
  const showing3d = useSessionState(in3d);
  const split = useSessionState((s) => s.view3d.split);
  const readOnly = useSessionState((s) => s.readOnly);

  useKeyboardShortcuts();
  useReadOnlySync();

  useEffect(() => {
    document.title = `${projectName} · ${BRAND.name}`;
  }, [projectName]);

  // Whether the language model reads requests here (or the built-in rules do), and whether photo renders are set up.
  useEffect(() => {
    void design.checkAi();
    void renders.checkAvailable();
  }, []);

  // Load the project from the library, then start autosaving committed changes to it.
  useEffect(() => {
    let cancelled = false;
    let stop: (() => void) | null = null;
    // The editor stores outlive this component (client-side navigation), so reset the session first.
    editorStores.session.setState({ ready: false, createDialogOpen: false, selection: null, hover: null, tool: "select", workspace: "design", designView: "plan", view: "plan", viewChosen: false, show3d: false, variations: null, view3d: DEFAULT_VIEW3D });
    saveStatusStore.setState({ status: { state: "idle" }, previousAvailable: false });
    if (!projectId) return;
    const store = browserLibrary().storage(projectId);
    storage.current = store;
    void loadStartupProject(store).then((result) => {
      if (cancelled) return;
      if (result.kind === "empty" || result.kind === "error") {
        setPhase({ kind: "unavailable", message: result.kind === "empty" ? "This project doesn't exist in this browser. It may have been deleted." : result.message });
        return;
      }
      // The library key is the project's identity, whatever id an imported file carried.
      editor.loadProject({ ...result.project, id: projectId });
      void renders.load(projectId, new Set(result.project.plans.map((p) => p.id)));
      if (result.kind === "loaded") {
        saveStatusStore.setState({ status: { state: "saved", at: Date.now() }, previousAvailable: result.previousAvailable });
      } else {
        console.warn("Autosave damaged:", result.reason);
        editor.notify("info", "The latest autosave was damaged, so the version saved before it was restored.");
      }
      const roomsFirst = result.project.sizing?.footprint === "auto";
      const hasLayouts = result.project.plans.some((p) => p.origin.kind === "generated");
      // A drawn house, or a layout sent from another device, opens in Refine: furnished when it has furniture.
      editor.setView(hasFurniture(editor.current()) ? "furnished" : "plan");
      if (start === "draw") selectTool("wall");
      else if (start === "map") editor.setWorkspace("site");
      else if (start === "rooms" || start === "requirements") editor.setWorkspace("brief");
      else if (start === "review" && stepAvailable(editorStores.project.getState(), "review")) editor.setWorkspace("review");
      else if (start === "concepts" || start === "explore" || (!start && roomsFirst && hasLayouts)) {
        // Layouts, with the recommended one in focus (the page picks it).
        editor.setWorkspace("design");
        editor.setDesignView("board");
        editor.setDesigner({ focusPlanId: null });
      } else if (!start && roomsFirst) editor.setWorkspace("brief");
      // The start choice applies once: a reload opens the project as it now is.
      if (start) window.history.replaceState(window.history.state, "", `/editor?project=${encodeURIComponent(projectId)}`);
      editorStores.session.setState({ ready: true });
      setPhase({ kind: "ready" });
      stop = startAutosave(projectAutosaveSource(editorStores), store, setSaveStatus);
    });
    return () => {
      cancelled = true;
      stop?.();
      renders.reset();
    };
  }, [projectId, start]);

  useEffect(() => {
    window.__floorPlanEditor = {
      getDocument: () => editorStores.documents.getState().history.present,
      getProject: () => projectDocument(editorStores),
      getSession: () => {
        const s = editorStores.session.getState();
        return { tool: s.tool, workspace: s.workspace, designView: s.designView, view: s.view, show3d: s.show3d, selection: s.selection, viewport: s.viewport, snap: s.snap, view3d: s.view3d };
      },
      worldToScreen: (p) => worldToScreen(editorStores.session.getState().viewport, p),
      historySize: () => {
        const h = editorStores.documents.getState().history;
        return { past: h.past.length, future: h.future.length };
      },
    };
  }, []);

  const createHouse = useCallback((values: CreateHouseValues): string | null => {
    editorStores.session.setState((s) => ({ settings: { ...s.settings, internalThickness: values.internalThickness } }));
    const { name, width, depth, externalThickness, wallHeight, outline } = values;
    // A new house, or the house in a new shape, starts from the ground floor.
    const levelId = editor.current().levels[0].id;
    const result = editor.dispatch(
      outline ? { type: "createOutline", outline, externalThickness, wallHeight, name, levelId } : { type: "createFootprint", width, depth, externalThickness, wallHeight, name, levelId },
    );
    if (!result.ok) return result.issues[0]?.message ?? "Invalid dimensions";
    if (values.name.trim()) editor.renameProject(values.name);
    editorStores.session.setState({ createDialogOpen: false, selection: null });
    selectTool("select");
    fitSoon();
    return null;
  }, []);

  const showHouse = () => {
    selectTool("select");
    editor.setPanels({ inspectorCollapsed: false });
    editor.select({ kind: "house", id: editor.activeLevel().id });
  };

  const importFile = async (file: File) => {
    const loaded = await readProjectFile(file);
    if (!loaded.ok) {
      editor.notify("error", `Couldn't open “${file.name}”: ${loaded.issues.map((i) => i.message).join(" ")} Your current project is unchanged.`);
      return;
    }
    if (loaded.wrapped) {
      // A single-plan file opens into the current plan as one undoable step.
      const result = editor.dispatch({ type: "replaceDocument", document: loaded.project.plans[0].document });
      if (!result.ok) return;
      editor.select(null);
      editor.notify("success", `Opened “${loaded.project.name}”. Undo restores the previous plan.`);
    } else {
      editor.loadProject({ ...loaded.project, id: editorStores.project.getState().id });
      const n = loaded.project.plans.length;
      editor.notify("success", `Opened “${loaded.project.name}” with ${n} plan${n === 1 ? "" : "s"}. Project menu → Restore previous autosave brings back what you had open.`);
    }
    fitSoon();
  };

  const recover = async () => {
    if (!storage.current) return;
    try {
      const previous = await loadPreviousRevision(storage.current);
      if (!previous) {
        editor.notify("info", "There is no earlier autosave to restore.");
        return;
      }
      editor.loadProject({ ...previous, id: editorStores.project.getState().id });
      editor.notify("success", "Restored the previous autosave.");
      fitSoon();
    } catch (error) {
      editor.notify("error", `Couldn't read browser storage: ${(error as Error).message}`);
    }
  };

  // EditorEntry keys this component by project, so each project starts from the loading phase.
  const shown: Phase = projectId ? phase : { kind: "unavailable", message: "No project was chosen." };
  if (shown.kind === "loading") {
    return (
      <div className="boot-screen" role="status">
        Opening project…
      </div>
    );
  }
  if (shown.kind === "unavailable") {
    return (
      <div className="boot-screen">
        <div className="editor-unavailable" role="alert" data-testid="project-unavailable">
          <h1>Couldn&rsquo;t open this project</h1>
          <p>{shown.message}</p>
          <Link className="btn btn-primary btn-md" href="/">
            Back to projects
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="editor-shell">
      <a href="#main" className="skip-link">
        Skip to the plan
      </a>
      <TopBar
        onNew={() => editorStores.session.setState({ createDialogOpen: true })}
        onHouse={showHouse}
        onImport={() => fileInput.current?.click()}
        onRecover={() => void recover()}
        onExportJson={exportProjectFile}
        onExportPng={exportPlanPng}
        onExportPresentation={() => void exportPresentationPng()}
        onExport3dPng={() => void export3dPng()}
        onExport3dModel={() => void export3dModel()}
      />
      <input
        ref={fileInput}
        type="file"
        accept=".json,application/json"
        hidden
        data-testid="import-file-input"
        onChange={(e) => {
          const file = e.currentTarget.files?.[0];
          e.currentTarget.value = "";
          if (file) void importFile(file);
        }}
      />
      <main
        id="main"
        tabIndex={-1}
        className={`canvas-area is-${workspace === "site" ? "mapping" : workspace === "brief" ? "briefing" : workspace === "review" ? "reviewing" : "designing"}${readOnly ? " is-read-only" : ""}${showing3d ? " is-3d" : ""}${showing3d && split ? " is-split" : ""}`}
      >
        <PlanCanvas />
        <ConceptBoard />
        <RoomVariations />
        <PlanCompare />
        <ThreeStage />
        <FloatingToolbar />
        <PlanPill />
        <StagedBanner />
        <SelectionToolbar />
        <FloorCard />
        <div className="left-stack" data-chrome="left">
          <ToolOptions />
          <LayersPanel />
        </div>
        {refining && (
          <div className="right-stack" data-chrome="right" data-chrome-min="340">
            <AiDesignerPanel />
            <InspectorCard roomFocusKey={roomFocusKey} />
          </div>
        )}
        <MapWorkspace />
        <BriefPanel />
        <ReviewPanel />
        {(refining || workspace === "site" || workspace === "review") && (
          <div className="bottom-centre" data-chrome="bottom">
            <StatusHint />
            <CanvasDock />
          </div>
        )}
        <ReadOnlyNote />
        <NoticeToast />
      </main>
      {ready && <OutlineConfirmDialog />}
      {ready && dialogOpen && (
        <CreateHouseDialog
          mode="replace"
          internalThickness={internalThickness}
          onCreate={createHouse}
          onCancel={() => editorStores.session.setState({ createDialogOpen: false })}
        />
      )}
    </div>
  );
}
