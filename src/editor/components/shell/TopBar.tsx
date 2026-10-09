"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { IconButton, Menu, MenuItem } from "@/components/ui/controls";
import { ArrowRightIcon, ChevronDownIcon, CloudIcon, DownloadIcon, HouseMark, RedoIcon, UndoIcon, UsersIcon } from "@/components/ui/icons";
import { editor, useDocumentState, useProjectState, useSessionState } from "../../state/editor";
import { useSaveStatus } from "../../state/saveStatus";
import type { Workspace } from "../../state/stores";
import { nextStep, selectWorkspace } from "./tools";

export interface TopBarActions {
  onNew: () => void;
  onHouse: () => void;
  onImport: () => void;
  onRecover: () => void;
  onExportJson: () => void;
  onExportPng: () => void;
  onExport3dPng: () => void;
  onExport3dModel: () => void;
}

/** Slim project bar: identity and save state on the left, workspaces in the centre, history and output on the right. */
export function TopBar(actions: TopBarActions) {
  const presenting = useSessionState((s) => s.workspace === "present");
  return (
    <header className="top-bar">
      <div className="top-bar-start">
        <Link href="/" className="brand" aria-label="All projects" data-tooltip="All projects" data-tooltip-side="bottom" data-testid="home-link">
          <HouseMark />
        </Link>
        <div className="project-title">
          <ProjectName />
          <ProjectMenu {...actions} />
        </div>
        <span className="top-bar-divider" aria-hidden />
        <SaveStatus />
      </div>
      <WorkspaceSwitcher />
      <div className="top-bar-end">
        <HistoryControls />
        <button type="button" className="btn btn-outline" aria-disabled="true" data-tooltip="Sharing is coming soon" data-tooltip-side="bottom" data-testid="share">
          <UsersIcon width={18} height={18} /> Share
        </button>
        <Menu
          label="Export"
          align="right"
          testId="export-menu"
          className="export-menu"
          summary={
            <span className="btn btn-primary">
              <DownloadIcon width={18} height={18} /> Export <ChevronDownIcon width={16} height={16} />
            </span>
          }
        >
          <MenuItem onSelect={actions.onExportJson} data-testid="export-json">
            Project file <small>.json</small>
          </MenuItem>
          <MenuItem onSelect={actions.onExportPng} data-testid="export-png">
            Plan image <small>.png</small>
          </MenuItem>
          {presenting && (
            <>
              <hr />
              <MenuItem onSelect={actions.onExport3dPng} data-testid="export-3d-png">
                3D view image <small>.png</small>
              </MenuItem>
              <MenuItem onSelect={actions.onExport3dModel} data-testid="export-glb">
                3D model <small>.glb</small>
              </MenuItem>
            </>
          )}
        </Menu>
        <NextStep />
      </div>
    </header>
  );
}

function ProjectMenu({ onNew, onHouse, onImport, onRecover }: TopBarActions) {
  const { previousAvailable } = useSaveStatus();
  return (
    <Menu label="Project menu" testId="file-menu" className="project-menu" summary={<ChevronDownIcon width={18} height={18} />}>
      <MenuItem onSelect={onHouse} data-testid="house-settings">
        House dimensions…
      </MenuItem>
      <MenuItem onSelect={() => editor.duplicatePlan()} data-testid="new-variation">
        New variation of this plan
      </MenuItem>
      <MenuItem onSelect={onNew}>New house…</MenuItem>
      <hr />
      <MenuItem onSelect={onImport} data-testid="import-json">
        Open project file…
      </MenuItem>
      <MenuItem onSelect={onRecover} disabled={!previousAvailable}>
        Restore previous autosave
      </MenuItem>
    </Menu>
  );
}

function ProjectName() {
  const name = useProjectState((s) => s.name);
  return (
    <input
      className="doc-name"
      aria-label="Project name"
      defaultValue={name}
      key={name}
      maxLength={200}
      size={Math.min(Math.max(name.length, 8), 32)}
      onBlur={(e) => {
        const value = e.currentTarget.value;
        if (editor.renameProject(value) !== true) e.currentTarget.value = name;
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter") e.currentTarget.blur();
        if (e.key === "Escape") {
          e.currentTarget.value = name;
          e.currentTarget.blur();
        }
      }}
    />
  );
}

const WORKSPACES: ReadonlyArray<{ id: Workspace; label: string; key: string; testId: string }> = [
  { id: "structure", label: "Structure", key: "1", testId: "workspace-structure" },
  { id: "brief", label: "Rooms", key: "2", testId: "workspace-brief" },
  { id: "design", label: "Design", key: "3", testId: "workspace-design" },
  { id: "present", label: "3D", key: "4", testId: "workspace-3d" },
];

/** The next step: Structure → Rooms → Design (generating layouts if there are none) → 3D. */
function NextStep() {
  const workspace = useSessionState((s) => s.workspace);
  const running = useSessionState((s) => s.designer.status === "running");
  if (workspace === "present") return null;
  return (
    <button type="button" className="btn btn-primary next-step" disabled={running} onClick={() => void nextStep()} data-testid="next-step">
      {running ? "Generating…" : "Next"} <ArrowRightIcon width={17} height={17} />
    </button>
  );
}

export function WorkspaceSwitcher() {
  const workspace = useSessionState((s) => s.workspace);
  return (
    <div className="workspace-switcher" role="radiogroup" aria-label="Workspace">
      {WORKSPACES.map(({ id, label, key, testId }) => {
        const active = workspace === id;
        return (
          <button
            key={id}
            type="button"
            role="radio"
            aria-checked={active}
            className={active ? "is-active" : undefined}
            data-testid={testId}
            data-tooltip={`${label}  ${key}`}
            data-tooltip-side="bottom"
            onClick={() => selectWorkspace(id)}
          >
            <span className="step-number" aria-hidden>
              {key}
            </span>
            {label}
          </button>
        );
      })}
    </div>
  );
}

function HistoryControls() {
  const canUndo = useDocumentState((s) => s.history.past.length > 0 && !s.preview);
  const canRedo = useDocumentState((s) => s.history.future.length > 0 && !s.preview);
  const mod = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform) ? "⌘" : "Ctrl+";
  return (
    <div className="history-controls" role="toolbar" aria-label="History">
      <IconButton label="Undo" shortcut={`${mod}Z`} disabled={!canUndo} onClick={() => editor.undo()} data-testid="undo">
        <UndoIcon />
      </IconButton>
      <IconButton label="Redo" shortcut={`${mod}⇧Z`} disabled={!canRedo} onClick={() => editor.redo()} data-testid="redo">
        <RedoIcon />
      </IconButton>
    </div>
  );
}

function SaveStatus() {
  const { status } = useSaveStatus();
  const now = useNow(status.state === "saved" ? 15_000 : null);
  const [text, detail] =
    status.state === "saved"
      ? [`Saved ${ago(now - status.at)}`, "Saved in this browser"]
      : status.state === "saving"
        ? ["Saving…", "Saving to this browser"]
        : status.state === "pending"
          ? ["Unsaved changes", "Changes will save in a moment"]
          : status.state === "idle"
            ? ["Not saved", "Not saved yet"]
            : ["Not saved", `Not saved — ${status.message}`];
  return (
    <div className={`save-status save-${status.state}`} role="status" aria-live="polite" data-testid="save-status" data-tooltip={detail} data-tooltip-side="bottom">
      <CloudIcon width={18} height={18} />
      {text}
    </div>
  );
}

const ago = (ms: number) => {
  const minutes = Math.floor(ms / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  return `${hours} hr${hours === 1 ? "" : "s"} ago`;
};

/** The current time, refreshed every `interval` ms while one is given. */
function useNow(interval: number | null) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (interval === null) return;
    const t = setInterval(() => setNow(Date.now()), interval);
    return () => clearInterval(t);
  }, [interval]);
  return now;
}
