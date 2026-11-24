"use client";

import Link from "next/link";
import { useId, useMemo, useState, type ReactNode } from "react";
import { SegmentedControl, Toggle } from "@/components/ui/controls";
import { ArrowRightIcon, PlayCircleIcon } from "@/components/ui/icons";
import { setAreaUnits, useAreaText, useImperial, useSquareFeet } from "@/components/units";
import { PROJECT_TEMPLATES, templateArea } from "@/domain/project/templates";
import { PlanThumbnail } from "@/editor/components/designer/PlanThumbnail";
import type { ProjectSummary } from "@/persistence/planStorage";
import { refreshLibrary, useLibrary } from "../library";
import { setProfileName, useProfileName } from "../profile";
import { newProjectHref, useHomeUi } from "../ui";
import { isUntouchedDraft } from "../drafts";
import { OpenBackup } from "./OpenBackup";
import { ProjectCard, ProjectCardSkeleton, StartDesigningButton, TemplateCard, useStartTemplate } from "./cards";
import { HeroIllustration, TemplateExterior, templatePreview } from "./illustrations";

const RECENT_COUNT = 4;

type Sort = "edited" | "name" | "created";

/** The library filtered by the header search, in the chosen order (the library lists most recently edited first). */
function useFilteredProjects(sort: Sort): { status: "loading" | "ready" | "error"; error: string | null; projects: ProjectSummary[]; query: string } {
  const { status, projects, error } = useLibrary((s) => s);
  const query = useHomeUi((s) => s.query.trim().toLowerCase());
  const filtered = useMemo(() => {
    // Drafts nobody has started on yet ("Start designing" reopens them) aren't listed.
    const real = projects.filter((p) => !(p.project && isUntouchedDraft(p.project)));
    const list = query ? real.filter((p) => p.name.toLowerCase().includes(query)) : real;
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
  const { status, projects, query } = useFilteredProjects(sort);
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
        <strong>Couldn&rsquo;t read your saved projects in this browser</strong>
        <span>Projects are kept in this browser, so private windows or blocked site data can hide them.</span>
        <button type="button" className="btn btn-secondary" onClick={() => void refreshLibrary()}>
          Try again
        </button>
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
        <span>Choose your rooms and you&rsquo;ll have five floor plans in seconds.</span>
        <StartDesigningButton className="btn btn-primary btn-md" />
        <Link href="/start/describe" data-testid="home-describe">
          Or describe your dream home
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
  // Recent shows once there's something in it (or while it's loading, or a search is on).
  const showRecent = useLibrary((s) => s.status !== "ready" || s.projects.some((p) => !(p.project && isUntouchedDraft(p.project))));
  return (
    <>
      <section className="home-hero" aria-labelledby="hero-title">
        <div className="hero-copy">
          <h1 id="hero-title">Design your home</h1>
          <p>Choose your rooms and get five floor plans in seconds. Then move walls, furnish it and walk round it in 3D.</p>
          <div className="hero-actions">
            <StartDesigningButton />
            <Link href="/help" className="btn btn-secondary btn-lg">
              <PlayCircleIcon width={20} height={20} />
              See how it works
            </Link>
          </div>
        </div>
        <div className="hero-visual">
          <HeroIllustration />
        </div>
      </section>

      <nav className="other-starts" aria-label="Other ways to start">
        <span>Other ways to start:</span>
        <Link href={newProjectHref("scratch")} data-testid="start-scratch">
          Draw it yourself
        </Link>
        <Link href={newProjectHref("dimensions")} data-testid="start-dimensions">
          Enter your house&rsquo;s size
        </Link>
        <Link href={newProjectHref("import")} data-testid="start-import">
          Open a saved file
        </Link>
      </nav>

      {(showRecent || query) && (
        <section className="home-section" aria-label={query ? "Search results" : "Your projects"}>
          <SectionHeader title={query ? "Search results" : "Your projects"} href="/projects" linkLabel="View all" />
          <ProjectGrid limit={RECENT_COUNT} />
        </section>
      )}

      <section className="home-section">
        <SectionHeader title="Templates" href="/templates" linkLabel="Browse all" />
        <TemplateRow limit={4} />
      </section>
    </>
  );
}

export function PageTitle({ title, lead, children }: { title: string; lead?: ReactNode; children?: ReactNode }) {
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
        <OpenBackup />
      </PageTitle>
      <p className="field-hint">Projects live only on this device. Use “Download backup” on a project’s menu to keep a copy.</p>
      <ProjectGrid sort={sort} />
    </>
  );
}

export function TemplatesPage() {
  const { busy, start } = useStartTemplate();
  const areaText = useAreaText();
  return (
    <>
      <PageTitle title="Templates" lead="Start from a complete ground-floor layout, then change anything: walls, rooms, doors and windows all stay editable." />
      <div className="template-list">
        {PROJECT_TEMPLATES.map((t) => {
          const plan = templatePreview(t);
          return (
            <article key={t.id} className="home-card template-detail">
              <div className="template-detail-media">
                <TemplateExterior style={t.style} />
                <div className="plan-paper">{plan && <PlanThumbnail level={plan.levels[0]} plan={plan} palette="warm" className="card-plan" pad={0.6} detail />}</div>
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
                    <dd>{areaText(templateArea(t))}</dd>
                  </div>
                  <div>
                    <dt>Rooms</dt>
                    <dd>
                      {t.brief.bedrooms} bed · {t.brief.bathrooms} bath
                    </dd>
                  </div>
                </dl>
                <button type="button" className="btn btn-primary btn-md" disabled={!!busy} onClick={() => void start(t)}>
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
    title: "Map",
    text: "Optionally, say how big your plot is, how much garden to leave front, back and sides, and which way is north. Leave it blank and each house is sized to its rooms.",
  },
  {
    title: "Requirements",
    text: "Say how many bedrooms, bathrooms and living spaces you want, the shape of house, and whether it has one storey or two. The plan beside the list redraws as you go. Add notes about anything else in your own words.",
  },
  {
    title: "Explore",
    text: "Get five layouts drawn from your rooms, each with the house from the garden and its plan at the same scale. Each has a name that says how it differs, and things to check. Ask for more layouts whenever you like.",
  },
  {
    title: "Refine",
    text: "Open the layout you like. Click a room to rename it, resize it or swap it with another, drag walls, doors and windows, ask for changes in your own words, and add furniture. Switch between the 2D plan, 3D and the furnished plan at the top. Add a floor (up to three) and put in stairs.",
  },
  {
    title: "Review",
    text: "See the design summed up with its rooms, finishes and things to check, change the roof and finishes in 3D, turn rooms into photos, and download a presentation image, the plan, a 3D model or the project file.",
  },
];

const SHORTCUTS: Array<[string, string]> = [
  ["1 2 3 4 5", "Map, Requirements, Explore, Refine, Review"],
  ["⇧1 ⇧2 ⇧3", "2D Plan, 3D View, Furnished"],
  ["V", "Select"],
  ["U", "Furniture"],
  ["W", "Wall"],
  ["D", "Door"],
  ["N", "Window"],
  ["S", "Stairs, with two or more floors"],
  ["Page Up / Page Down", "The floor above or below"],
  ["L", "List of rooms and walls"],
  ["F", "Fit the plan to the screen"],
  ["⌘Z / ⇧⌘Z", "Undo / redo"],
  ["Esc", "Cancel, or finish a wall"],
];

export function HelpPage() {
  return (
    <>
      <PageTitle title="How it works" lead="From a list of rooms to a house you can walk round, in five steps. Everything saves as you go, in this browser." />
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
      <p className="help-next">Coming next: sharing and imperial units.</p>
      <div className="help-cta">
        <StartDesigningButton />
      </div>
    </>
  );
}

export function SettingsPage() {
  const name = useProfileName();
  const count = useLibrary((s) => (s.status === "ready" ? s.projects.length : null));
  const sqft = useSquareFeet();
  const imperial = useImperial();
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
        <h2>Units</h2>
        <p className="settings-lead">How lengths and areas are shown and typed. Plans are saved the same either way.</p>
        <SegmentedControl
          label="Units"
          value={imperial ? "imperial" : "metric"}
          options={[
            { value: "metric", label: "Metric (m)" },
            { value: "imperial", label: "Imperial (ft-in)" },
          ]}
          onChange={(u) => setAreaUnits(u === "imperial" ? "imperial" : "auto")}
          testIdPrefix="setting-units"
        />
        {!imperial && <Toggle label="Show square feet too" hint="e.g. 152 m² · 1,636 sq ft" checked={sqft} onChange={() => setAreaUnits(sqft ? "metric" : "both")} testId="setting-sqft" />}
      </section>
      <section className="home-card settings-card">
        <h2>Storage</h2>
        <p className="settings-lead">
          Projects are saved automatically in this browser{count !== null ? ` (${count} project${count === 1 ? "" : "s"})` : ""}. They aren&rsquo;t synced to other
          devices, and clearing site data removes them. To keep a copy, download a project file from a project&rsquo;s menu.
        </p>
      </section>
    </>
  );
}
