"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { Button, Menu, MenuItem } from "@/components/ui/controls";
import { ArrowRightIcon, MoreIcon } from "@/components/ui/icons";
import { useAreaText } from "@/components/units";
import type { ProjectTemplate } from "@/domain/project/templates";
import { templateArea } from "@/domain/project/templates";
import { PlanThumbnail } from "@/editor/components/designer/PlanThumbnail";
import { downloadProject } from "@/persistence/jsonFile";
import type { ProjectSummary } from "@/persistence/planStorage";
import { browserLibrary } from "@/persistence/browserLibrary";
import { COVER_VIEW } from "@/editor/state/covers";
import { createProjectFromTemplate, deleteProject, duplicateProject, editorHref, renameProject, startDesigning } from "../library";
import { editedAgo, showHomeNotice } from "../ui";
import { TemplateExterior, templatePreview } from "./illustrations";

/** The project's cover (its chosen plan from the garden, drawn in the editor), or null to show the plan drawing. */
function useCover(projectId: string, planId: string | undefined): string | null {
  const [cover, setCover] = useState<{ key: string; url: string } | null>(null);
  const key = `${projectId}/${planId}`;
  useEffect(() => {
    if (!planId) return;
    let url: string | null = null;
    let cancelled = false;
    browserLibrary()
      .renders.list(projectId)
      .then((records) => {
        const record = records.find((r) => r.view === COVER_VIEW && r.planId === planId);
        if (!record || cancelled) return;
        url = URL.createObjectURL(new Blob([record.bytes], { type: record.mimeType }));
        setCover({ key, url });
      })
      .catch(() => {
        // Storage blocked or full: the plan drawing stands in.
      });
    return () => {
      cancelled = true;
      if (url) URL.revokeObjectURL(url);
    };
  }, [projectId, planId, key]);
  return cover && cover.key === key ? cover.url : null;
}

const fail = (what: string) => (error: unknown) => showHomeNotice("error", `${what}: ${(error as Error).message || "unknown problem"}`);

export function ProjectCard({ project }: { project: ProjectSummary }) {
  const [dialog, setDialog] = useState<"rename" | "delete" | null>(null);
  // Next keeps visited pages mounted but hidden (React Activity); close transient UI when hidden.
  useLayoutEffect(() => () => setDialog(null), []);
  const doc = project.project;
  const plan = doc?.plans.find((p) => p.id === doc.activePlanId)?.document;
  const level = plan?.levels[0];
  const planCount = doc?.plans.length ?? 0;
  const cover = useCover(project.id, doc?.activePlanId);
  const title = (
    <>
      <span className="card-title">{project.name || "Untitled project"}</span>
      <span className="card-meta">
        {doc ? editedAgo(project.updatedAt) : "Can't be opened"}
        {planCount > 1 && ` · ${planCount} plans`}
      </span>
    </>
  );
  return (
    <article className="home-card project-card" data-testid="project-card">
      {doc ? (
        <Link href={editorHref(project.id)} className="card-link" aria-label={`Open ${project.name || "project"}`}>
          <div className="card-media plan-paper">
            {cover ? (
              // eslint-disable-next-line @next/next/no-img-element -- an object URL made in the browser
              <img className="card-cover" src={cover} alt="" data-testid="project-cover" />
            ) : (
              level && <PlanThumbnail level={level} plan={plan} palette="warm" className="card-plan" pad={0.8} detail />
            )}
          </div>
          <div className="card-body">{title}</div>
        </Link>
      ) : (
        <div className="card-link is-damaged" title={project.problem}>
          <div className="card-media plan-paper">
            <span className="card-damaged">This project is damaged{project.problem ? `: ${project.problem}` : "."}</span>
          </div>
          <div className="card-body">{title}</div>
        </div>
      )}
      <Menu label={`Actions for ${project.name || "project"}`} align="right" className="card-menu" summary={<MoreIcon width={20} height={20} />}>
        {doc && (
          <>
            <MenuItem onSelect={() => setDialog("rename")}>Rename…</MenuItem>
            <MenuItem onSelect={() => void duplicateProject(project.id).catch(fail("Couldn't duplicate the project"))}>Duplicate</MenuItem>
            <MenuItem onSelect={() => downloadProject(doc)}>
              Download file <small>.json</small>
            </MenuItem>
            <hr />
          </>
        )}
        <MenuItem onSelect={() => setDialog("delete")} className="is-danger">
          Delete…
        </MenuItem>
      </Menu>
      {dialog === "rename" && (
        <RenameDialog
          name={project.name}
          onCancel={() => setDialog(null)}
          onRename={async (name) => {
            await renameProject(project.id, name).catch(fail("Couldn't rename the project"));
            setDialog(null);
          }}
        />
      )}
      {dialog === "delete" && (
        <SmallDialog title={`Delete “${project.name || "Untitled project"}”?`} onCancel={() => setDialog(null)}>
          <p className="dialog-lead">The project and all its plans are removed from this browser. Download the file first if you might want it back.</p>
          <div className="dialog-actions">
            <Button variant="ghost" onClick={() => setDialog(null)}>
              Cancel
            </Button>
            <Button
              variant="danger"
              data-testid="confirm-delete"
              onClick={async () => {
                await deleteProject(project.id).catch(fail("Couldn't delete the project"));
                setDialog(null);
              }}
            >
              Delete project
            </Button>
          </div>
        </SmallDialog>
      )}
    </article>
  );
}

export function ProjectCardSkeleton() {
  return (
    <div className="home-card project-card is-skeleton" aria-hidden>
      <div className="card-media" />
      <div className="card-body">
        <span className="skeleton-line" />
        <span className="skeleton-line short" />
      </div>
    </div>
  );
}

/** Starts a project from a template and opens it. */
/** Home's main button: straight into choosing rooms (reopening an untouched draft rather than making another). */
export function StartDesigningButton({ className = "btn btn-primary btn-lg" }: { className?: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  // The page stays mounted (hidden) after navigating to the editor, so clear busy when hidden.
  useLayoutEffect(() => () => setBusy(false), []);
  return (
    <button
      type="button"
      className={className}
      disabled={busy}
      aria-busy={busy}
      onClick={async () => {
        setBusy(true);
        try {
          router.push(editorHref(await startDesigning(), "rooms"));
        } catch (error) {
          fail("Couldn't start a new design")(error);
          setBusy(false);
        }
      }}
      data-testid="start-rooms"
    >
      Start designing <ArrowRightIcon width={18} height={18} />
    </button>
  );
}

export function useStartTemplate() {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  // The page stays mounted (hidden) after navigating to the editor, so clear busy when hidden.
  useLayoutEffect(() => () => setBusy(null), []);
  const start = async (template: ProjectTemplate) => {
    if (busy) return;
    setBusy(template.id);
    try {
      router.push(editorHref(await createProjectFromTemplate(template)));
    } catch (error) {
      fail("Couldn't start from the template")(error);
      setBusy(null);
    }
  };
  return { busy, start };
}

export function TemplateCard({ template, onStart, busy }: { template: ProjectTemplate; onStart: () => void; busy: boolean }) {
  const plan = templatePreview(template);
  const areaText = useAreaText();
  return (
    <button type="button" className="home-card template-card" onClick={onStart} disabled={busy} aria-busy={busy} data-testid="template-card">
      <div className="card-media template-media">
        <TemplateExterior style={template.style} />
        <div className="template-plan plan-paper">{plan && <PlanThumbnail level={plan.levels[0]} plan={plan} palette="warm" className="card-plan" pad={0.6} />}</div>
      </div>
      <div className="card-body">
        <span className="card-title">{template.name}</span>
        <span className="card-meta">{busy ? "Creating project…" : `${areaText(templateArea(template))} · ${template.brief.bedrooms} bed · ${template.brief.bathrooms} bath`}</span>
      </div>
    </button>
  );
}

/** A small modal with focus kept inside; Escape cancels. */
export function SmallDialog({ title, onCancel, children }: { title: string; onCancel: () => void; children: ReactNode }) {
  const titleId = useId();
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    ref.current?.querySelector<HTMLElement>("input, button:not([disabled])")?.focus();
  }, []);
  return (
    <div className="dialog-backdrop" onPointerDown={(e) => e.target === e.currentTarget && onCancel()}>
      <div
        ref={ref}
        className="dialog dialog-sm"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            e.stopPropagation();
            onCancel();
          }
          if (e.key === "Tab" && ref.current) {
            const focusable = ref.current.querySelectorAll<HTMLElement>("input, button:not([disabled])");
            const first = focusable[0];
            const last = focusable[focusable.length - 1];
            if (e.shiftKey && document.activeElement === first) {
              e.preventDefault();
              last.focus();
            } else if (!e.shiftKey && document.activeElement === last) {
              e.preventDefault();
              first.focus();
            }
          }
        }}
      >
        <h2 id={titleId}>{title}</h2>
        {children}
      </div>
    </div>
  );
}

function RenameDialog({ name, onRename, onCancel }: { name: string; onRename: (name: string) => Promise<void>; onCancel: () => void }) {
  const [value, setValue] = useState(name);
  const [error, setError] = useState<string | null>(null);
  const id = useId();
  return (
    <SmallDialog title="Rename project" onCancel={onCancel}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          const trimmed = value.trim();
          if (!trimmed) return setError("Project name can't be empty.");
          void onRename(trimmed);
        }}
      >
        <div className="field">
          <label htmlFor={id}>Project name</label>
          <input id={id} value={value} maxLength={200} onChange={(e) => setValue(e.target.value)} onFocus={(e) => e.currentTarget.select()} />
        </div>
        {error && (
          <p className="field-error" role="alert">
            {error}
          </p>
        )}
        <div className="dialog-actions">
          <Button variant="ghost" onClick={onCancel}>
            Cancel
          </Button>
          <Button variant="primary" type="submit">
            Rename
          </Button>
        </div>
      </form>
    </SmallDialog>
  );
}
