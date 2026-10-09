"use client";

import { useLayoutEffect, useState } from "react";
import { PLAN_FEATURE_LABEL } from "@/domain/design/analysis";
import { analyzeEnvelope } from "@/domain/geometry/envelope";
import { describeOutline } from "@/domain/geometry/outlineDescription";
import { Menu, MenuItem } from "@/components/ui/controls";
import {
  AreaIcon,
  ArrowRightIcon,
  BathIcon,
  BedIcon,
  CheckIcon,
  MoreIcon,
  PlusIcon,
  RefreshIcon,
  SofaIcon,
  SparkleIcon,
  WarningIcon,
} from "@/components/ui/icons";
import { design, editor, useProjectState, useSessionState } from "../../state/editor";
import { BoardDock, usePanZoom } from "./board";
import { openConcept, selectWorkspace } from "../shell/tools";
import { ConceptDetail } from "./ConceptDetail";
import { ConceptPreview } from "./ConceptPreview";
import { CardPhotos } from "./RoomGallery";
import { useConcepts, type Concept, type PlanEntry } from "./concepts";

/**
 * Designs, side by side: every generated concept on a pannable, zoomable
 * board with its key numbers, beside the user's own starting plan. Choosing
 * one opens it for refining; nothing here changes a plan.
 */
export function ConceptBoard() {
  const workspace = useSessionState((s) => s.workspace);
  const view = useSessionState((s) => s.designView);
  if (workspace !== "design" || view !== "board") return null;
  return <Board />;
}

function Board() {
  const { shells, concepts, recommendedId } = useConcepts();
  const focusPlanId = useSessionState((s) => s.designer.focusPlanId);
  const running = useSessionState((s) => s.designer.status === "running");
  const gridVisible = useSessionState((s) => s.settings.gridVisible);
  const [detailOpen, setDetailOpen] = useState(true);

  const focused = concepts.find((c) => c.meta.id === focusPlanId) ?? concepts.find((c) => c.meta.id === recommendedId) ?? concepts[0] ?? null;
  const { view, viewport, content, handlers, viewportStyle, contentStyle, zoomBy, fit } = usePanZoom(detailOpen && focused ? 360 : 0);
  const focus = (id: string) => {
    editor.setDesigner({ focusPlanId: id });
    setDetailOpen(true);
  };

  // Frame the concepts when the board opens or the set changes.
  const key = concepts.map((c) => c.meta.id).join();
  useLayoutEffect(() => {
    fit();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  const count = concepts.length;
  return (
    <section className={`concept-board${gridVisible ? " has-grid" : ""}`} aria-label="Design concepts" data-testid="concept-board">
      <header className="board-header">
        <div>
          <h1>Design concepts</h1>
          <p>
            {count
              ? `${count} layout${count === 1 ? "" : "s"} based on your brief. Compare the options and choose one to refine.`
              : "Generate layouts from your brief to compare them here."}
          </p>
          {shells.map((s) => (
            <StartingPoint key={s.meta.id} entry={s} />
          ))}
        </div>
        <div className="board-actions">
          <button
            type="button"
            className="btn btn-outline"
            disabled={running}
            onClick={() => void design.regenerate()}
            data-tooltip="Replace unedited concepts with a fresh set from the brief"
            data-tooltip-side="bottom"
            data-testid="regenerate"
          >
            <RefreshIcon width={17} height={17} /> Regenerate
          </button>
          <button type="button" className="btn btn-primary" disabled={running} onClick={() => void design.generateMore()} data-testid="generate-more">
            <PlusIcon width={17} height={17} /> {running ? "Generating…" : "Generate more"}
          </button>
        </div>
      </header>

      <div ref={viewport} className="board-viewport" {...handlers} style={viewportStyle}>
        <div ref={content} className="board-content" style={contentStyle}>
          {concepts.map((c) => (
            <ConceptCard key={c.meta.id} concept={c} recommended={c.meta.id === recommendedId} selected={detailOpen && c.meta.id === focused?.meta.id} onFocus={() => focus(c.meta.id)} />
          ))}
          {!count && (
            <div className="board-empty">
              <SparkleIcon width={22} height={22} />
              <h2>No concepts yet</h2>
              <p>Tell us what the house needs and we&rsquo;ll lay out several options to compare.</p>
              <button type="button" className="btn btn-primary" onClick={() => selectWorkspace("brief")} data-testid="board-go-brief">
                Open the brief <ArrowRightIcon width={16} height={16} />
              </button>
            </div>
          )}
        </div>
      </div>

      {detailOpen && focused && <ConceptDetail concept={focused} onClose={() => setDetailOpen(false)} />}

      <BoardDock k={view.k} zoomBy={zoomBy} fit={fit} />
    </section>
  );
}

/** The user's own plan, where every concept starts from, with the ways back to it. */
function StartingPoint({ entry }: { entry: PlanEntry }) {
  const env = analyzeEnvelope(entry.level);
  const sizing = useProjectState((s) => s.sizing);
  if (sizing?.footprint === "auto") {
    const plot = sizing.plot;
    return (
      <div className="starting-point" data-testid={`shell-${entry.meta.label}`}>
        <span>
          Starting point: <strong>your rooms</strong> · each house is sized to fit them
          {plot?.maxWidth || plot?.maxDepth ? ` (plot up to ${plot.maxWidth ?? "any"} × ${plot.maxDepth ?? "any"} m)` : ""}
        </span>
        <button type="button" className="link-btn" onClick={() => selectWorkspace("brief")} data-testid="shell-edit-brief">
          Edit rooms
        </button>
      </div>
    );
  }
  return (
    <div className="starting-point" data-testid={`shell-${entry.meta.label}`}>
      <span className="starting-thumb">
        <ConceptPreview level={entry.level} labels={false} margin={0.8} />
      </span>
      <span>
        Starting point: <strong>{entry.meta.label}</strong>
        {env.ok && ` · ${env.info.isRectangle ? "" : `${describeOutline(env.info).words}, `}${env.info.width.toFixed(1)} × ${env.info.depth.toFixed(1)} m shell`}
      </span>
      <button
        type="button"
        className="link-btn"
        onClick={() => {
          editor.switchPlan(entry.meta.id);
          selectWorkspace("structure");
        }}
      >
        Edit structure
      </button>
      <button type="button" className="link-btn" onClick={() => selectWorkspace("brief")} data-testid="shell-edit-brief">
        Edit brief
      </button>
      <button type="button" className="link-btn" onClick={() => openConcept(entry.meta.id)} data-testid="shell-refine">
        Open to refine
      </button>
    </div>
  );
}

function ConceptCard({ concept, recommended, selected, onFocus }: { concept: Concept; recommended: boolean; selected: boolean; onFocus: () => void }) {
  const { meta, assessment: a } = concept;
  const [renaming, setRenaming] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const open = () => openConcept(meta.id);
  return (
    <article
      className={`concept-card board-card${selected ? " is-selected" : ""}`}
      onClick={onFocus}
      onDoubleClick={open}
      aria-label={`Concept ${concept.letter}: ${concept.title}`}
      data-testid={`concept-${meta.label}`}
    >
      <div className="concept-media">
        <ConceptPreview level={concept.level} />
        <span className="concept-letter">{concept.letter}</span>
        {recommended && (
          <span className="concept-badge" data-testid="recommended">
            Recommended
          </span>
        )}
      </div>
      <CardPhotos planId={meta.id} level={concept.level} />
      <div className="concept-body">
        <div className="concept-title-row">
          {renaming ? (
            <input
              className="concept-rename"
              aria-label="Concept name"
              defaultValue={meta.label}
              maxLength={60}
              autoFocus
              onClick={(e) => e.stopPropagation()}
              onBlur={(e) => {
                editor.renamePlan(meta.id, e.currentTarget.value);
                setRenaming(false);
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter") e.currentTarget.blur();
                if (e.key === "Escape") setRenaming(false);
              }}
            />
          ) : (
            <h3>
              {concept.letter}. {concept.title}
            </h3>
          )}
          <span onClick={(e) => e.stopPropagation()}>
            <Menu label={`More actions for ${meta.label}`} align="right" testId={`concept-menu-${meta.label}`} className="concept-menu" summary={<MoreIcon width={18} height={18} />}>
              <MenuItem onSelect={open}>Open</MenuItem>
              <MenuItem onSelect={() => setRenaming(true)}>Rename…</MenuItem>
              <MenuItem onSelect={() => editor.duplicatePlan(meta.id, false)} data-testid={`concept-duplicate-${meta.label}`}>
                Duplicate
              </MenuItem>
              <MenuItem onSelect={() => void design.generateSimilar(meta.id)} data-testid={`concept-similar-${meta.label}`}>
                Generate similar
              </MenuItem>
              <hr />
              <MenuItem className="is-danger" onSelect={() => setConfirming(true)} data-testid={`concept-delete-${meta.label}`}>
                Delete
              </MenuItem>
            </Menu>
          </span>
        </div>
        <p className="concept-desc">{concept.description}</p>
        <ul className="concept-chips" aria-label="Characteristics">
          {a.features.slice(0, 3).map((f) => (
            <li key={f}>
              <CheckIcon width={13} height={13} /> {PLAN_FEATURE_LABEL[f]}
            </li>
          ))}
        </ul>
        {concept.sense.findings.length > 0 && (
          <p className="concept-check" data-testid={`concept-check-${meta.label}`}>
            <WarningIcon width={14} height={14} />
            {concept.sense.findings.length === 1 ? "1 thing to check" : `${concept.sense.findings.length} things to check`}
          </p>
        )}
        <dl className="concept-stats">
          <Stat icon={<SofaIcon width={14} height={14} />} label="Living area" value={`${a.dayArea.toFixed(1)} m²`} />
          <Stat icon={<AreaIcon width={14} height={14} />} label="Total area" value={`${a.totalArea.toFixed(1)} m²`} />
          <Stat icon={<BedIcon width={14} height={14} />} label="Bedrooms" value={String(a.bedrooms)} />
          <Stat icon={<BathIcon width={14} height={14} />} label="Bathrooms" value={String(a.bathrooms)} />
        </dl>
        {confirming ? (
          <div className="concept-confirm" onClick={(e) => e.stopPropagation()}>
            <span>Delete this concept?</span>
            <button type="button" className="btn btn-sm btn-outline" onClick={() => setConfirming(false)}>
              Keep
            </button>
            <button type="button" className="btn btn-sm btn-danger" onClick={() => editor.deletePlan(meta.id)} data-testid={`concept-delete-confirm-${meta.label}`}>
              Delete
            </button>
          </div>
        ) : (
          <button
            type="button"
            className="btn btn-primary btn-block concept-open"
            onClick={(e) => {
              e.stopPropagation();
              open();
            }}
            data-testid={`open-concept-${meta.label}`}
          >
            Open this design <ArrowRightIcon width={16} height={16} />
          </button>
        )}
      </div>
    </article>
  );
}

function Stat({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <div className="concept-stat">
      <dt>
        {icon}
        {label}
      </dt>
      <dd>{value}</dd>
    </div>
  );
}
