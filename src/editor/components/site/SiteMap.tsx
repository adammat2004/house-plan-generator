"use client";

import maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { CheckIcon, RefreshIcon, SearchIcon, TrashIcon, WarningIcon } from "@/components/ui/icons";
import type { LonLat, Site, SiteEdge, TracedSite } from "@/domain/project/site";
import { siteAnchor, tracedSite } from "@/domain/site/fit";
import { toGrid } from "@/domain/site/geo";
import { ArrowRightIcon } from "@/components/ui/icons";
import type { SiteUiState } from "../../state/stores";
import { usePhoneLayout } from "../shell/phone";
import { goToStep } from "../shell/tools";
import { geocode, IMAGERY_SOURCE, mapKeyAvailable, satelliteStyleUrl, TILE_PROVIDER, type GeocodeResult } from "./mapProvider";
import { editor } from "../../state/editor";

/**
 * The satellite map: the full-bleed background for the Map step (EditorApp
 * mounts this in place of the plan while `workspace === "site"` and the
 * user is tracing), plus the guided tasks that trace a site onto it. It
 * only ever reads and writes `site.traced` (`domain/project/site.ts`); the
 * geometry itself — the buildable area, the room for a house — comes from
 * `domain/site`, the same code the planners use.
 */

const MAP_LOAD_TIMEOUT_MS = 10_000;
const IRELAND: [number, number] = [-8, 53.4];
export type Stage = SiteUiState["stage"];
const TRACING_STAGES: ReadonlySet<Stage> = new Set(["trace", "wastewater"]);

type MapPhase = "loading" | "ready" | "failed";

const reducedMotion = () => typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

/** The draft ring a task starts from: what's already saved, for Edit, or empty for a fresh trace. */
function initialDraft(stage: Stage, traced: TracedSite | undefined): LonLat[] {
  if (stage === "trace") return traced?.boundary ?? [];
  if (stage === "wastewater") return traced?.wastewater ?? [];
  return [];
}

export default function SiteMap({ site, stage, onStage }: { site: Site; stage: Stage; onStage: (s: Stage) => void }) {
  const container = useRef<HTMLDivElement>(null);
  const map = useRef<maplibregl.Map | null>(null);
  const [phase, setPhase] = useState<MapPhase>(mapKeyAvailable() ? "loading" : "failed");
  const [retrying, setRetrying] = useState(0);
  const [, forceRedraw] = useState(0);
  const stageRef = useRef(stage);
  useEffect(() => {
    stageRef.current = stage;
  }, [stage]);
  // Read inside the map's own event handlers, which are set up once and
  // must still see the latest site when the user places the entrance.
  const siteRef = useRef(site);
  useEffect(() => {
    siteRef.current = site;
  }, [site]);

  const traced = site.traced;
  const tracingRing = TRACING_STAGES.has(stage);
  const [draft, setDraft] = useState<LonLat[]>(() => initialDraft(stage, traced));
  const [crossing, setCrossing] = useState(false);
  const [live, setLive] = useState("");

  // Starting a task loads its draft from what's already saved, so Edit
  // resumes where it left off: a conditional setState during render, not in
  // an effect, is React's own pattern for resetting state when a prop changes.
  const [draftStage, setDraftStage] = useState(stage);
  if (stage !== draftStage) {
    setDraftStage(stage);
    setDraft(initialDraft(stage, traced));
    setCrossing(false);
  }

  const addPoint = useCallback((p: LonLat) => {
    setDraft((d) => {
      const next = [...d, p];
      if (next.length >= 4 && selfCrosses(next)) {
        setCrossing(true);
        setLive("The edges cross. Move a corner to fix it.");
        return d;
      }
      setCrossing(false);
      setLive(`Corner ${next.length} added${next.length >= 3 ? ` · area ${(shoelaceArea(next) / 10_000).toFixed(2)} ha` : ""}`);
      return next;
    });
  }, []);

  const placeEntrance = useCallback((p: LonLat) => {
    const current = siteRef.current;
    if (!current.traced) return;
    editor.setSite({ ...current, traced: { ...current.traced, entrance: p } });
    setLive("Entrance marked.");
  }, []);

  // Build the map once per retry. A WebGL context lost before the style
  // finishes loading can otherwise leave it blank forever (maplibre-gl#8690);
  // a flat timeout catches that along with any slower failure.
  useEffect(() => {
    const styleUrl = satelliteStyleUrl();
    if (!styleUrl || !container.current) {
      setPhase("failed");
      return;
    }
    setPhase("loading");
    const start = site.traced?.boundary[0];
    const m = new maplibregl.Map({ container: container.current, style: styleUrl, center: start ?? IRELAND, zoom: start ? 18 : 6 });
    map.current = m;
    let settled = false;
    const succeed = () => {
      if (settled) return;
      settled = true;
      setPhase("ready");
    };
    const fail = () => {
      if (settled) return;
      settled = true;
      setPhase("failed");
    };
    m.on("load", succeed);
    m.on("error", fail);
    m.on("webglcontextlost", fail);
    const timer = window.setTimeout(fail, MAP_LOAD_TIMEOUT_MS);
    const redraw = () => forceRedraw((n) => n + 1);
    m.on("move", redraw);
    m.on("resize", redraw);
    m.on("click", (e) => {
      const p: LonLat = [e.lngLat.lng, e.lngLat.lat];
      if (TRACING_STAGES.has(stageRef.current)) addPoint(p);
      else if (stageRef.current === "entrance") placeEntrance(p);
    });
    const keydown = (e: KeyboardEvent) => {
      if (stageRef.current === "entrance") {
        if (e.key === "Enter") {
          e.preventDefault();
          const c = m.getCenter();
          placeEntrance([c.lng, c.lat]);
        }
        return;
      }
      if (!TRACING_STAGES.has(stageRef.current)) return;
      if (e.key === "Enter") {
        e.preventDefault();
        const c = m.getCenter();
        addPoint([c.lng, c.lat]);
      } else if (e.key === "Backspace") {
        e.preventDefault();
        setDraft((d) => d.slice(0, -1));
        setCrossing(false);
      } else if (e.key === "Escape") {
        (document.activeElement as HTMLElement | null)?.blur?.();
      }
    };
    m.getContainer().addEventListener("keydown", keydown);
    return () => {
      window.clearTimeout(timer);
      m.getContainer().removeEventListener("keydown", keydown);
      m.remove();
      map.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- rebuilt only by the Retry button (via `retrying`) or on unmount; addPoint is stable.
  }, [retrying]);

  const project = useCallback((p: LonLat): { x: number; y: number } | null => {
    const m = map.current;
    if (!m) return null;
    const pt = m.project([p[0], p[1]]);
    return { x: pt.x, y: pt.y };
  }, []);

  const flyTo = useCallback((center: [number, number], zoom = 18) => {
    map.current?.flyTo({ center, zoom, duration: reducedMotion() ? 0 : 1000, essential: true });
  }, []);

  // MapWorkspace reads this to show the plot-form fallback in the same slot
  // this panel would otherwise occupy (design review R4/R20).
  useEffect(() => {
    editor.setSiteUi({ mapFailed: phase === "failed" });
  }, [phase]);

  if (phase === "failed") return <SiteMapFailed onRetry={() => setRetrying((n) => n + 1)} hasBoundary={!!traced && traced.boundary.length >= 3} />;
  return (
    <>
      <div ref={container} className="site-map" data-testid="site-map" aria-hidden />
      {phase === "loading" && (
        <div className="site-map-loading" data-testid="site-map-loading">
          Loading the map…
        </div>
      )}
      {phase === "ready" && (
        <>
          <SiteOverlaySvg site={site} draft={draft} stage={stage} project={project} />
          {(tracingRing || stage === "entrance") && <div className="site-map-crosshair" aria-hidden />}
        </>
      )}
      <SiteTaskPanel
        site={site}
        stage={stage}
        onStage={onStage}
        flyTo={flyTo}
        draft={draft}
        crossing={crossing}
        live={live}
        onUndo={() => {
          setDraft((d) => d.slice(0, -1));
          setCrossing(false);
        }}
        onClearDraft={() => {
          setDraft([]);
          setCrossing(false);
        }}
      />
    </>
  );
}

function SiteMapFailed({ onRetry, hasBoundary }: { onRetry: () => void; hasBoundary: boolean }) {
  const [retrying, setRetrying] = useState(false);
  return (
    <div className="site-map-failed" data-testid="site-map-failed">
      <WarningIcon width={22} height={22} />
      <p>The map couldn&apos;t load.</p>
      {hasBoundary && <p className="field-hint">Your boundary is safe.</p>}
      <button
        type="button"
        className="btn btn-secondary btn-sm"
        onClick={() => {
          setRetrying(true);
          onRetry();
          window.setTimeout(() => setRetrying(false), 600);
        }}
        data-testid="site-map-retry"
      >
        <RefreshIcon width={14} height={14} className={retrying ? "is-spinning" : undefined} /> Retry
      </button>
    </div>
  );
}

/**
 * The guided tasks, floating over the map exactly where the Map step's
 * ordinary side panel sits (design review 1A): one task open at a time,
 * each a heading with one primary button.
 */
function SiteTaskPanel({
  site,
  stage,
  onStage,
  flyTo,
  draft,
  crossing,
  live,
  onUndo,
  onClearDraft,
}: {
  site: Site;
  stage: Stage;
  onStage: (s: Stage) => void;
  flyTo: (center: [number, number], zoom?: number) => void;
  draft: LonLat[];
  crossing: boolean;
  live: string;
  onUndo: () => void;
  onClearDraft: () => void;
}) {
  const traced = site.traced;
  const boundaryDone = !!traced && traced.boundary.length >= 3;
  const phone = usePhoneLayout();

  return (
    <aside className="map-panel floating site-task-panel" data-chrome={phone ? "bottom" : "left"} aria-label="Trace your site" data-testid="site-task-panel">
      <div className="map-panel-scroll">
        {stage === "find" && <FindTask flyTo={flyTo} onFound={() => onStage("trace")} />}
        {stage === "trace" && (
          <TraceTask
            draft={draft}
            crossing={crossing}
            onUndo={onUndo}
            onClear={onClearDraft}
            onDone={() => {
              editor.setSite({ ...site, traced: { boundary: draft, exportGrid: "EPSG:2157", edges: [], imagery: IMAGERY_SOURCE } });
              onStage("road");
            }}
          />
        )}
        {stage === "road" && traced && <RoadTask traced={traced} site={site} onDone={() => onStage("entrance")} />}
        {stage === "entrance" && traced && <EntranceTask traced={traced} site={site} onDone={() => onStage("wastewater")} />}
        {stage === "wastewater" && traced && (
          <WastewaterTask
            draft={draft}
            crossing={crossing}
            onUndo={onUndo}
            onSkip={() => {
              editor.setSite({ ...site, traced: { ...traced, wastewater: undefined } });
              onStage("done");
            }}
            onDone={() => {
              editor.setSite({ ...site, traced: { ...traced, wastewater: draft } });
              onStage("done");
            }}
          />
        )}
        {stage === "done" && <DoneSummary traced={traced} onEdit={onStage} />}
        <p className="field-hint site-privacy" data-testid="site-privacy">
          {TILE_PROVIDER} sees the area you map, and your project file holds the site&apos;s boundary. Nothing is stored on our server yet.
        </p>
      </div>
      <div className="sr-only" role="status" aria-live="polite" data-testid="site-live-region">
        {live}
      </div>
      <footer className="map-footer">
        <button type="button" className={`btn btn-${boundaryDone ? "primary" : "secondary"} btn-lg btn-block`} onClick={() => goToStep("requirements")} data-testid="map-continue">
          Continue to requirements <ArrowRightIcon width={16} height={16} />
        </button>
      </footer>
    </aside>
  );
}

/** Once every task is done: a one-line summary of each, with Edit. */
function DoneSummary({ traced, onEdit }: { traced: TracedSite | undefined; onEdit: (s: Stage) => void }) {
  if (!traced) return null;
  const area = shoelaceArea(traced.boundary);
  const roadCount = traced.edges?.filter((e) => e.road).length ?? 0;
  return (
    <div className="site-task site-done-summary" data-testid="site-task-done">
      <h3 className="site-task-title">Your site</h3>
      <ul className="site-summary-list">
        <li>
          <span>Boundary · {(area / 10_000).toFixed(2)} ha</span>
          <button type="button" className="link-btn" onClick={() => onEdit("trace")} data-testid="site-edit-trace">
            Edit
          </button>
        </li>
        <li>
          <span>{roadCount ? `${roadCount} road edge${roadCount === 1 ? "" : "s"}` : "No road marked"}</span>
          <button type="button" className="link-btn" onClick={() => onEdit("road")} data-testid="site-edit-road">
            Edit
          </button>
        </li>
        <li>
          <span>{traced.entrance ? "Entrance marked" : "No entrance marked"}</span>
          <button type="button" className="link-btn" onClick={() => onEdit("entrance")} data-testid="site-edit-entrance">
            Edit
          </button>
        </li>
        <li>
          <span>{traced.wastewater ? "Wastewater area marked" : "No wastewater area"}</span>
          <button type="button" className="link-btn" onClick={() => onEdit("wastewater")} data-testid="site-edit-wastewater">
            Edit
          </button>
        </li>
      </ul>
    </div>
  );
}

/** Everything drawn over the map: traced points, the boundary, the buildable area, the room for a house. */
function SiteOverlaySvg({ site, draft, stage, project }: { site: Site; draft: LonLat[]; stage: Stage; project: (p: LonLat) => { x: number; y: number } | null }) {
  const traced = site.traced;
  const boundaryDone = !!traced && traced.boundary.length >= 3;
  const summary = useMemo(() => (boundaryDone ? tracedSite(site) : null), [boundaryDone, site]);
  const anchor = useMemo(() => (summary && traced ? siteAnchor(summary, traced.exportGrid) : null), [summary, traced]);
  const toScreen = (ring: LonLat[]) => ring.map(project).filter((p): p is { x: number; y: number } => !!p);
  const path = (pts: { x: number; y: number }[]) => (pts.length ? `M ${pts.map((p) => `${p.x},${p.y}`).join(" L ")} Z` : "");

  return (
    <svg className="site-overlay-svg" aria-hidden>
      {boundaryDone && <rect className="site-photo-wash" x={0} y={0} width="100%" height="100%" />}
      {anchor?.buildable.map((ring, i) => <path key={i} className="site-buildable-area" d={path(toScreen(ring))} />)}
      {boundaryDone && <path className="site-boundary-hedge" d={path(toScreen(traced.boundary))} />}
      {traced?.edges?.map((e, i) => (e.road ? <RoadEdgeLine key={i} traced={traced} i={i} project={project} /> : null))}
      {anchor?.house && <path className="site-house-anchor" d={path(toScreen(anchor.house))} />}
      {anchor?.house && anchor.houseSize && <HouseAnchorLabel points={toScreen(anchor.house)} size={anchor.houseSize} />}
      {traced?.entrance &&
        (() => {
          const p = project(traced.entrance);
          return p ? <circle className="site-entrance-mark" cx={p.x} cy={p.y} r={6} /> : null;
        })()}
      {traced?.wastewater && traced.wastewater.length >= 3 && <path className="site-wastewater-area" d={path(toScreen(traced.wastewater))} />}
      {(stage === "trace" || stage === "wastewater") &&
        draft.map((p, i) => {
          const s = project(p);
          return s ? <circle key={i} className="site-draft-corner" cx={s.x} cy={s.y} r={7} /> : null;
        })}
      {(stage === "trace" || stage === "wastewater") && draft.length > 1 && <path className="site-draft-line" d={path(toScreen(draft))} />}
    </svg>
  );
}

function HouseAnchorLabel({ points, size }: { points: { x: number; y: number }[]; size: { width: number; depth: number } }) {
  if (!points.length) return null;
  const cx = points.reduce((s, p) => s + p.x, 0) / points.length;
  const cy = points.reduce((s, p) => s + p.y, 0) / points.length;
  return (
    <text className="site-house-anchor-label" x={cx} y={cy}>
      Room for a house up to {size.width.toFixed(0)} × {size.depth.toFixed(0)} m
    </text>
  );
}

function RoadEdgeLine({ traced, i, project }: { traced: TracedSite; i: number; project: (p: LonLat) => { x: number; y: number } | null }) {
  const a = project(traced.boundary[i]);
  const b = project(traced.boundary[(i + 1) % traced.boundary.length]);
  if (!a || !b) return null;
  return <line className="site-road-edge" x1={a.x} y1={a.y} x2={b.x} y2={b.y} />;
}

/** Shoelace area of a ring given in longitude/latitude, in m², good enough for a size hint while tracing. */
function shoelaceArea(ring: LonLat[]): number {
  const pts = ring.map((p) => toGrid(p, "EPSG:2157"));
  let a = 0;
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i];
    const q = pts[(i + 1) % pts.length];
    a += p.x * q.y - q.x * p.y;
  }
  return Math.abs(a) / 2;
}

function segmentsCross(a1: LonLat, a2: LonLat, b1: LonLat, b2: LonLat): boolean {
  const o = (p: LonLat, q: LonLat, r: LonLat) => Math.sign((q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0]));
  const o1 = o(a1, a2, b1);
  const o2 = o(a1, a2, b2);
  const o3 = o(b1, b2, a1);
  const o4 = o(b1, b2, a2);
  return o1 !== o2 && o3 !== o4;
}

/** Whether the newest edge of a ring being traced crosses any earlier, non-adjacent edge. */
function selfCrosses(ring: LonLat[]): boolean {
  const n = ring.length;
  const newEdge: [LonLat, LonLat] = [ring[n - 2], ring[n - 1]];
  for (let i = 0; i < n - 3; i++) {
    if (segmentsCross(newEdge[0], newEdge[1], ring[i], ring[i + 1])) return true;
  }
  return false;
}

function FindTask({ flyTo, onFound }: { flyTo: (center: [number, number], zoom?: number) => void; onFound: () => void }) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<GeocodeResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const search = async () => {
    if (!query.trim()) return;
    setSearching(true);
    setMessage(null);
    const found = await geocode(query);
    setSearching(false);
    setResults(found);
    if (!found.length) setMessage("Couldn't find that. Try an Eircode, a townland, or drag the map.");
  };

  return (
    <div className="site-task" data-testid="site-task-find">
      <h3 className="site-task-title">Find your site</h3>
      <label className="site-task-field">
        <span>Eircode, address or townland</span>
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && search()}
          placeholder="e.g. H91 X3PN, or Moycullen, Co. Galway"
          data-testid="site-find-input"
        />
      </label>
      <div className="site-task-actions">
        <button type="button" className="btn btn-secondary btn-sm" onClick={search} disabled={searching} data-testid="site-find-search">
          <SearchIcon width={14} height={14} /> {searching ? "Searching…" : "Search"}
        </button>
        <button
          type="button"
          className="btn btn-secondary btn-sm"
          onClick={() => {
            navigator.geolocation?.getCurrentPosition(
              (pos) => {
                flyTo([pos.coords.longitude, pos.coords.latitude]);
                onFound();
              },
              () => setMessage("Couldn't find your location. Search instead, or drag the map."),
            );
          }}
          data-testid="site-find-use-location"
        >
          Use my location
        </button>
      </div>
      {message && <p className="field-hint is-error">{message}</p>}
      {results.length > 0 && (
        <ul className="site-find-results">
          {results.map((r, i) => (
            <li key={i}>
              <button
                type="button"
                onClick={() => {
                  flyTo(r.center);
                  onFound();
                }}
                data-testid={`site-find-result-${i}`}
              >
                {r.label}
              </button>
            </li>
          ))}
        </ul>
      )}
      <button type="button" className="link-btn" onClick={onFound} data-testid="site-find-skip">
        I can see it already — start tracing
      </button>
    </div>
  );
}

function TraceTask({ draft, crossing, onUndo, onClear, onDone }: { draft: LonLat[]; crossing: boolean; onUndo: () => void; onClear: () => void; onDone: () => void }) {
  const area = draft.length >= 3 ? shoelaceArea(draft) : 0;
  const tooSmall = draft.length >= 3 && area < 200;
  const tooLarge = draft.length >= 3 && area > 200_000;
  const canFinish = draft.length >= 3 && !crossing;
  return (
    <div className="site-task" data-testid="site-task-trace">
      <h3 className="site-task-title">Trace the boundary</h3>
      <p className="field-hint">Tap each corner of your site, in order round the edge. On a keyboard: Enter adds a corner at the crosshair, Backspace removes the last one.</p>
      {draft.length < 3 && <p className="field-hint">Add at least 3 corners.</p>}
      {draft.length >= 3 && <p className="map-fact">Area {(area / 10_000).toFixed(2)} ha</p>}
      {(tooSmall || tooLarge) && <p className="field-hint is-error">That&apos;s unusually {tooSmall ? "small" : "large"} for a house site. Check the corners.</p>}
      {crossing && <p className="field-hint is-error">The edges cross. Move a corner to fix it.</p>}
      {draft.length > 0 && (
        <ul className="site-corner-list">
          {draft.map((_, i) => (
            <li key={i}>Corner {i + 1}</li>
          ))}
        </ul>
      )}
      <div className="site-task-actions">
        <button type="button" className="btn btn-secondary btn-sm" onClick={onUndo} disabled={!draft.length} data-testid="site-trace-undo">
          Undo
        </button>
        <button type="button" className="btn btn-ghost btn-sm" onClick={onClear} disabled={!draft.length} data-testid="site-trace-clear">
          <TrashIcon width={14} height={14} /> Clear
        </button>
        <button type="button" className="btn btn-primary btn-sm" onClick={onDone} disabled={!canFinish} data-testid="site-trace-done">
          <CheckIcon width={14} height={14} /> Done
        </button>
      </div>
    </div>
  );
}

function RoadTask({ traced, site, onDone }: { traced: TracedSite; site: Site; onDone: () => void }) {
  const n = traced.boundary.length;
  const edges: SiteEdge[] = traced.edges && traced.edges.length === n ? traced.edges : Array.from({ length: n }, () => ({}));
  const toggle = (i: number) => {
    const next = edges.map((e, k) => (k === i ? { ...e, road: !e.road } : e));
    editor.setSite({ ...site, traced: { ...traced, edges: next } });
  };
  const hasRoad = edges.some((e) => e.road);
  return (
    <div className="site-task" data-testid="site-task-road">
      <h3 className="site-task-title">Mark the road</h3>
      <p className="field-hint">Tap each edge that meets the road, or choose it from the list.</p>
      <ul className="site-edge-list">
        {Array.from({ length: n }, (_, i) => {
          const a = toGrid(traced.boundary[i], traced.exportGrid);
          const b = toGrid(traced.boundary[(i + 1) % n], traced.exportGrid);
          const length = Math.round(Math.hypot(b.x - a.x, b.y - a.y));
          return (
            <li key={i}>
              <button type="button" className={edges[i]?.road ? "is-active" : undefined} aria-pressed={!!edges[i]?.road} onClick={() => toggle(i)} data-testid={`site-road-edge-${i}`}>
                Edge {i + 1}, {length} m
              </button>
            </li>
          );
        })}
      </ul>
      {!hasRoad && <p className="field-hint">No edge marked yet. Siting rules will read &ldquo;Mark the road to check this&rdquo; until you do.</p>}
      <div className="site-task-actions">
        <button type="button" className="btn btn-primary btn-sm" onClick={onDone} data-testid="site-road-done">
          <CheckIcon width={14} height={14} /> Done
        </button>
      </div>
    </div>
  );
}

function EntranceTask({ traced, site, onDone }: { traced: TracedSite; site: Site; onDone: () => void }) {
  return (
    <div className="site-task" data-testid="site-task-entrance">
      <h3 className="site-task-title">Place the entrance</h3>
      <p className="field-hint">Tap where the entrance gate or drive meets the road. On a keyboard: Enter places it at the crosshair.</p>
      {traced.entrance ? (
        <p className="map-fact">
          Entrance marked.{" "}
          <button
            type="button"
            className="link-btn"
            onClick={() => editor.setSite({ ...site, traced: { ...traced, entrance: undefined } })}
            data-testid="site-entrance-clear"
          >
            Clear
          </button>
        </p>
      ) : (
        <p className="field-hint">Not marked yet.</p>
      )}
      <div className="site-task-actions">
        <button type="button" className="btn btn-primary btn-sm" onClick={onDone} data-testid="site-entrance-done">
          <CheckIcon width={14} height={14} /> Done
        </button>
      </div>
    </div>
  );
}

function WastewaterTask({ draft, crossing, onUndo, onSkip, onDone }: { draft: LonLat[]; crossing: boolean; onUndo: () => void; onSkip: () => void; onDone: () => void }) {
  return (
    <div className="site-task" data-testid="site-task-wastewater">
      <h3 className="site-task-title">
        Wastewater area <span className="optional">(optional)</span>
      </h3>
      <p className="field-hint">If you know where the septic tank and percolation area will go, trace it. Layouts will keep the house clear of it.</p>
      {draft.length >= 3 && <p className="map-fact">Area traced.</p>}
      {crossing && <p className="field-hint is-error">The edges cross. Move a corner to fix it.</p>}
      <div className="site-task-actions">
        <button type="button" className="btn btn-secondary btn-sm" onClick={onUndo} disabled={!draft.length} data-testid="site-waste-undo">
          Undo
        </button>
        <button type="button" className="btn btn-ghost btn-sm" onClick={onSkip} data-testid="site-waste-skip">
          Skip for now
        </button>
        <button type="button" className="btn btn-primary btn-sm" onClick={onDone} disabled={draft.length < 3 || crossing} data-testid="site-waste-done">
          <CheckIcon width={14} height={14} /> Done
        </button>
      </div>
    </div>
  );
}
