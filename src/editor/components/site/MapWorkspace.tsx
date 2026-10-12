"use client";

import { useEffect, useRef, useState } from "react";
import { facingLabel } from "@/domain/commands";
import { analyzeEnvelope, type EnvelopeSide } from "@/domain/geometry/envelope";
import { describeOutline } from "@/domain/geometry/outlineDescription";
import { ArrowRightIcon, WarningIcon } from "@/components/ui/icons";
import { buildableLimits, facing, houseOnPlot, NORTH_STEP, parseSiteLength, siteFromLimits, siteIssues, turnNorth, type Setbacks, type Site } from "@/domain/project/site";
import { editor, useDocumentState, useProjectState, useSessionState } from "../../state/editor";
import { toolController } from "../../tools/instance";
import { usePhoneLayout } from "../shell/phone";
import { goToStep } from "../shell/tools";

/**
 * Step 1, Map: the house on its site. For a house sized from its rooms, how
 * much room the plot leaves; for the user's own house, its size and which
 * side looks onto the garden (which also puts the street on the other side).
 * The plan beside the panel is for looking at.
 */
export function MapWorkspace() {
  const site = useSessionState((s) => s.workspace === "site");
  if (!site) return null;
  return <MapPanel />;
}

let revealPlotOnOpen = false;

/** "Allow a bigger plot" when nothing fits: Map, with the plot width ready to change. */
export function revealPlot() {
  revealPlotOnOpen = true;
  goToStep("map");
}

function MapPanel() {
  const auto = useProjectState((s) => s.sizing?.footprint === "auto");
  const panel = useRef<HTMLElement>(null);
  // On a phone the panel is a sheet along the bottom, so the plan fits above it.
  const phone = usePhoneLayout();

  useEffect(() => {
    if (!revealPlotOnOpen) return;
    revealPlotOnOpen = false;
    const field = panel.current?.querySelector<HTMLInputElement>("[data-testid=rooms-plot-width]");
    field?.focus();
    field?.select();
  }, []);

  return (
    <aside className="map-panel floating" aria-label="Your plot" data-chrome={phone ? "bottom" : "left"} data-testid="map-panel" ref={panel}>
      <div className="map-panel-scroll">
        <h2 className="map-title">Your plot</h2>
        <p className="map-lead">{auto ? "How big your plot is and what to leave free. Every layout is sized to fit what's left." : "Your house on its plot: how big the plot is, which side the garden is, and which way is north."}</p>
        <div className="map-section">
          {auto ? (
            <p className="map-fact" data-testid="brief-sizing">
              House size <strong>chosen from your rooms</strong>
            </p>
          ) : (
            <HouseFacts />
          )}
          <PlotFields auto={auto} />
          {!auto && <GardenSide />}
          <NorthField />
          {auto ? (
            <button type="button" className="link-btn" onClick={() => editor.setSizing({ footprint: "source" })} data-testid="use-fixed-shell">
              Use a fixed house size instead
            </button>
          ) : (
            <button type="button" className="link-btn" onClick={() => editor.setSizing({ footprint: "auto" })} data-testid="use-auto-size">
              Size the house from the rooms instead
            </button>
          )}
        </div>
      </div>
      <footer className="map-footer">
        <button type="button" className="btn btn-primary btn-lg btn-block" onClick={() => goToStep("requirements")} data-testid="map-continue">
          Continue to requirements <ArrowRightIcon width={16} height={16} />
        </button>
      </footer>
    </aside>
  );
}

const PLOT = { min: 5, max: 200 } as const;
const GAP = { min: 0, max: 60 } as const;
const GAPS: ReadonlyArray<{ key: keyof Setbacks; label: string }> = [
  { key: "front", label: "Front garden" },
  { key: "side", label: "Each side" },
  { key: "rear", label: "Back garden" },
];

const text = (v: number | undefined) => (v === undefined ? "" : String(v));

/** The site as it is, or the one the old house limits stand for until the plot is first changed. */
function useSite(): Site {
  const site = useProjectState((s) => s.site);
  const limits = useProjectState((s) => s.sizing?.plot);
  return site ?? siteFromLimits(limits);
}

/** The plot's size and the gaps to leave, and what that leaves for the house. */
function PlotFields({ auto }: { auto: boolean }) {
  const site = useSite();
  const level = useDocumentState((s) => s.history.present.levels[0]);
  const [plot, setPlot] = useState({ width: text(site.plot?.width), depth: text(site.plot?.depth) });
  const [gaps, setGaps] = useState({ front: text(site.setbacks.front), side: text(site.setbacks.side), rear: text(site.setbacks.rear) });
  const width = parseSiteLength(plot.width, PLOT.min, PLOT.max);
  const depth = parseSiteLength(plot.depth, PLOT.min, PLOT.max);
  const gapValues = GAPS.map(({ key }) => parseSiteLength(gaps[key], GAP.min, GAP.max));
  const plotError = width === "invalid" || depth === "invalid" ? `Plot sizes must be between ${PLOT.min} and ${PLOT.max} m.` : null;
  const gapError = gapValues.some((v) => v === "invalid" || v === undefined) ? `Gaps must be between ${GAP.min} and ${GAP.max} m.` : null;

  const save = (nextPlot: typeof plot, nextGaps: typeof gaps) => {
    const w = parseSiteLength(nextPlot.width, PLOT.min, PLOT.max);
    const d = parseSiteLength(nextPlot.depth, PLOT.min, PLOT.max);
    const g = GAPS.map(({ key }) => parseSiteLength(nextGaps[key], GAP.min, GAP.max));
    if (w === "invalid" || d === "invalid" || g.some((v) => v === "invalid" || v === undefined)) return;
    const [front, side, rear] = g as number[];
    editor.setSite({ ...site, setbacks: { front, side, rear }, plot: w || d ? { ...(w ? { width: w } : {}), ...(d ? { depth: d } : {}) } : undefined });
    // Keep the whole plot in view as it changes.
    requestAnimationFrame(() => toolController.fitPlan(true));
  };

  const env = analyzeEnvelope(level);
  const rear: EnvelopeSide = (env.ok && level.rearWallId && env.info.sideOfWall[level.rearWallId]) || "north";
  const house = !auto && env.ok ? houseOnPlot(env.info.outsideRect, rear) : null;
  const limits = buildableLimits(site);
  const issues = siteIssues(site, house);
  const room = limits && (limits.maxWidth ?? limits.maxDepth) !== undefined ? [limits.maxWidth !== undefined ? `${limits.maxWidth} m wide` : null, limits.maxDepth !== undefined ? `${limits.maxDepth} m deep` : null].filter(Boolean).join(" × ") : null;

  return (
    <>
      <fieldset className="plot-fields" data-testid="rooms-plot">
        <legend>
          The plot <span className="optional">(optional)</span>
        </legend>
        {(["width", "depth"] as const).map((key) => (
          <label key={key} className="plot-field">
            <span>{key === "width" ? "Width" : "Depth"}</span>
            <span className="input-with-unit">
              <input
                inputMode="decimal"
                placeholder="Any"
                value={plot[key]}
                onChange={(e) => {
                  const next = { ...plot, [key]: e.target.value };
                  setPlot(next);
                  save(next, gaps);
                }}
                data-testid={`rooms-plot-${key}`}
              />
              <span className="unit">m</span>
            </span>
          </label>
        ))}
        <small className={plotError ? "field-hint is-error" : "field-hint"}>{plotError ?? "Width along the street, depth from the street to the back. Leave blank if you don't know."}</small>
      </fieldset>
      <fieldset className="plot-fields gap-fields" data-testid="site-gaps">
        <legend>Leave free</legend>
        {GAPS.map(({ key, label }) => (
          <label key={key} className="plot-field">
            <span>{label}</span>
            <span className="input-with-unit">
              <input
                inputMode="decimal"
                value={gaps[key]}
                onChange={(e) => {
                  const next = { ...gaps, [key]: e.target.value };
                  setGaps(next);
                  save(plot, next);
                }}
                data-testid={`site-${key}`}
              />
              <span className="unit">m</span>
            </span>
          </label>
        ))}
        {gapError && <small className="field-hint is-error">{gapError}</small>}
      </fieldset>
      {issues.length > 0 ? (
        <ul className="site-issues" data-testid="site-issues">
          {issues.map((issue) => (
            <li key={issue}>
              <WarningIcon width={16} height={16} /> {issue}
            </li>
          ))}
        </ul>
      ) : (
        room && (
          <p className="map-fact" data-testid="site-buildable">
            Room for the house <strong>{room}</strong>
          </p>
        )
      )}
    </>
  );
}

/** Which way is north: a dial turned in 15° steps, by dragging or with the arrow keys. */
function NorthField() {
  const site = useSite();
  const level = useDocumentState((s) => s.history.present.levels[0]);
  const env = analyzeEnvelope(level);
  const rear: EnvelopeSide = (env.ok && level.rearWallId && env.info.sideOfWall[level.rearWallId]) || "north";
  const north = site.north;
  const set = (value: number | undefined) => editor.setSite({ ...site, north: value });
  const dial = useRef<SVGSVGElement>(null);
  const fromPointer = (e: { clientX: number; clientY: number }) => {
    const r = dial.current?.getBoundingClientRect();
    if (!r) return;
    const angle = (Math.atan2(e.clientX - (r.left + r.width / 2), -(e.clientY - (r.top + r.height / 2))) * 180) / Math.PI;
    set(turnNorth(0, Math.round(angle / NORTH_STEP)));
  };
  const shown = north ?? 0;
  const rad = (shown * Math.PI) / 180;
  return (
    <fieldset className="north-field">
      <legend>Which way is north?</legend>
      <div className="north-row">
        <svg
          ref={dial}
          className={`north-dial${north === undefined ? " is-unset" : ""}`}
          viewBox="-46 -46 92 92"
          role="slider"
          tabIndex={0}
          aria-label="North"
          aria-valuemin={0}
          aria-valuemax={345}
          aria-valuenow={shown}
          aria-valuetext={north === undefined ? "Not set" : `${north}° clockwise from up the plan`}
          onPointerDown={(e) => {
            e.currentTarget.setPointerCapture(e.pointerId);
            fromPointer(e);
          }}
          onPointerMove={(e) => e.buttons && fromPointer(e)}
          onKeyDown={(e) => {
            const step = e.key === "ArrowRight" || e.key === "ArrowUp" ? 1 : e.key === "ArrowLeft" || e.key === "ArrowDown" ? -1 : 0;
            if (!step) return;
            e.preventDefault();
            set(turnNorth(north, step));
          }}
          data-testid="site-north"
        >
          <circle r={34} className="north-face" />
          {Array.from({ length: 24 }, (_, i) => {
            const a = (i * 15 * Math.PI) / 180;
            const long = i % 6 === 0;
            return <line key={i} x1={Math.sin(a) * (long ? 26 : 29)} y1={-Math.cos(a) * (long ? 26 : 29)} x2={Math.sin(a) * 32} y2={-Math.cos(a) * 32} className="north-tick" />;
          })}
          <g transform={`rotate(${shown})`} className="north-needle">
            <path d="M0 -24 L6 2 L0 -2 L-6 2 Z" />
            <path d="M0 24 L6 2 L0 -2 L-6 2 Z" className="north-tail" />
          </g>
          <text x={Math.sin(rad) * 41} y={-Math.cos(rad) * 41 + 4} className="north-letter">
            N
          </text>
        </svg>
        <div className="north-words">
          {north === undefined ? (
            <span className="field-hint">Not set. Turn the dial so the arrow points north; the plan stays as it is.</span>
          ) : (
            <>
              <span data-testid="site-garden-faces">
                The garden faces <strong>{facing(rear, north)}</strong>
              </span>
              <button type="button" className="link-btn" onClick={() => set(undefined)} data-testid="site-north-clear">
                Clear
              </button>
            </>
          )}
        </div>
      </div>
    </fieldset>
  );
}

const SIDES: ReadonlyArray<{ side: EnvelopeSide; label: string }> = [
  { side: "north", label: "North" },
  { side: "west", label: "West" },
  { side: "east", label: "East" },
  { side: "south", label: "South" },
];

/** The user's own house: its outside size and which side the garden is. */
function HouseFacts() {
  const level = useDocumentState((s) => s.history.present.levels[0]);
  const env = analyzeEnvelope(level);
  if (!env.ok) return null;
  return (
    <div className="map-facts" data-testid="brief-shell">
      <span>
        House{" "}
        <strong>
          {env.info.isRectangle ? "" : `${describeOutline(env.info).words}, `}
          {env.info.width.toFixed(1)} × {env.info.depth.toFixed(1)} m
        </strong>
      </span>
      <span>
        Garden side <strong>{(level.rearWallId && facingLabel(level, level.rearWallId)) || "not set"}</strong>
      </span>
    </div>
  );
}

/** Which side of the user's own house looks onto the garden (the street is opposite). */
function GardenSide() {
  const level = useDocumentState((s) => s.history.present.levels[0]);
  const env = analyzeEnvelope(level);
  if (!env.ok) return null;
  const garden = (level.rearWallId && env.info.sideOfWall[level.rearWallId]) || null;
  // The longest stretch of outside wall on each side stands for that side.
  const wallOn = (side: EnvelopeSide) => env.info.edges.filter((e) => e.facing === side).sort((a, b) => b.axis.length - a.axis.length)[0]?.wallId ?? null;
  return (
    <fieldset className="garden-side">
      <legend>Which side faces the garden?</legend>
      <div className="garden-side-picker" role="radiogroup" aria-label="Garden side">
        {SIDES.map(({ side, label }) => {
          const wallId = wallOn(side);
          return (
            <button
              key={side}
              type="button"
              role="radio"
              aria-checked={garden === side}
              className={`garden-side-${side}${garden === side ? " is-active" : ""}`}
              disabled={!wallId}
              onClick={() => wallId && editor.dispatch({ type: "setRearWall", wallId })}
              data-testid={`map-garden-${side}`}
            >
              {label}
            </button>
          );
        })}
        <span className="garden-side-house" aria-hidden>
          House
        </span>
      </div>
      <small className="field-hint">The street is on the other side. New layouts put the living rooms towards the garden.</small>
    </fieldset>
  );
}
