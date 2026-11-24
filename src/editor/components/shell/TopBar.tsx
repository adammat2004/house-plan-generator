"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { BRAND, Logo } from "@/components/brand";
import { Menu, MenuItem, SegmentedControl } from "@/components/ui/controls";
import { CheckIcon, ChevronDownIcon, CloudIcon, CubeIcon, DownloadIcon, RoomIcon, SofaIcon } from "@/components/ui/icons";
import { editor, useProjectState, useSessionState } from "../../state/editor";
import { useSaveStatus } from "../../state/saveStatus";
import { STEP_UNAVAILABLE, STEPS, stepAvailable, stepOf } from "../../state/steps";
import { in3d, inRefine } from "../../state/stores";
import { exportProjectFile } from "./exports";
import { chooseView, goToStep, VIEW_CHOICES, viewChoiceOf, type ViewChoice } from "./tools";

export interface TopBarActions {
  onNew: () => void;
  onHouse: () => void;
  onImport: () => void;
  onRecover: () => void;
  onExportJson: () => void;
  onExportPng: () => void;
  onExportPresentation: () => void;
  onExport3dPng: () => void;
  onExport3dModel: () => void;
  onExportPdf: () => void;
  onExportDxf: () => void;
  onExportIfc: () => void;
}

/**
 * Slim project bar: identity and save state on the left, the five steps in
 * the centre, and on the right how the plan is shown (in Refine and Review)
 * and Export.
 */
export function TopBar(actions: TopBarActions) {
  const showing3d = useSessionState(in3d);
  return (
    <header className="top-bar">
      <div className="top-bar-start">
        <Link href="/" className="brand" aria-label="All projects" data-tooltip="All projects" data-tooltip-side="bottom" data-testid="home-link">
          <Logo size={30} />
          <span className="brand-wordmark" aria-hidden>
            {BRAND.name}
          </span>
        </Link>
        <div className="project-title">
          <ProjectName />
          <ProjectMenu {...actions} />
        </div>
        <span className="top-bar-divider" aria-hidden />
        <SaveStatus />
      </div>
      <Stepper />
      <CompactStepper />
      <div className="top-bar-end">
        <ViewSwitch />
        <Menu
          label="Export"
          align="right"
          testId="export-menu"
          className="export-menu"
          summary={
            <span className="btn btn-secondary">
              <DownloadIcon width={18} height={18} /> <span className="export-label">Export</span> <ChevronDownIcon width={16} height={16} />
            </span>
          }
        >
          <MenuItem onSelect={actions.onExportPdf} data-testid="export-pdf">
            Drawings, plans and elevations <small>.pdf</small>
          </MenuItem>
          <MenuItem onSelect={actions.onExportDxf} data-testid="export-dxf">
            CAD plan <small>.dxf</small>
          </MenuItem>
          <MenuItem onSelect={actions.onExportIfc} data-testid="export-ifc">
            BIM model <small>.ifc</small>
          </MenuItem>
          <hr />
          <MenuItem onSelect={actions.onExportJson} data-testid="export-json">
            Project file <small>.json</small>
          </MenuItem>
          <MenuItem onSelect={actions.onExportPng} data-testid="export-png">
            Plan image <small>.png</small>
          </MenuItem>
          <MenuItem onSelect={actions.onExportPresentation} data-testid="export-presentation">
            Presentation image <small>.png</small>
          </MenuItem>
          {showing3d && (
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

/** The five steps. Steps with nothing to show yet are dimmed and say why. */
export function Stepper() {
  const current = useSessionState(stepOf);
  const plans = useProjectState((s) => s.plans);
  const sizing = useProjectState((s) => s.sizing);
  const index = STEPS.findIndex((st) => st.id === current);
  return (
    <nav className="stepper" aria-label="Steps">
      <ol>
        {STEPS.map(({ id, label, key }, i) => {
          const available = stepAvailable({ plans, sizing }, id);
          const isCurrent = id === current;
          const done = i < index && available;
          return (
            <li key={id}>
              <button
                type="button"
                className={isCurrent ? "is-current" : done ? "is-done" : undefined}
                aria-current={isCurrent ? "step" : undefined}
                aria-disabled={!available || undefined}
                data-tooltip={available ? `${label}  ${key}` : STEP_UNAVAILABLE}
                data-tooltip-side="bottom"
                onClick={() => goToStep(id)}
                data-testid={`step-${id}`}
              >
                <span className="step-number" aria-hidden>
                  {done ? <CheckIcon width={12} height={12} /> : i + 1}
                </span>
                <span className="step-label">{label}</span>
                {done && <span className="visually-hidden"> (done)</span>}
              </button>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

const VIEW_ICON: Record<ViewChoice, typeof RoomIcon> = { plan: RoomIcon, "3d": CubeIcon, furnished: SofaIcon };

/** How the plan is shown, apart from the steps: the 2D plan, the house in 3D, or the plan furnished. */
function ViewSwitch() {
  const shown = useSessionState((s) => inRefine(s) || s.workspace === "review");
  const value = useSessionState(viewChoiceOf);
  if (!shown) return null;
  return (
    <SegmentedControl
      label="View"
      size="md"
      className="plan-view-switch"
      value={value}
      options={VIEW_CHOICES.map(({ value: v, label, key }) => {
        const Icon = VIEW_ICON[v];
        return {
          value: v,
          label: (
            <span className="view-choice" data-tooltip={`${label}  ${key}`} data-tooltip-side="bottom">
              <Icon width={16} height={16} />
              <span className="view-label">{label}</span>
            </span>
          ),
        };
      })}
      onChange={chooseView}
      testIdPrefix="view"
    />
  );
}

function SaveStatus() {
  const { status } = useSaveStatus();
  const now = useNow(status.state === "saved" ? 15_000 : null);
  const [text, detail] =
    status.state === "saved"
      ? ["Saved on this device", `Saved in this browser ${ago(now - status.at)}. Download a backup to keep a copy elsewhere.`]
      : status.state === "saving"
        ? ["Saving…", "Saving to this browser"]
        : status.state === "pending"
          ? ["Unsaved changes", "Changes will save in a moment"]
          : status.state === "idle"
            ? ["Not saved", "Not saved yet"]
            : ["Couldn't save", "Your browser's storage is full or blocked (private browsing?). Download a backup to keep your house."];
  return (
    <div className={`save-status save-${status.state}`} role="status" aria-live="polite" data-testid="save-status" data-tooltip={detail} data-tooltip-side="bottom">
      <CloudIcon width={18} height={18} />
      <span className="save-text">{text}</span>
      {status.state === "error" && (
        <button type="button" className="btn btn-secondary btn-sm" onClick={exportProjectFile} data-testid="save-error-backup">
          Download backup
        </button>
      )}
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

/** Phones: "Step 3 of 5 · Explore", opening the list of steps. */
function CompactStepper() {
  const current = useSessionState(stepOf);
  const plans = useProjectState((s) => s.plans);
  const sizing = useProjectState((s) => s.sizing);
  const index = STEPS.findIndex((st) => st.id === current);
  return (
    <Menu
      label={`Step ${index + 1} of ${STEPS.length}: ${STEPS[index]?.label}. Change step`}
      className="compact-stepper"
      testId="compact-stepper"
      summary={
        <span className="compact-step">
          <span className="compact-step-count">
            Step {index + 1} of {STEPS.length} ·{" "}
          </span>
          <strong>{STEPS[index]?.label}</strong> <ChevronDownIcon width={16} height={16} />
        </span>
      }
    >
      {STEPS.map(({ id, label }, i) => {
        const available = stepAvailable({ plans, sizing }, id);
        return (
          <MenuItem key={id} onSelect={() => goToStep(id)} disabled={!available} aria-current={id === current ? "step" : undefined} title={available ? undefined : STEP_UNAVAILABLE} data-testid={`compact-step-${id}`}>
            {i + 1}. {label}
          </MenuItem>
        );
      })}
    </Menu>
  );
}
