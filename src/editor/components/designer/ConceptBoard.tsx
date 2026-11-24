"use client";

import { useEffect, useState, type KeyboardEvent } from "react";
import { PLAN_FEATURE_LABEL } from "@/domain/design/analysis";
import { Menu, MenuItem } from "@/components/ui/controls";
import { MoreIcon, SparkleIcon, WarningIcon } from "@/components/ui/icons";
import { sizeText, useAreaText } from "@/components/units";
import { design, editor, useProjectState, useSessionState } from "../../state/editor";
import type { Generation } from "../../state/stores";
import { LAYOUTS_PER_RUN } from "../../state/design";
import { generateFromRooms, goToStep, openConcept } from "../shell/tools";
import { revealPlot } from "../site/MapWorkspace";
import { ConceptDetail } from "./ConceptDetail";
import { ExteriorPicture } from "./ExteriorPicture";
import { checkPlacements, missNote } from "@/domain/design/placement";
import { HousePreview } from "./ConceptPreview";
import { useConcepts, type Concept } from "./concepts";

/** The loading state shows for at least this long, so a fast plan doesn't flicker. */
const MIN_LOADING_MS = 600;

/**
 * The Layouts step: every plan in the project, side by side at one scale,
 * grouped by the set it was made in. Picking a card shows it in the side
 * panel; "Refine this layout" opens it. Nothing here changes a plan.
 */
export function ConceptBoard() {
  const workspace = useSessionState((s) => s.workspace);
  const view = useSessionState((s) => s.designView);
  if (workspace !== "design" || view !== "board") return null;
  return <LayoutsPage />;
}

/**
 * Whether a generation is still shown as loading: while it runs, and for a
 * moment after a quick success so the layouts arrive rather than flicker in.
 */
function useLoading(generation: Generation | null): boolean {
  const busy = generation?.phase === "reading" || generation?.phase === "planning";
  const settledAt = generation ? generation.startedAt + MIN_LOADING_MS : 0;
  // Coming back to Layouts later shouldn't replay the loading moment.
  const [settled, setSettled] = useState<number | null>(() => (generation?.phase === "done" && Date.now() >= settledAt ? settledAt : null));
  useEffect(() => {
    if (busy || generation?.phase !== "done") return;
    const t = setTimeout(() => setSettled(settledAt), Math.max(0, settledAt - Date.now()));
    return () => clearTimeout(t);
  }, [busy, generation, settledAt]);
  return busy || (generation?.phase === "done" && settled !== settledAt);
}

interface Group {
  key: string;
  heading: string;
  concepts: Concept[];
}

/** Sets in the order they were made: generated sets by request, then the user's own plans and copies. */
function groupsOf(concepts: Concept[]): Group[] {
  const sets = new Map<string, Concept[]>();
  const yours: Concept[] = [];
  for (const c of concepts) {
    const o = c.meta.origin;
    if (o.kind === "generated" && c.meta.scope.kind === "plan" && !c.edited) sets.set(o.requestId, [...(sets.get(o.requestId) ?? []), c]);
    else yours.push(c);
  }
  const groups: Group[] = [...sets.entries()].map(([key, list], i) => ({ key, heading: i === 0 ? "Your layouts" : `${list.length} more`, concepts: list }));
  if (yours.length) groups.push({ key: "yours", heading: "Your plans", concepts: yours });
  return groups;
}

/** Notes every layout in the latest set shares (e.g. what was combined to fit), said once. */
function sharedNotes(group: Group | undefined): string[] {
  if (!group || !group.concepts.length) return [];
  const notesOf = (c: Concept) => (c.meta.origin.kind === "generated" ? (c.meta.origin.notes ?? []) : []);
  const [first, ...rest] = group.concepts;
  return notesOf(first).filter((n) => rest.every((c) => notesOf(c).includes(n)));
}

function LayoutsPage() {
  const { concepts, recommendedId } = useConcepts();
  const focusPlanId = useSessionState((s) => s.designer.focusPlanId);
  const generation = useSessionState((s) => s.designer.generation);
  const running = useSessionState((s) => s.designer.status === "running");
  const brief = useProjectState((s) => s.brief);
  const sizing = useProjectState((s) => s.sizing);
  const loading = useLoading(generation);

  const focused = concepts.find((c) => c.meta.id === focusPlanId) ?? concepts.find((c) => c.meta.id === recommendedId) ?? concepts[0] ?? null;
  const groups = groupsOf(concepts);
  const latest = groups.filter((g) => g.key !== "yours").at(-1);
  const notes = sharedNotes(latest);
  // Every card draws its house at one scale, so sizes compare honestly.
  const frame = concepts.reduce(
    (m, c) => {
      const o = c.assessment.outside;
      return o ? { w: Math.max(m.w, o.width), h: Math.max(m.h, o.depth) } : m;
    },
    { w: 0, h: 0 },
  );
  const focus = (id: string) => editor.setDesigner({ focusPlanId: id });
  // A new set (or a deleted focus) shows the recommended layout first.
  const focusedId = focused?.meta.id ?? null;
  useEffect(() => {
    if (focusedId && focusedId !== focusPlanId) editor.setDesigner({ focusPlanId: focusedId });
  }, [focusedId, focusPlanId]);
  const failed = !loading && (generation?.phase === "nofit" || generation?.phase === "failed") ? generation : null;

  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key === "Enter" && focused) {
      e.preventDefault();
      openConcept(focused.meta.id);
    }
  };

  return (
    <section className="layouts-page" aria-labelledby="layouts-title" data-testid="concept-board">
      <div className="layouts-main">
        <header className="layouts-header">
          <div>
            <h1 id="layouts-title">Your layouts</h1>
            <p>
              {brief.bedrooms} bed · {brief.bathrooms} bath ·{" "}
              {sizing?.footprint === "auto" ? "each house is sized to fit the rooms you chose." : "laid out in your house."}
            </p>
            {notes.map((n) => (
              <p key={n} className="layouts-note" data-testid="layouts-note">
                {n}{" "}
                <button type="button" className="link-btn" onClick={() => goToStep("requirements")}>
                  Edit rooms
                </button>
              </p>
            ))}
          </div>
          <div className="layouts-actions">
            <button type="button" className="btn btn-ghost btn-md" onClick={() => goToStep("requirements")} data-testid="shell-edit-brief">
              Edit rooms
            </button>
            {concepts.length > 0 && (
              <button type="button" className="btn btn-secondary btn-md" disabled={running || loading} onClick={() => void design.generateMore()} data-testid="generate-more">
                More layouts
              </button>
            )}
            {concepts.length > 0 && (
              <Menu label="More layout actions" align="right" testId="layouts-more" className="layouts-more" summary={<MoreIcon width={18} height={18} />}>
                <MenuItem onSelect={() => void design.regenerate()} disabled={running || loading} data-testid="regenerate">
                  Start again with new layouts
                </MenuItem>
              </Menu>
            )}
          </div>
        </header>

        {failed && concepts.length > 0 && (
          <p className="layouts-problem" role="alert" data-testid="layouts-problem">
            <WarningIcon width={16} height={16} /> {failed.message}
          </p>
        )}

        {concepts.length === 0 && !loading ? (
          failed ? (
            <EmptyState
              title={failed.phase === "nofit" ? "These rooms don't fit yet" : "That didn't work"}
              text={failed.message ?? ""}
              actions={
                failed.phase === "nofit" ? (
                  <>
                    <button type="button" className="btn btn-primary btn-md" onClick={() => goToStep("requirements")} data-testid="nofit-remove-room">
                      Remove a room
                    </button>
                    <button type="button" className="btn btn-secondary btn-md" onClick={revealPlot} data-testid="nofit-bigger-plot">
                      Allow a bigger plot
                    </button>
                  </>
                ) : (
                  <button type="button" className="btn btn-primary btn-md" onClick={() => void generateFromRooms()} data-testid="layouts-retry">
                    Try again
                  </button>
                )
              }
            />
          ) : (
            <EmptyState
              title="No layouts yet"
              text="Choose your rooms and we'll lay out five options to compare."
              actions={
                <button type="button" className="btn btn-primary btn-md" onClick={() => goToStep("requirements")} data-testid="board-go-brief">
                  Choose your rooms
                </button>
              }
            />
          )
        ) : (
          <div className="layouts-groups" role="radiogroup" aria-label="Layouts" onKeyDown={onKeyDown}>
            {groups.map((g) => (
              <section key={g.key} className="layouts-group" aria-label={g.heading}>
                {groups.length > 1 && <h2>{g.heading}</h2>}
                <div className="layouts-grid">
                  {g.concepts.map((c) => (
                    <LayoutCard key={c.meta.id} concept={c} frame={frame} recommended={c.meta.id === recommendedId} selected={c.meta.id === focused?.meta.id} onFocus={() => focus(c.meta.id)} />
                  ))}
                </div>
              </section>
            ))}
            {loading && <LoadingSet reading={generation?.phase === "reading"} />}
          </div>
        )}
      </div>

      {focused && !(loading && concepts.length === 0) && <ConceptDetail concept={focused} />}
    </section>
  );
}

function EmptyState({ title, text, actions }: { title: string; text: string; actions: React.ReactNode }) {
  return (
    <div className="layouts-empty" data-testid="layouts-empty">
      <SparkleIcon width={22} height={22} />
      <h2>{title}</h2>
      <p>{text}</p>
      <div className="layouts-empty-actions">{actions}</div>
    </div>
  );
}

/** A card outline for each layout being made, with what's happening. */
function LoadingSet({ reading }: { reading: boolean }) {
  return (
    <section className="layouts-group" aria-busy="true" aria-live="polite" data-testid="layouts-loading">
      <h2>{reading ? "Reading your notes…" : "Laying out your rooms…"}</h2>
      <div className="layouts-grid">
        {Array.from({ length: LAYOUTS_PER_RUN }, (_, i) => (
          <div key={i} className="layout-card is-loading" aria-hidden>
            <span className="layout-art skeleton" />
            <span className="layout-meta">
              <span className="skeleton skeleton-line" />
              <span className="skeleton skeleton-line is-short" />
            </span>
          </div>
        ))}
      </div>
    </section>
  );
}

/** The exterior still on a card: 16:9, twice its shown size. */
const CARD_STILL = { width: 640, height: 360 };

function LayoutCard({ concept, frame, recommended, selected, onFocus }: { concept: Concept; frame: { w: number; h: number }; recommended: boolean; selected: boolean; onFocus: () => void }) {
  const { meta, assessment: a } = concept;
  const [renaming, setRenaming] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const areaText = useAreaText();
  const open = () => openConcept(meta.id);
  const findings = concept.sense.findings.length;
  // A room placed on the house that this layout puts somewhere else.
  const brief = useProjectState((s) => s.brief);
  const miss = brief.placements && brief.rooms ? checkPlacements(concept.plan, brief.placements, brief.rooms).find((c) => !c.honoured) : undefined;
  return (
    <label className={`layout-card${selected ? " is-selected" : ""}`} onDoubleClick={open} data-testid={`concept-${meta.label}`}>
      <input type="radio" name="layout" className="visually-hidden" checked={selected} onChange={onFocus} aria-label={`${concept.letter}: ${concept.title}`} />
      <ExteriorPicture planId={meta.id} level={concept.plan} size={CARD_STILL} badge={false} className="layout-exterior" />
      <span className="layout-art">
        <HousePreview plan={concept.plan} palette="schematic" site={false} frame={frame} margin={0.8} className="layout-preview" />
        <span className="layout-badges">
          <span className="layout-letter">{concept.letter}</span>
          {recommended && (
            <span className="layout-recommended" data-testid="recommended">
              Recommended
            </span>
          )}
        </span>
      </span>
      <span className="layout-meta">
        <span className="layout-title-row">
          {renaming ? (
            <input
              className="layout-rename"
              aria-label="Layout name"
              defaultValue={meta.label}
              maxLength={60}
              autoFocus
              onClick={(e) => e.stopPropagation()}
              onBlur={(e) => {
                editor.renamePlan(meta.id, e.currentTarget.value);
                setRenaming(false);
              }}
              onKeyDown={(e) => {
                e.stopPropagation();
                if (e.key === "Enter") e.currentTarget.blur();
                if (e.key === "Escape") setRenaming(false);
              }}
            />
          ) : (
            <strong className="layout-title">{concept.title}</strong>
          )}
          <span onClick={(e) => e.stopPropagation()}>
            <Menu label={`More actions for ${meta.label}`} align="right" testId={`concept-menu-${meta.label}`} className="concept-menu" summary={<MoreIcon width={18} height={18} />}>
              <MenuItem onSelect={open}>Refine</MenuItem>
              <MenuItem onSelect={() => setRenaming(true)}>Rename…</MenuItem>
              <MenuItem onSelect={() => editor.duplicatePlan(meta.id, false)} data-testid={`concept-duplicate-${meta.label}`}>
                Make a copy
              </MenuItem>
              {meta.origin.kind === "generated" && (
                <MenuItem onSelect={() => void design.generateSimilar(meta.id)} data-testid={`concept-similar-${meta.label}`}>
                  Show similar layouts
                </MenuItem>
              )}
              <hr />
              <MenuItem className="is-danger" onSelect={() => setConfirming(true)} data-testid={`concept-delete-${meta.label}`}>
                Delete
              </MenuItem>
            </Menu>
          </span>
        </span>
        <span className="layout-facts">
          {a.bedrooms} bed · {a.bathrooms} bath · {areaText(a.totalArea)}
          {a.storeys ? ` · ${a.storeys} storeys` : ""}
          {a.outside ? ` · ${sizeText(a.outside.width, a.outside.depth, 1)}` : ""}
        </span>
        <span className="chips layout-chips">
          {a.features.slice(0, 2).map((f) => (
            <span key={f} className="chip is-static">
              {PLAN_FEATURE_LABEL[f]}
            </span>
          ))}
        </span>
        {miss && (
          <span className="layout-miss" data-testid={`concept-miss-${meta.label}`}>
            {missNote(miss)}
          </span>
        )}
        {findings > 0 && (
          <span className="layout-check" data-testid={`concept-check-${meta.label}`}>
            <WarningIcon width={14} height={14} /> {findings === 1 ? "1 thing to check" : `${findings} things to check`}
          </span>
        )}
        {confirming && (
          <span className="layout-confirm" onClick={(e) => e.stopPropagation()}>
            <span>Delete this layout?</span>
            <button type="button" className="btn btn-sm btn-secondary" onClick={() => setConfirming(false)}>
              Keep
            </button>
            <button type="button" className="btn btn-sm btn-danger" onClick={() => editor.deletePlan(meta.id)} data-testid={`concept-delete-confirm-${meta.label}`}>
              Delete
            </button>
          </span>
        )}
      </span>
    </label>
  );
}
