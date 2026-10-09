"use client";

import Link from "next/link";
import { useId, useMemo, useState, type ReactNode } from "react";
import { ArrowRightIcon, BlankCanvasIcon, DimensionsIcon, ImportPlanIcon, PlayCircleIcon, PlusIcon, SparkleIcon } from "@/components/ui/icons";
import { PROJECT_TEMPLATES, templateArea } from "@/domain/project/templates";
import { PlanThumbnail } from "@/editor/components/designer/PlanThumbnail";
import type { ProjectSummary } from "@/persistence/planStorage";
import { useLibrary } from "../library";
import { setProfileName, useProfileName } from "../profile";
import { newProjectHref, useHomeUi } from "../ui";
import { ProjectCard, ProjectCardSkeleton, TemplateCard, useStartTemplate } from "./cards";
import { HeroIllustration, TemplateExterior, templatePreview } from "./illustrations";

const RECENT_COUNT = 4;

type Sort = "edited" | "name" | "created";

/** The library filtered by the header search, in the chosen order (the library lists most recently edited first). */
function useFilteredProjects(sort: Sort): { status: "loading" | "ready" | "error"; error: string | null; projects: ProjectSummary[]; query: string } {
  const { status, projects, error } = useLibrary((s) => s);
  const query = useHomeUi((s) => s.query.trim().toLowerCase());
  const filtered = useMemo(() => {
    const list = query ? projects.filter((p) => p.name.toLowerCase().includes(query)) : [...projects];
    if (sort === "name") list.sort((a, b) => a.name.localeCompare(b.name));
    if (sort === "created") list.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    return list;
  }, [projects, query, sort]);
  return { status, error, projects: filtered, query };
}

export function SectionHeader({ title, href, linkLabel }: { title: string; href?: string; linkLabel?: string }) {
  return (
    <div className="section-header">
      <h2>{title}</h2>
      {href && (
        <Link href={href} className="section-link">
          {linkLabel}
          <ArrowRightIcon width={17} height={17} />
        </Link>
      )}
    </div>
  );
}

function ProjectGrid({ limit, sort = "edited" }: { limit?: number; sort?: Sort }) {
  const { status, error, projects, query } = useFilteredProjects(sort);
  if (status === "loading") {
    return (
      <div className="card-grid" aria-busy="true">
        {Array.from({ length: limit ?? RECENT_COUNT }, (_, i) => (
          <ProjectCardSkeleton key={i} />
        ))}
      </div>
    );
  }
  if (status === "error") {
    return (
      <div className="empty-state" role="alert">
        <strong>Projects couldn&rsquo;t be loaded</strong>
        <span>{error} Projects are stored in this browser, so private windows or blocked site data can hide them.</span>
      </div>
    );
  }
  if (projects.length === 0) {
    return query ? (
      <div className="empty-state" data-testid="no-results">
        <strong>No projects match &ldquo;{query}&rdquo;</strong>
        <span>Try a different name, or start a new project.</span>
      </div>
    ) : (
      <div className="empty-state" data-testid="no-projects">
        <strong>No projects yet</strong>
        <span>Start one below — from scratch, from your measurements, or from a template.</span>
        <Link href={newProjectHref()} className="home-btn home-btn-primary">
          <PlusIcon width={18} height={18} />
          New project
        </Link>
      </div>
    );
  }
  const shown = limit && !query ? projects.slice(0, limit) : projects;
  return (
    <div className="card-grid" data-testid="project-grid">
      {shown.map((p) => (
        <ProjectCard key={p.id} project={p} />
      ))}
    </div>
  );
}

function StartOption({ Icon, title, text, href, testId }: { Icon: typeof BlankCanvasIcon; title: string; text: string; href: string; testId: string }) {
  return (
    <Link href={href} className="start-option" data-testid={testId}>
      <span className="start-icon" aria-hidden>
        <Icon width={40} height={40} />
      </span>
      <span className="start-text">
        <span className="start-title">{title}</span>
        <span className="start-desc">{text}</span>
      </span>
      <ArrowRightIcon width={22} height={22} className="start-arrow" />
    </Link>
  );
}

export function TemplateRow({ limit }: { limit?: number }) {
  const { busy, start } = useStartTemplate();
  return (
    <div className="card-grid">
      {PROJECT_TEMPLATES.slice(0, limit).map((t) => (
        <TemplateCard key={t.id} template={t} busy={busy === t.id} onStart={() => void start(t)} />
      ))}
    </div>
  );
}

export function HomeDashboard() {
  const query = useHomeUi((s) => s.query.trim());
  return (
    <>
      <section className="home-hero" aria-labelledby="hero-title">
        <div className="hero-copy">
          <h1 id="hero-title">Design your home</h1>
          <p>Create, explore and refine floor plans with the power of AI.</p>
          <div className="hero-actions">
            <Link href={newProjectHref()} className="home-btn home-btn-primary home-btn-lg">
              <PlusIcon width={20} height={20} />
              New project
            </Link>
            <Link href="/help" className="home-btn home-btn-light home-btn-lg">
              <PlayCircleIcon width={20} height={20} />
              See how it works
            </Link>
          </div>
        </div>
        <div className="hero-visual">
          <HeroIllustration />
        </div>
      </section>

      <section className="home-section" aria-label={query ? "Search results" : "Recent projects"}>
        <SectionHeader title={query ? "Search results" : "Recent projects"} href="/projects" linkLabel="View all" />
        <ProjectGrid limit={RECENT_COUNT} />
      </section>

      <section className="home-section">
        <SectionHeader title="Start a new project" />
        <div className="start-grid">
          <StartOption Icon={SparkleIcon} title="Pick your rooms" text="Choose bedrooms, bathrooms and spaces. We size the house and lay out options." href={newProjectHref("rooms")} testId="start-rooms" />
          <StartOption Icon={BlankCanvasIcon} title="Draw from scratch" text="Start with a blank outline and draw your floor plan." href={newProjectHref("scratch")} testId="start-scratch" />
          <StartOption Icon={DimensionsIcon} title="Enter dimensions" text="Create a plan using your measurements." href={newProjectHref("dimensions")} testId="start-dimensions" />
          <StartOption Icon={ImportPlanIcon} title="Import floor plan" text="Open a saved floor plan project file to get started." href={newProjectHref("import")} testId="start-import" />
        </div>
      </section>

      <section className="home-section">
        <SectionHeader title="Templates" href="/templates" linkLabel="Browse all" />
        <TemplateRow limit={4} />
      </section>
    </>
  );
}

function PageTitle({ title, lead, children }: { title: string; lead?: ReactNode; children?: ReactNode }) {
  return (
    <div className="page-title">
      <div>
        <h1>{title}</h1>
        {lead && <p>{lead}</p>}
      </div>
      {children}
    </div>
  );
}

export function AllProjectsPage() {
  const status = useLibrary((s) => s.status);
  const count = useLibrary((s) => s.projects.length);
  const [sort, setSort] = useState<Sort>("edited");
  const sortId = useId();
  return (
    <>
      <PageTitle title="Projects" lead={status === "ready" ? `${count} project${count === 1 ? "" : "s"} saved in this browser` : "\u00a0"}>
        <div className="sort-control">
          <label htmlFor={sortId}>Sort by</label>
          <select id={sortId} value={sort} onChange={(e) => setSort(e.target.value as Sort)}>
            <option value="edited">Last edited</option>
            <option value="name">Name</option>
            <option value="created">Date created</option>
          </select>
        </div>
      </PageTitle>
      <ProjectGrid sort={sort} />
    </>
  );
}

export function TemplatesPage() {
  const { busy, start } = useStartTemplate();
  return (
    <>
      <PageTitle title="Templates" lead="Start from a complete ground-floor layout, then change anything — walls, rooms, doors and windows all stay editable." />
      <div className="template-list">
        {PROJECT_TEMPLATES.map((t) => {
          const plan = templatePreview(t);
          return (
            <article key={t.id} className="home-card template-detail">
              <div className="template-detail-media">
                <TemplateExterior style={t.style} />
                <div className="plan-paper">{plan && <PlanThumbnail level={plan.levels[0]} palette="warm" className="card-plan" pad={0.6} detail />}</div>
              </div>
              <div className="template-detail-body">
                <h2>{t.name}</h2>
                <p>{t.description}</p>
                <dl>
                  <div>
                    <dt>Footprint</dt>
                    <dd>
                      {t.width} × {t.depth} m
                    </dd>
                  </div>
                  <div>
                    <dt>Area</dt>
                    <dd>{templateArea(t)} m²</dd>
                  </div>
                  <div>
                    <dt>Rooms</dt>
                    <dd>
                      {t.brief.bedrooms} bed · {t.brief.bathrooms} bath
                    </dd>
                  </div>
                </dl>
                <button type="button" className="home-btn home-btn-primary" disabled={!!busy} onClick={() => void start(t)}>
                  {busy === t.id ? "Creating project…" : "Use this template"}
                </button>
              </div>
            </article>
          );
        })}
      </div>
    </>
  );
}

const STEPS = [
  {
    title: "Start a project",
    text: "Enter the outside dimensions of your house, pick a template, or open a saved project file. Every project is saved automatically in this browser.",
  },
  {
    title: "Draw the structure",
    text: "In the Structure workspace, draw internal walls, click inside a space to name the room and set its use, then place doors and windows on any wall. Drag walls and openings to adjust them; dimensions update as you go.",
  },
  {
    title: "Explore layouts with AI",
    text: "In the Design workspace, describe what you need — bedrooms, bathrooms, open-plan living — and the AI Designer lays out alternative plans. Each one is added as a new variation, so your own plan is never overwritten.",
  },
  {
    title: "Compare, refine and export",
    text: "Switch between variations in the tray, keep refining the one you like, and export a project file or an image of the plan.",
  },
];

const SHORTCUTS: Array<[string, string]> = [
  ["V", "Select"],
  ["W", "Wall"],
  ["R", "Room"],
  ["D", "Door"],
  ["N", "Window"],
  ["1 / 2", "Structure / Design workspace"],
  ["⌘Z / ⇧⌘Z", "Undo / redo"],
  ["Esc", "Finish a wall chain or cancel"],
];

export function HelpPage() {
  return (
    <>
      <PageTitle title="How it works" lead="From an empty outline to a set of layouts you can compare, in four steps." />
      <ol className="help-steps">
        {STEPS.map((s, i) => (
          <li key={s.title} className="home-card">
            <span className="help-step-number">{i + 1}</span>
            <div>
              <h2>{s.title}</h2>
              <p>{s.text}</p>
            </div>
          </li>
        ))}
      </ol>
      <section className="home-section">
        <SectionHeader title="Keyboard shortcuts" />
        <dl className="shortcut-list home-card">
          {SHORTCUTS.map(([keys, action]) => (
            <div key={action}>
              <dt>
                <kbd>{keys}</kbd>
              </dt>
              <dd>{action}</dd>
            </div>
          ))}
        </dl>
      </section>
      <div className="help-cta">
        <Link href={newProjectHref()} className="home-btn home-btn-primary home-btn-lg">
          <PlusIcon width={20} height={20} />
          Start a project
        </Link>
      </div>
    </>
  );
}

export function SettingsPage() {
  const name = useProfileName();
  const count = useLibrary((s) => (s.status === "ready" ? s.projects.length : null));
  const nameId = useId();
  return (
    <>
      <PageTitle title="Settings" />
      <section className="home-card settings-card">
        <h2>Profile</h2>
        <p className="settings-lead">Your name is shown in the sidebar. It stays in this browser.</p>
        <div className="field">
          <label htmlFor={nameId}>Display name</label>
          <input
            id={nameId}
            key={name}
            defaultValue={name}
            maxLength={60}
            placeholder="e.g. Alex Murphy"
            data-testid="profile-name"
            onBlur={(e) => setProfileName(e.currentTarget.value)}
            onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
          />
        </div>
      </section>
      <section className="home-card settings-card">
        <h2>Storage</h2>
        <p className="settings-lead">
          Projects are saved automatically in this browser{count !== null ? ` (${count} project${count === 1 ? "" : "s"})` : ""}. They aren&rsquo;t synced to other
          devices, and clearing site data removes them — download a project file from a project&rsquo;s menu to keep a copy.
        </p>
      </section>
    </>
  );
}
