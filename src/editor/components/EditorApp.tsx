"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { startAutosave } from "@/persistence/autosave";
import { browserLibrary } from "@/persistence/browserLibrary";
import { downloadProject, downloadUrl, projectFileName, readProjectFile } from "@/persistence/jsonFile";
import { loadPreviousRevision, loadStartupProject, type PlanStorage } from "@/persistence/planStorage";
import { exportPlanImage } from "../rendering/konva/stageRegistry";
import { exportModel, snapshot3d } from "../rendering/three/registry";
import { design, editor, editorStores, renders, useProjectState, useSessionState } from "../state/editor";
import { saveStatusStore, setSaveStatus } from "../state/saveStatus";
import { DEFAULT_VIEW3D, projectAutosaveSource, projectDocument } from "../state/stores";
import { toolController } from "../tools/instance";
import { worldToScreen } from "../viewport/viewport";
import { CreateHouseDialog, type CreateHouseValues } from "./CreateHouseDialog";
import { OutlineConfirmDialog } from "./OutlineConfirmDialog";
import { AiDesignerPanel } from "./designer/AiDesignerPanel";
import { BriefPanel } from "./designer/BriefPanel";
import { ConceptBoard } from "./designer/ConceptBoard";
import { DesignBreadcrumb, RoomQuickBar } from "./designer/RefineChrome";
import { RoomVariations } from "./designer/RoomVariations";
import { PresentWorkspace } from "./present/PresentWorkspace";
import { VariationTray } from "./designer/VariationTray";
import { InspectorCard } from "./inspector/InspectorCard";
import { CanvasDock, ViewControls } from "./shell/CanvasControls";
import { FloatingToolbar } from "./shell/FloatingToolbar";
import { FloorsPanel } from "./shell/FloorsPanel";
import { LayersPanel } from "./shell/LayersPanel";
import { NoticeToast, StatusHint } from "./shell/StatusHint";
import { ToolOptions } from "./shell/ToolOptions";
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
  /** "draw" starts with the wall tool, for projects begun from scratch. */
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
  const briefing = useSessionState((s) => s.workspace === "brief");
  const designing = useSessionState((s) => s.workspace === "design");
  const presenting = useSessionState((s) => s.workspace === "present");
  const mode3d = useSessionState((s) => s.view3d.mode);
  // The concept board and room variations cover the plan with their own chrome.
  const onBoard = useSessionState((s) => s.workspace === "design" && s.designView !== "plan");

  useKeyboardShortcuts();

  useEffect(() => {
    document.title = `${projectName} · HomeDesign`;
  }, [projectName]);

  // Whether Claude reads requests here (or the built-in rules do), and whether photo renders are set up.
  useEffect(() => {
    void design.checkAi();
    void renders.checkAvailable();
  }, []);

  // Load the project from the library, then start autosaving committed changes to it.
  useEffect(() => {
    let cancelled = false;
    let stop: (() => void) | null = null;
    // The editor stores outlive this component (client-side navigation), so reset the session first.
    editorStores.session.setState({ ready: false, createDialogOpen: false, selection: null, hover: null, tool: "select", workspace: "structure", designView: "board", variations: null, view3d: DEFAULT_VIEW3D });
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
        editor.notify("info", `The latest autosave was damaged (${result.reason}); the previous saved version was restored.`);
      }
      if (start === "draw") selectTool("wall");
      else if (start === "rooms") editor.setWorkspace("brief");
      else if (start === "concepts") {
        // Started from a list of rooms: open on the generated layouts, the first one in focus.
        const first = result.project.plans.find((p) => p.origin.kind === "generated");
        editor.setWorkspace("design");
        editor.setDesigner({ focusPlanId: first?.id ?? null });
      }
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
        return { tool: s.tool, workspace: s.workspace, designView: s.designView, selection: s.selection, viewport: s.viewport, snap: s.snap, view3d: s.view3d };
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
    const result = editor.dispatch(
      outline ? { type: "createOutline", outline, externalThickness, wallHeight, name } : { type: "createFootprint", width, depth, externalThickness, wallHeight, name },
    );
    if (!result.ok) return result.issues[0]?.message ?? "Invalid dimensions";
    if (values.name.trim()) editor.renameProject(values.name);
    editorStores.session.setState({ createDialogOpen: false, selection: null });
    selectTool("select");
    fitSoon();
    return null;
  }, []);

  const exportJson = () => {
    downloadProject(projectDocument(editorStores));
    editor.notify("success", "Project file downloaded.");
  };

  const export3dPng = () => {
    const url = snapshot3d();
    if (!url) {
      editor.notify("error", "The 3D view isn't ready to export yet.");
      return;
    }
    downloadUrl(url, projectFileName(`${editorStores.project.getState().name} 3D`, ".png"));
  };

  const export3dModel = async () => {
    const blob = await exportModel();
    if (!blob) {
      editor.notify("error", "The 3D view isn't ready to export yet.");
      return;
    }
    const url = URL.createObjectURL(blob);
    downloadUrl(url, projectFileName(editorStores.project.getState().name, ".glb"));
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
    editor.notify("success", "3D model downloaded (.glb). It opens in most 3D viewers and modelling apps.");
  };

  const exportPng = () => {
    const url = exportPlanImage();
    if (!url) {
      editor.notify("error", "The plan isn't ready to export yet.");
      return;
    }
    const p = editorStores.project.getState();
    const label = p.plans.length > 1 ? ` ${p.plans.find((plan) => plan.id === p.activePlanId)?.label ?? ""}` : "";
    downloadUrl(url, projectFileName(`${p.name}${label}`, ".png"));
  };

  const showHouse = () => {
    selectTool("select");
    editor.setPanels({ inspectorCollapsed: false });
    editor.select({ kind: "house", id: editor.current().levels[0].id });
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
          <Link className="btn btn-dark" href="/">
            Back to projects
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="editor-shell">
      <TopBar
        onNew={() => editorStores.session.setState({ createDialogOpen: true })}
        onHouse={showHouse}
        onImport={() => fileInput.current?.click()}
        onRecover={() => void recover()}
        onExportJson={exportJson}
        onExportPng={exportPng}
        onExport3dPng={export3dPng}
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
      <main className={`canvas-area${briefing ? " is-briefing" : ""}${designing ? " is-designing" : ""}${presenting ? ` is-present is-${mode3d}` : ""}`}>
        <PlanCanvas />
        <ConceptBoard />
        <RoomVariations />
        <PresentWorkspace />
        <FloatingToolbar />
        <DesignBreadcrumb />
        <RoomQuickBar />
        <div className="left-stack">
          <ToolOptions />
          <LayersPanel />
        </div>
        {!onBoard && !presenting && (
          <div className="right-stack">
            <AiDesignerPanel />
            <InspectorCard roomFocusKey={roomFocusKey} />
          </div>
        )}
        <BriefPanel />
        {!briefing && !onBoard && <FloorsPanel />}
        {!onBoard && !presenting && !briefing && (
          <>
            <div className="bottom-centre">
              {!briefing && !designing && <VariationTray />}
              <StatusHint />
              <CanvasDock />
            </div>
            <ViewControls />
          </>
        )}
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
