"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { comparePlans, type PlanMetric } from "@/domain/design/compare";
import { ArrowLeftIcon, ArrowRightIcon, CheckIcon, FitIcon } from "@/components/ui/icons";
import { useAreaText } from "@/components/units";
import { editor, useProjectState, useSessionState } from "../../state/editor";
import { openConcept } from "../shell/tools";
import { conceptName, useConcepts, type Concept } from "./concepts";
import { HousePreview } from "./ConceptPreview";

/**
 * Two of the project's plans side by side at one scale, zoomed and moved
 * together, with the numbers that tell them apart and the rooms that
 * differ. Either side can be swapped for another plan, and either taken on
 * to work on. Nothing changes until one is.
 */
export function PlanCompare() {
  const pair = useSessionState((s) => (s.workspace === "design" && s.designView === "compare" ? s.comparePlans : null));
  if (!pair) return null;
  return <Compare pair={pair} />;
}

const MAX_ZOOM = 6;
/** Garden round each house, m. */
const MARGIN = 1.2;
/** When more of the rooms than this differ, the plans are different layouts and nothing is singled out. */
const MOSTLY_DIFFERENT = 0.6;

interface View {
  x: number;
  y: number;
  k: number;
}

/**
 * One view for both drawings: Ctrl or ⌘ + scroll (or a pinch) zooms about
 * the pointer, scrolling or dragging moves round once zoomed in. Both
 * drawings are the same size, so one transform keeps them in step.
 */
function useLinkedView() {
  const [view, setView] = useState<View>({ x: 0, y: 0, k: 1 });
  const zoomed = useRef(false);
  useEffect(() => {
    zoomed.current = view.k > 1;
  }, [view.k]);
  const drag = useRef<{ id: number; x: number; y: number } | null>(null);
  const clamp = (v: View, el: HTMLElement): View => {
    const { width, height } = el.getBoundingClientRect();
    return { k: v.k, x: Math.min(0, Math.max(width - width * v.k, v.x)), y: Math.min(0, Math.max(height - height * v.k, v.y)) };
  };
  const zoomAt = useCallback((el: HTMLElement, factor: number, px: number, py: number) => {
    setView((v) => {
      const k = Math.min(MAX_ZOOM, Math.max(1, v.k * factor));
      return clamp({ k, x: px - (px - v.x) * (k / v.k), y: py - (py - v.y) * (k / v.k) }, el);
    });
  }, []);
  const bind = useCallback(
    (el: HTMLDivElement | null) => {
      if (!el) return;
      const onWheel = (e: WheelEvent) => {
        const r = el.getBoundingClientRect();
        if (e.ctrlKey || e.metaKey) {
          e.preventDefault();
          // As on the plan: a pinch's small steps count for more than a mouse wheel's notches.
          zoomAt(el, Math.exp(-e.deltaY * (Math.abs(e.deltaY) < 30 ? 0.012 : 0.0025)), e.clientX - r.left, e.clientY - r.top);
          return;
        }
        // Not zoomed in, a scroll scrolls the page.
        if (!zoomed.current) return;
        e.preventDefault();
        setView((v) => clamp({ ...v, x: v.x - e.deltaX, y: v.y - e.deltaY }, el));
      };
      el.addEventListener("wheel", onWheel, { passive: false });
      return () => el.removeEventListener("wheel", onWheel);
    },
    [zoomAt],
  );
  const handlers = {
    onPointerDown: (e: ReactPointerEvent<HTMLDivElement>) => {
      drag.current = { id: e.pointerId, x: e.clientX, y: e.clientY };
      e.currentTarget.setPointerCapture(e.pointerId);
    },
    onPointerMove: (e: ReactPointerEvent<HTMLDivElement>) => {
      const d = drag.current;
      if (!d || d.id !== e.pointerId) return;
      const [dx, dy] = [e.clientX - d.x, e.clientY - d.y];
      drag.current = { ...d, x: e.clientX, y: e.clientY };
      const el = e.currentTarget;
      setView((v) => clamp({ ...v, x: v.x + dx, y: v.y + dy }, el));
    },
    onPointerUp: () => {
      drag.current = null;
    },
  };
  return { view, bind, handlers, reset: () => setView({ x: 0, y: 0, k: 1 }) };
}

function Compare({ pair }: { pair: [string, string] }) {
  const { concepts } = useConcepts();
  const brief = useProjectState((s) => s.brief);
  const activePlanId = useProjectState((s) => s.activePlanId);
  const areaText = useAreaText();
  const linked = useLinkedView();
  const sides = pair.map((id) => concepts.find((c) => c.meta.id === id));
  const [left, right] = sides;
  const comparison = useMemo(() => (left && right ? comparePlans(left.plan, right.plan, brief) : null), [left, right, brief]);
  // One scale for both: a box that holds the bigger of the two, the shape of the drawings so the garden fills them.
  const [aspect, setAspect] = useState(0.9);
  const measure = useCallback((el: HTMLDivElement | null) => {
    if (!el) return;
    const observer = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect;
      if (width > 0 && height > 0) setAspect(width / height);
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  const frame = useMemo(() => {
    const sizes = [left, right].map((c) => (c ? c.assessment.outside : null));
    const [W, H] = [Math.max(...sizes.map((s) => s?.width ?? 0)) + 2 * MARGIN, Math.max(...sizes.map((s) => s?.depth ?? 0)) + 2 * MARGIN];
    const [w, h] = W / H < aspect ? [H * aspect, H] : [W, W / aspect];
    return { w: w - 2 * MARGIN, h: h - 2 * MARGIN };
  }, [left, right, aspect]);

  const back = () => editor.setDesignView("plan");
  if (!left || !right || !comparison) {
    return (
      <section className="plan-compare" aria-label="Compare plans" data-testid="plan-compare">
        <p className="field-hint">One of these plans has been taken out.</p>
        <button type="button" className="btn btn-secondary btn-sm" onClick={back} data-testid="compare-back">
          Back to the plan
        </button>
      </section>
    );
  }

  const roomCount = comparison.pairs.length;
  const differing = comparison.pairs.filter((p) => p.changed);
  const sameLayout = differing.length <= roomCount * MOSTLY_DIFFERENT;
  const pick = (side: 0 | 1, id: string) => editor.comparePlansSideBySide(...((side === 0 ? [id, pair[1]] : [pair[0], id]) as [string, string]));

  const value = (m: PlanMetric, side: "a" | "b") => {
    const v = m[side];
    switch (m.unit) {
      case "m2":
        return areaText(v, 1);
      case "share":
        return `${Math.round(v * 100)}%`;
      case "score":
        return m.better === side ? "Closer" : m.better ? "Further" : "About the same";
      default:
        return String(v);
    }
  };
  const size = (s: { width: number; depth: number } | null) => (s ? `${s.width.toFixed(1)} × ${s.depth.toFixed(1)} m` : "—");

  return (
    <section className="plan-compare" aria-label="Compare plans" data-testid="plan-compare">
      <header className="plan-compare-head">
        <button type="button" className="board-back" onClick={back} data-testid="compare-back">
          <ArrowLeftIcon width={16} height={16} /> Back to the plan
        </button>
        <h2>Compare plans</h2>
        <p className="plan-compare-lead">
          {sameLayout
            ? differing.length
              ? `${differing.length} of ${roomCount} rooms differ; they're outlined.`
              : "These plans have the same rooms."
            : "Two different layouts, drawn at the same scale."}{" "}
          Pinch or Ctrl + scroll to zoom in on both at once.
        </p>
      </header>
      <div className="plan-compare-grid">
        {([left, right] as Concept[]).map((c, i) => {
          const side = i === 0 ? "left" : "right";
          const changed = i === 0 ? comparison.changed.a : comparison.changed.b;
          const facts = [areaText(c.assessment.totalArea, 0), `${c.assessment.bedrooms} bed`, `${c.assessment.bathrooms} bath`].join(" · ");
          return (
            <div key={side} className="plan-compare-side">
              <div className="plan-compare-pick">
                <select aria-label={`${i === 0 ? "Left" : "Right"} plan`} value={c.meta.id} onChange={(e) => pick(i as 0 | 1, e.currentTarget.value)} data-testid={`compare-pick-${side}`}>
                  {concepts.map((o) => (
                    <option key={o.meta.id} value={o.meta.id}>
                      {conceptName(o)}
                    </option>
                  ))}
                </select>
                <span className="plan-compare-facts">{facts}</span>
              </div>
              <div className="plan-compare-media" ref={linked.bind} {...linked.handlers} data-testid={`compare-media-${side}`}>
                <div className="plan-compare-stage" ref={i === 0 ? measure : undefined} style={{ transform: `translate(${linked.view.x}px, ${linked.view.y}px) scale(${linked.view.k})` }}>
                  <HousePreview plan={c.plan} frame={frame} margin={MARGIN} highlight={sameLayout ? changed : undefined} className="plan-compare-drawing" />
                </div>
                {linked.view.k > 1 && i === 1 && (
                  <button type="button" className="btn btn-secondary btn-sm plan-compare-fit" onClick={linked.reset} data-testid="compare-fit">
                    <FitIcon width={15} height={15} /> Fit
                  </button>
                )}
              </div>
              {c.meta.id === activePlanId ? (
                <button type="button" className="btn btn-secondary btn-block" onClick={back} data-testid={`compare-use-${side}`}>
                  <CheckIcon width={15} height={15} /> Keep working on this one
                </button>
              ) : (
                <button type="button" className="btn btn-primary btn-block" onClick={() => openConcept(c.meta.id)} data-testid={`compare-use-${side}`}>
                  Work on this plan <ArrowRightIcon width={16} height={16} />
                </button>
              )}
            </div>
          );
        })}
        <div className="plan-compare-numbers">
          <table className="compare-table" data-testid="compare-metrics">
            <thead>
              <tr>
                <th scope="col" />
                <th scope="col">{left.letter || "Left"}</th>
                <th scope="col">{right.letter || "Right"}</th>
              </tr>
            </thead>
            <tbody>
              <tr className={size(comparison.size.a) !== size(comparison.size.b) ? "is-different" : undefined}>
                <th scope="row">Size</th>
                <td>{size(comparison.size.a)}</td>
                <td>{size(comparison.size.b)}</td>
              </tr>
              {comparison.metrics.map((m) => (
                <tr key={m.key} className={value(m, "a") !== value(m, "b") ? "is-different" : undefined} data-testid={`compare-metric-${m.key}`}>
                  <th scope="row">{m.label}</th>
                  {(["a", "b"] as const).map((s) => (
                    <td key={s} className={m.better === s ? "is-better" : undefined}>
                      {value(m, s)}
                      {m.better === s && <CheckIcon width={13} height={13} aria-label="Better" />}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
          {sameLayout && differing.length > 0 && (
            <>
              <h3 className="detail-heading">Rooms that differ</h3>
              <table className="compare-table" data-testid="compare-rooms">
                <tbody>
                  {differing.map((p, i) => (
                    <tr key={i}>
                      <th scope="row">{(p.a ?? p.b)!.name}</th>
                      <td>{p.a ? areaText(p.a.area, 1) : "None"}</td>
                      <td>{p.b ? areaText(p.b.area, 1) : "None"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          )}
        </div>
      </div>
    </section>
  );
}
