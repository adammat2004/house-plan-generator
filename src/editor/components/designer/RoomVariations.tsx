"use client";

import { useLayoutEffect, useState, type ReactNode } from "react";
import { compareRoom, connectionSummary, roomBounds, roomFacts, type RoomChange } from "@/domain/design/analysis";
import { levelOf } from "@/domain/plan/levels";
import type { Rect } from "@/domain/geometry/vector";
import type { Level, PlanDocument } from "@/domain/plan/types";
import { IconButton, Menu, MenuItem } from "@/components/ui/controls";
import {
  ArrowLeftIcon,
  ArrowRightIcon,
  CheckIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  ChevronUpIcon,
  CloseIcon,
  DoorIcon,
  LeafIcon,
  MoreIcon,
  SparkleIcon,
  SunIcon,
  AreaIcon,
  SwapIcon,
  WindowIcon,
} from "@/components/ui/icons";
import { MATERIAL_SWATCH } from "../../rendering/konva/theme";
import { design, editor, useDocumentState, useSessionState } from "../../state/editor";
import type { Proposal, VariationsState } from "../../state/stores";
import { MATERIAL_LABEL } from "../inspector/RoomInspector";
import { BoardDock, usePanZoom } from "./board";
import { ConceptPreview } from "./ConceptPreview";
import { PlanThumbnail, type PlanPalette } from "./PlanThumbnail";

const CURRENT = "current";
const CONTEXT = 1.5;

/** What a card shows: the room as it is, or one variation of it. */
interface Entry {
  id: string;
  label: string;
  title: string;
  level: Level;
  /** The house the floor is in, for its stairs. */
  plan: PlanDocument;
  /** The room's id in this entry's plan (a merged room may have a new one). */
  roomId: string;
  /** Rooms to outline in the preview. */
  highlight: string[];
  proposal: Proposal | null;
}

const union = (rects: Array<Rect | null>): Rect | null => {
  const r = rects.filter((x): x is Rect => !!x);
  if (!r.length) return null;
  return { minX: Math.min(...r.map((x) => x.minX)), minY: Math.min(...r.map((x) => x.minY)), maxX: Math.max(...r.map((x) => x.maxX)), maxY: Math.max(...r.map((x) => x.maxY)) };
};

/** The floor the room is on, in the plan the variations were made from. */
const floorOf = (v: VariationsState) => levelOf(v.source, v.roomId) ?? v.source.levels[0];

function entriesOf(v: VariationsState): Entry[] {
  const level = floorOf(v);
  const room = level.rooms[v.roomId];
  return [
    { id: CURRENT, label: "Current design", title: room?.name ?? "Room", level, plan: v.source, roomId: v.roomId, highlight: [v.roomId], proposal: null },
    ...v.options.map((p, i) => ({
      id: p.id,
      label: `Variation ${i + 1}`,
      title: p.title,
      level: levelOf(p.document, p.roomIds[0] ?? v.roomId) ?? p.document.levels[0],
      plan: p.document,
      roomId: p.roomIds[0] ?? v.roomId,
      highlight: p.roomIds,
      proposal: p,
    })),
  ];
}

/** Every card frames the same stretch of plan: the room and whatever any option changes, with some context. */
function sharedFocus(v: VariationsState, entries: Entry[]): Rect | undefined {
  const rects = entries.flatMap((e) => e.highlight.map((id) => roomBounds(e.level, id)));
  return union([roomBounds(floorOf(v), v.roomId), ...rects]) ?? undefined;
}

const CHANGE_ICON: Record<RoomChange["kind"], ReactNode> = {
  area: <AreaIcon width={16} height={16} />,
  size: <AreaIcon width={16} height={16} />,
  garden: <LeafIcon width={16} height={16} />,
  windows: <SunIcon width={16} height={16} />,
  doors: <DoorIcon width={16} height={16} />,
  merged: <SwapIcon width={16} height={16} />,
  neighbour: <AreaIcon width={16} height={16} />,
};

/** Lines describing an entry: the changes a variation makes, or how the current room connects. */
function linesOf(v: VariationsState, e: Entry): string[] {
  if (!e.proposal) {
    const facts = roomFacts(e.level, e.roomId);
    return [...(facts ? [`${facts.width.toFixed(1)} × ${facts.depth.toFixed(1)} m`] : []), ...connectionSummary(e.level, e.roomId).map((c) => c.text)];
  }
  return compareRoom(floorOf(v), e.level, v.roomId, e.roomId).map((c) => c.text);
}

/**
 * Screen 7: one room beside alternative versions of it, on the canvas. Each
 * card frames just the changed part of the plan with some context; apply
 * one to the main plan, ask for more, or compare two side by side.
 */
export function RoomVariations() {
  const view = useSessionState((s) => (s.workspace === "design" ? s.designView : null));
  const v = useSessionState((s) => s.variations);
  if (view !== "variations" || !v) return null;
  return <Variations v={v} />;
}

function Variations({ v }: { v: VariationsState }) {
  const running = useSessionState((s) => s.designer.status === "running");
  const gridVisible = useSessionState((s) => s.settings.gridVisible);
  const current = useDocumentState((s) => s.history.present);
  const [detailOpen, setDetailOpen] = useState(true);
  const { view, viewport, content, handlers, viewportStyle, contentStyle, zoomBy, fit } = usePanZoom(detailOpen ? 360 : 0);
  const entries = entriesOf(v);
  const focus = sharedFocus(v, entries);
  const stale = v.source !== current;
  const room = floorOf(v).rooms[v.roomId];
  const focused = entries.find((e) => e.id === v.focusId) ?? entries[0];
  const byId = (id: string) => entries.find((e) => e.id === id);

  const key = entries.map((e) => e.id).join();
  useLayoutEffect(() => {
    fit();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  const select = (id: string) => {
    editor.setVariations({ focusId: id });
    setDetailOpen(true);
  };
  const back = () => editor.setDesignView("plan");
  const compare = v.compare ? [byId(v.compare[0]), byId(v.compare[1])] : null;

  return (
    <section className={`variations-board${gridVisible ? " has-grid" : ""}`} aria-label={`${room?.name ?? "Room"} variations`} data-testid="room-variations-board">
      <header className="board-header">
        <div>
          <button type="button" className="board-back" onClick={back} data-testid="variations-back">
            <ArrowLeftIcon width={15} height={15} /> Back to plan
          </button>
          <h1>{room?.name ?? "Room"} variations</h1>
          <p>Explore layout options for {room?.name.toLowerCase() ?? "this room"}. Compare them and apply your favourite; nothing changes until you do.</p>
        </div>
        <div className="board-actions">
          <button type="button" className="btn btn-secondary" disabled={running || stale} onClick={() => void design.moreVariations()} data-testid="more-variations">
            <SparkleIcon width={17} height={17} /> {running ? "Generating…" : "Generate more variations"}
          </button>
        </div>
      </header>

      {stale && (
        <div className="variations-stale" role="status">
          The plan has changed since these variations were made, so they can&rsquo;t be applied.
          <button type="button" className="link-btn" onClick={back}>
            Back to plan
          </button>
        </div>
      )}

      {compare?.[0] && compare[1] ? (
        <VariationCompare v={v} left={compare[0]} right={compare[1]} focus={focus} stale={stale} />
      ) : (
        <div ref={viewport} className="board-viewport" {...handlers} style={viewportStyle}>
          <div ref={content} className="board-content variations-content" style={contentStyle}>
            {entries.map((e) => (
              <VariationCard key={e.id} v={v} entry={e} entries={entries} focus={focus} selected={detailOpen && e.id === focused.id} stale={stale} onSelect={() => select(e.id)} />
            ))}
          </div>
        </div>
      )}

      {detailOpen && !compare && <VariationDetail v={v} entry={focused} focus={focus} stale={stale} onClose={() => setDetailOpen(false)} />}
      {!compare && <FullPlan v={v} onBack={back} />}
      {!compare && <BoardDock k={view.k} zoomBy={zoomBy} fit={fit} reserveRight={detailOpen ? 370 : 0} />}
    </section>
  );
}

function VariationCard({
  v,
  entry,
  entries,
  focus,
  selected,
  stale,
  onSelect,
}: {
  v: VariationsState;
  entry: Entry;
  entries: Entry[];
  focus: Rect | undefined;
  selected: boolean;
  stale: boolean;
  onSelect: () => void;
}) {
  const facts = roomFacts(entry.level, entry.roomId);
  const isCurrent = !entry.proposal;
  const lines = linesOf(v, entry).slice(0, 4);
  return (
    <article className={`variation-card board-card${selected ? " is-selected" : ""}${isCurrent ? " is-current" : ""}`} onClick={onSelect} data-testid={`variation-${entry.id === CURRENT ? "current" : entry.label}`}>
      <header className="variation-head">
        <div>
          <h3>{entry.label}</h3>
          {isCurrent ? null : <p>{entry.title}</p>}
        </div>
        {isCurrent ? (
          <span className="variation-badge">Main plan</span>
        ) : (
          <span onClick={(e) => e.stopPropagation()}>
            <Menu label={`More actions for ${entry.label}`} align="right" className="concept-menu" testId={`variation-menu-${entry.label}`} summary={<MoreIcon width={18} height={18} />}>
              {entries
                .filter((o) => o.id !== entry.id)
                .map((o) => (
                  <MenuItem key={o.id} onSelect={() => editor.setVariations({ compare: [entry.id, o.id] })} data-testid={`compare-${entry.label}-${o.id === CURRENT ? "current" : o.label}`}>
                    Compare with {o.id === CURRENT ? "current design" : o.label.toLowerCase()}
                  </MenuItem>
                ))}
              <hr />
              <MenuItem onSelect={() => void design.similarVariation(entry.id)}>Generate similar</MenuItem>
              <MenuItem onSelect={() => design.saveProposal(entry.id)} disabled={!!entry.proposal && design.statusOf(entry.proposal) === "saved"}>
                Save as concept
              </MenuItem>
            </Menu>
          </span>
        )}
      </header>
      {!isCurrent && facts && <span className="variation-area">{facts.area.toFixed(1)} m²</span>}
      <div className="variation-media">
        <ConceptPreview level={entry.level} plan={entry.plan} focus={focus} margin={CONTEXT} highlight={entry.highlight} />
      </div>
      {isCurrent && (
        <div className="variation-current-title">
          <strong>{entry.title}</strong>
          {facts && <span>{facts.area.toFixed(1)} m²</span>}
        </div>
      )}
      <ul className="variation-lines">
        {lines.map((line) => (
          <li key={line}>
            <span className="variation-tick" aria-hidden>
              <CheckIcon width={11} height={11} />
            </span>
            {line}
          </li>
        ))}
      </ul>
      {isCurrent ? (
        <button type="button" className="btn btn-primary btn-block" disabled>
          <CheckIcon width={15} height={15} /> Current design
        </button>
      ) : (entry.proposal && design.statusOf(entry.proposal) === "saved") ? (
        <button type="button" className="btn btn-secondary btn-block" disabled>
          <CheckIcon width={15} height={15} /> Saved as a concept
        </button>
      ) : (
        <button
          type="button"
          className="btn btn-secondary btn-block"
          disabled={stale}
          onClick={(e) => {
            e.stopPropagation();
            design.applyProposal(entry.id);
          }}
          data-testid={`apply-${entry.label}`}
        >
          Apply this design <ArrowRightIcon width={16} height={16} />
        </button>
      )}
    </article>
  );
}

const VIEWS: ReadonlyArray<{ label: string; palette: PlanPalette }> = [
  { label: "Plan", palette: "finish" },
  { label: "Room uses", palette: "type" },
  { label: "Day and night", palette: "zones" },
];

function VariationDetail({ v, entry, focus, stale, onClose }: { v: VariationsState; entry: Entry; focus: Rect | undefined; stale: boolean; onClose: () => void }) {
  const [viewIndex, setViewIndex] = useState(0);
  const facts = roomFacts(entry.level, entry.roomId);
  const room = entry.level.rooms[entry.roomId];
  const changes = entry.proposal ? compareRoom(floorOf(v), entry.level, v.roomId, entry.roomId) : [];
  const height = entry.level.defaultWallHeight;
  return (
    <aside className="concept-detail floating" aria-label="Variation details" data-testid="variation-detail">
      <header className="concept-detail-header">
        <div>
          <h2>{entry.label}</h2>
          <p className="detail-sub">{entry.proposal ? entry.title : "Your plan as it is"}</p>
        </div>
        <IconButton label="Close details" onClick={onClose}>
          <CloseIcon width={18} height={18} />
        </IconButton>
      </header>
      <div className="concept-detail-body">
        <div className="viewer">
          <ConceptPreview level={entry.level} plan={entry.plan} palette={VIEWS[viewIndex].palette} className="viewer-main" focus={focus} margin={CONTEXT} highlight={entry.highlight} />
          <span className="viewer-caption">{VIEWS[viewIndex].label}</span>
          <button type="button" className="viewer-arrow is-prev" aria-label="Previous view" onClick={() => setViewIndex((viewIndex + VIEWS.length - 1) % VIEWS.length)}>
            <ChevronLeftIcon width={18} height={18} />
          </button>
          <button type="button" className="viewer-arrow is-next" aria-label="Next view" onClick={() => setViewIndex((viewIndex + 1) % VIEWS.length)}>
            <ChevronRightIcon width={18} height={18} />
          </button>
        </div>
        <div className="viewer-thumbs" role="tablist" aria-label="Views">
          {VIEWS.map((view, i) => (
            <button key={view.label} type="button" role="tab" aria-selected={viewIndex === i} aria-label={view.label} className={viewIndex === i ? "is-active" : undefined} onClick={() => setViewIndex(i)}>
              <ConceptPreview level={entry.level} plan={entry.plan} palette={view.palette} labels={false} className="viewer-thumb" focus={focus} margin={CONTEXT} />
            </button>
          ))}
        </div>
        <h3 className="detail-heading">{entry.proposal ? "What changes" : "How it connects"}</h3>
        <ul className="feature-list">
          {entry.proposal
            ? changes.map((c) => (
                <li key={c.text}>
                  {CHANGE_ICON[c.kind]}
                  {c.text}
                </li>
              ))
            : connectionSummary(entry.level, entry.roomId).map((c) => (
                <li key={c.text}>
                  {c.kind === "window" ? <WindowIcon width={16} height={16} /> : c.kind === "garden" ? <LeafIcon width={16} height={16} /> : <DoorIcon width={16} height={16} />}
                  {c.text}
                </li>
              ))}
        </ul>
        <h3 className="detail-heading">Room details</h3>
        <dl className="area-list">
          <div>
            <dt>Area</dt>
            <dd data-testid="variation-area">{facts ? `${facts.area.toFixed(1)} m²` : "—"}</dd>
          </div>
          <div>
            <dt>Dimensions</dt>
            <dd>{facts ? `${facts.width.toFixed(1)} m × ${facts.depth.toFixed(1)} m` : "—"}</dd>
          </div>
          <div>
            <dt>Ceiling height</dt>
            <dd>{height.toFixed(1)} m</dd>
          </div>
        </dl>
        <h3 className="detail-heading">Materials</h3>
        <div className="material-row">
          <span className="swatch" style={{ background: room?.floorMaterial ? MATERIAL_SWATCH[room.floorMaterial] : undefined }} aria-hidden />
          <span>
            <small>Floor</small>
            {room?.floorMaterial ? MATERIAL_LABEL[room.floorMaterial] : "Not chosen yet"}
          </span>
        </div>
      </div>
      {entry.proposal && (
        <footer className="concept-detail-footer variation-actions">
          <button type="button" className="btn btn-primary btn-block btn-lg" disabled={stale || design.statusOf(entry.proposal) !== "open"} onClick={() => design.applyProposal(entry.id)} data-testid="apply-variation">
            Apply this variation <ArrowRightIcon width={16} height={16} />
          </button>
          <button
            type="button"
            className="btn btn-secondary btn-block"
            disabled={stale}
            onClick={() => {
              if ((entry.proposal && design.statusOf(entry.proposal) === "open")) design.saveProposal(entry.id);
              void design.similarVariation(entry.id);
            }}
            data-testid="save-similar"
          >
            Save and generate similar
          </button>
        </footer>
      )}
    </aside>
  );
}

/** Two versions side by side, with the numbers that differ. */
function VariationCompare({ v, left, right, focus, stale }: { v: VariationsState; left: Entry; right: Entry; focus: Rect | undefined; stale: boolean }) {
  const facts = [left, right].map((e) => roomFacts(e.level, e.roomId));
  const neighbours = Object.keys(floorOf(v).rooms).filter((id) => id !== v.roomId);
  const area = (e: Entry, id: string) => roomFacts(e.level, id)?.area ?? null;
  const rows: Array<[string, string, string]> = [
    ["Area", ...facts.map((f) => (f ? `${f.area.toFixed(1)} m²` : "—"))] as [string, string, string],
    ["Size", ...facts.map((f) => (f ? `${f.width.toFixed(1)} × ${f.depth.toFixed(1)} m` : "—"))] as [string, string, string],
    ["Doors", ...facts.map((f) => String(f?.doors ?? "—"))] as [string, string, string],
    ["Windows", ...facts.map((f) => (f ? `${f.windows} (${f.glazing.toFixed(1)} m)` : "—"))] as [string, string, string],
    ["Garden doors", ...facts.map((f) => (f?.gardenDoor ? `${f.gardenDoor.toFixed(1)} m` : "None"))] as [string, string, string],
    ...neighbours
      .map((id): [string, string, string] => [
        floorOf(v).rooms[id].name,
        area(left, id) === null ? "Merged" : `${area(left, id)!.toFixed(1)} m²`,
        area(right, id) === null ? "Merged" : `${area(right, id)!.toFixed(1)} m²`,
      ])
      .filter(([, a, b]) => a !== b),
  ];
  return (
    <div className="variation-compare" data-testid="variation-compare">
      <div className="compare-head">
        <h2>
          Comparing {left.label.toLowerCase()} and {right.label.toLowerCase()}
        </h2>
        <button type="button" className="btn btn-secondary btn-sm" onClick={() => editor.setVariations({ compare: null })} data-testid="end-compare">
          Back to all variations
        </button>
      </div>
      <div className="compare-grid">
        {[left, right].map((e) => (
          <div key={e.id} className="compare-side">
            <div className="compare-title">
              <strong>{e.label}</strong>
              <span>{e.proposal ? e.title : "As it is"}</span>
            </div>
            <div className="compare-media">
              <ConceptPreview level={e.level} plan={e.plan} focus={focus} margin={CONTEXT} highlight={e.highlight} />
            </div>
            {e.proposal ? (
              <button type="button" className="btn btn-primary btn-block" disabled={stale || design.statusOf(e.proposal) !== "open"} onClick={() => design.applyProposal(e.id)}>
                Apply {e.label.toLowerCase()} <ArrowRightIcon width={16} height={16} />
              </button>
            ) : (
              <button type="button" className="btn btn-secondary btn-block" disabled>
                <CheckIcon width={15} height={15} /> Current design
              </button>
            )}
          </div>
        ))}
        <table className="compare-table">
          <thead>
            <tr>
              <th scope="col" />
              <th scope="col">{left.label}</th>
              <th scope="col">{right.label}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(([label, a, b]) => (
              <tr key={label} className={a !== b ? "is-different" : undefined}>
                <th scope="row">{label}</th>
                <td>{a}</td>
                <td>{b}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/** The whole plan, with the room on show highlighted; the way back to it. */
function FullPlan({ v, onBack }: { v: VariationsState; onBack: () => void }) {
  const [open, setOpen] = useState(true);
  return (
    <section className={`floors-panel floating full-plan${open ? "" : " is-collapsed"}`} aria-label="Full plan">
      <header className="floors-header">
        <button type="button" className="floors-toggle" aria-expanded={open} onClick={() => setOpen(!open)}>
          Full plan <ChevronUpIcon width={16} height={16} style={{ transform: open ? undefined : "rotate(180deg)" }} />
        </button>
        <Menu label="Full plan actions" align="right" className="concept-menu" summary={<MoreIcon width={18} height={18} />}>
          <MenuItem onSelect={onBack}>Back to plan</MenuItem>
        </Menu>
      </header>
      {open && (
        <button type="button" className="full-plan-thumb" onClick={onBack} aria-label="Back to the full plan">
          <PlanThumbnail level={floorOf(v)} plan={v.source} palette="warm" highlight={[v.roomId]} pad={0.4} className="full-plan-svg" />
        </button>
      )}
    </section>
  );
}
