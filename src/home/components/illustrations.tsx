"use client";

import { useId, useMemo, type ReactNode } from "react";
import { PROJECT_TEMPLATES, buildTemplatePlan, type ProjectTemplate, type TemplateStyle } from "@/domain/project/templates";
import { slabPartition } from "@/domain/geometry/outline";
import type { Rect } from "@/domain/geometry/vector";
import type { PlanDocument, Point2 } from "@/domain/plan/types";
import { PlanDrawing } from "@/editor/components/designer/PlanThumbnail";
import { buildPlanScene } from "@/editor/rendering/scene/planScene";

/**
 * Drawn artwork for the home screen. The hero's floor plan and the template
 * plans are real planner output; the houses are simple vector drawings.
 */

const previews = new Map<string, PlanDocument | null>();

/** The template's plan, laid out once and cached (the planner is deterministic). */
export function templatePreview(template: ProjectTemplate): PlanDocument | null {
  if (!previews.has(template.id)) previews.set(template.id, buildTemplatePlan(template, `preview-${template.id}`));
  return previews.get(template.id) ?? null;
}

// ── Hero: a plan on the ground in isometric view, and the house it becomes ──

const S = 11; // px per metre
const COS = Math.cos(Math.PI / 6);
type P3 = [number, number, number];
const iso = ([x, y, z]: P3): [number, number] => [(x + y) * COS * S, (x - y) * 0.5 * S - z * S];
const pts = (...ps: P3[]) => ps.map((p) => iso(p).map((v) => v.toFixed(1)).join(",")).join(" ");

/** Front-facing quad on the south (y = const) or east (x = const) face of a box. */
const faceRect = (face: "south" | "east", fixed: number, a0: number, a1: number, z0: number, z1: number) =>
  face === "south" ? pts([a0, fixed, z0], [a1, fixed, z0], [a1, fixed, z1], [a0, fixed, z1]) : pts([fixed, a0, z0], [fixed, a1, z0], [fixed, a1, z1], [fixed, a0, z1]);

function Tree({ at, r = 1.6, tone = 0 }: { at: [number, number]; r?: number; tone?: number }) {
  const [x, y] = iso([at[0], at[1], 0]);
  const h = r * 2.2 * S;
  const shades = [
    ["#a9b597", "#c3ccb2"],
    ["#9aa98a", "#b7c2a5"],
  ][tone % 2];
  return (
    <g>
      <ellipse cx={x} cy={y} rx={r * S * 0.9} ry={r * S * 0.35} fill="#3d4a33" opacity={0.08} />
      <path d={`M${x} ${y}V${y - h * 0.55}`} stroke="#8a7f6c" strokeWidth={1.4} />
      <circle cx={x} cy={y - h * 0.7} r={r * S * 0.85} fill={shades[0]} />
      <circle cx={x - r * S * 0.35} cy={y - h * 0.82} r={r * S * 0.6} fill={shades[1]} />
      <circle cx={x + r * S * 0.3} cy={y - h * 0.95} r={r * S * 0.5} fill={shades[1]} opacity={0.9} />
    </g>
  );
}

/**
 * A house with a hipped roof standing on the ground plane at (x0, y0), with
 * glazing and eaves scaled to its size. Only the south and east walls face
 * the viewer, so only those are drawn.
 */
function HouseMass({ x0, y0, W, D, H, ids }: { x0: number; y0: number; W: number; D: number; H: number; ids: IsoIds }) {
  const [x1, y1, o] = [x0 + W, y0 + D, 0.5];
  const half = Math.min(W, D) / 2;
  const rise = half * 0.5;
  const top = H + rise;
  const a: P3 = [x0 - o, y0 - o, H];
  const b: P3 = [x1 + o, y0 - o, H];
  const c: P3 = [x1 + o, y1 + o, H];
  const d: P3 = [x0 - o, y1 + o, H];
  // The ridge runs along the longer side; equal sides give a pyramid.
  const alongX = W >= D;
  const r1: P3 = [x0 + half, y0 + half, top];
  const r2: P3 = alongX ? [x1 - half, y0 + half, top] : [x0 + half, y1 - half, top];
  // Back faces first, then the faces nearest the viewer.
  const faces = alongX
    ? [
        { p: [d, a, r1], f: "#55585a" },
        { p: [c, d, r1, r2], f: "#4a4d4f" },
        { p: [a, b, r2, r1], f: "#5f6264" },
        { p: [b, c, r2], f: "#45484a" },
      ]
    : [
        { p: [c, d, r2], f: "#4a4d4f" },
        { p: [d, a, r1, r2], f: "#55585a" },
        { p: [a, b, r1], f: "#5f6264" },
        { p: [b, c, r2, r1], f: "#45484a" },
      ];
  const glazeTop = Math.max(H - 0.45, 1.2);
  const winTop = Math.max(H - 0.7, 1.2);
  const panels = Math.max(2, Math.round((W * 0.6) / 2));
  const [g0, g1] = [x0 + W * 0.09, x0 + W * 0.69];
  return (
    <g>
      <polygon points={pts([x0 - 1.6, y0 + 1, 0], [x1 - 1, y0 + 1, 0], [x1 - 1, y1 + 2, 0], [x0 - 1.6, y1 + 2, 0])} fill="#3c4434" opacity={0.2} filter={`url(#${ids.soft})`} />
      <polygon points={faceRect("south", y0, x0, x1, 0, H)} fill="#f7f4ed" />
      <polygon points={faceRect("east", x1, y0, y1, 0, H)} fill="#dcd7cb" />
      <polygon points={faceRect("south", y0, x0, x1, 0, 0.25)} fill="#cfc9bc" />
      <polygon points={faceRect("east", x1, y0, y1, 0, 0.25)} fill="#b9b3a6" />
      <g stroke="#3b3a35" strokeWidth={0.9}>
        <polygon points={faceRect("south", y0, g0, g1, 0.25, glazeTop)} fill={`url(#${ids.glass})`} />
        {Array.from({ length: panels - 1 }, (_, i) => {
          const x = g0 + ((g1 - g0) * (i + 1)) / panels;
          return <polyline key={i} points={pts([x, y0, 0.25], [x, y0, glazeTop])} />;
        })}
        <polygon points={faceRect("south", y0, x0 + W * 0.78, x0 + W * 0.91, 0.9, winTop)} fill={`url(#${ids.glass})`} />
        <polygon points={faceRect("east", x1, y0 + D * 0.14, y0 + D * 0.4, 0.9, winTop)} fill="#cfd5d6" />
        <polygon points={faceRect("east", x1, y0 + D * 0.59, y0 + D * 0.84, 0.9, winTop)} fill="#cfd5d6" />
      </g>
      {faces.map((face, i) => (
        <polygon key={i} points={pts(...(face.p as P3[]))} fill={face.f} />
      ))}
      <polygon points={pts(a, b, [b[0], b[1], H - 0.25], [a[0], a[1], H - 0.25])} fill="#2f3132" />
      <polygon points={pts(b, c, [c[0], c[1], H - 0.25], [b[0], b[1], H - 0.25])} fill="#242627" />
    </g>
  );
}

interface IsoIds {
  glass: string;
  lawn: string;
  soft: string;
}

/**
 * Unique ids for one drawing's gradients. Next keeps visited pages in the
 * document (hidden), so fixed ids could resolve to another page's copy.
 */
function useIsoIds(): IsoIds {
  const id = useId();
  return { glass: `${id}-glass`, lawn: `${id}-lawn`, soft: `${id}-soft` };
}

/** Gradients and blur shared by the isometric drawings. */
function IsoDefs({ ids }: { ids: IsoIds }) {
  return (
    <defs>
      <linearGradient id={ids.glass} x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stopColor="#fbe3b0" />
        <stop offset="1" stopColor="#e6a35b" />
      </linearGradient>
      <radialGradient id={ids.lawn} cx="0.5" cy="0.5" r="0.6">
        <stop offset="0" stopColor="#d3dcc2" />
        <stop offset="0.75" stopColor="#dfe4d3" />
        <stop offset="1" stopColor="#e9e9e1" stopOpacity={0} />
      </radialGradient>
      <filter id={ids.soft} x="-20%" y="-20%" width="140%" height="140%">
        <feGaussianBlur stdDeviation="4" />
      </filter>
    </defs>
  );
}

/**
 * Rectangles tiling an outline, ordered so each is drawn before any it
 * stands behind (the viewer looks from the south-east).
 */
function backToFront(outline: Point2[]): Rect[] {
  const slabs = slabPartition(outline);
  const overlaps = (a0: number, a1: number, b0: number, b1: number) => Math.min(a1, b1) - Math.max(a0, b0) > 1e-6;
  const behind = (a: Rect, b: Rect) =>
    (a.minY >= b.maxY - 1e-6 && overlaps(a.minX, a.maxX, b.minX, b.maxX)) || (a.maxX <= b.minX + 1e-6 && overlaps(a.minY, a.maxY, b.minY, b.maxY));
  const order: Rect[] = [];
  const left = [...slabs];
  while (left.length) {
    const next = left.findIndex((a) => !left.some((b) => b !== a && behind(b, a)));
    order.push(...left.splice(next < 0 ? 0 : next, 1));
  }
  return order;
}

/**
 * The massing of a house of the given outside size, in its garden: a quick
 * read of scale, not a 3D model of the plan. An outline other than a
 * rectangle is drawn as its rectangular parts, each with its own roof.
 */
export function MassingPreview({ width, depth, wallHeight, outline }: { width: number; depth: number; wallHeight: number; outline?: Point2[] | null }) {
  const ids = useIsoIds();
  const [W, D, H] = [width, depth, Math.min(Math.max(wallHeight, 2), 6)];
  const parts = outline && outline.length > 4 ? backToFront(outline) : [{ minX: 0, minY: 0, maxX: W, maxY: D }];
  const m = Math.max(W, D) * 0.45 + 3;
  const trees: Array<{ at: [number, number]; r?: number; tone?: number }> = [
    { at: [-m * 0.55, D + m * 0.5], r: 1.7 },
    { at: [W * 0.3, D + m * 0.75], r: 2, tone: 1 },
    { at: [W * 0.85, D + m * 0.7], r: 1.6 },
    { at: [W + m * 0.6, D + m * 0.3], r: 1.9, tone: 1 },
    { at: [W + m * 0.75, D * 0.35], r: 1.5 },
    { at: [-m * 0.6, -m * 0.25], r: 1.4, tone: 1 },
  ];
  trees.sort((p, q) => p.at[0] - p.at[1] - (q.at[0] - q.at[1]));
  const ground: P3[] = [
    [-m, -m, 0],
    [W + m, -m, 0],
    [W + m, D + m, 0],
    [-m, D + m, 0],
  ];
  // Frame the house with a little garden around it; the rest of the garden runs past the frame.
  const f = Math.max(W, D) * 0.18 + 1.5;
  const framed: Array<[number, number]> = [
    iso([-f, -f, 0]),
    iso([W + f, -f, 0]),
    iso([W + f, D + f, 0]),
    iso([-f, D + f, 0]),
    iso([W / 2, D / 2, H + Math.min(W, D) / 4 + 3]),
  ];
  const xs = framed.map((p) => p[0]);
  const ys = framed.map((p) => p[1]);
  const [x0, x1, y0, y1] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
  return (
    <svg className="massing-art" viewBox={`${x0} ${y0} ${x1 - x0} ${y1 - y0}`} preserveAspectRatio="xMidYMid meet" aria-hidden>
      <IsoDefs ids={ids} />
      <polygon points={pts(...ground)} fill={`url(#${ids.lawn})`} />
      <polygon points={pts([W * 0.09, -2.8, 0], [W * 0.72, -2.8, 0], [W * 0.72, 0, 0], [W * 0.09, 0, 0])} fill="#e7e3d9" />
      {trees.filter((t) => t.at[0] - t.at[1] < 0).map((t, i) => (
        <Tree key={`b${i}`} {...t} />
      ))}
      {parts.map((r, i) => (
        <HouseMass key={i} x0={r.minX} y0={r.minY} W={r.maxX - r.minX} D={r.maxY - r.minY} H={H} ids={ids} />
      ))}
      {trees.filter((t) => t.at[0] - t.at[1] >= 0).map((t, i) => (
        <Tree key={`f${i}`} {...t} />
      ))}
    </svg>
  );
}

export function HeroIllustration() {
  const ids = useIsoIds();
  const plan = templatePreview(PROJECT_TEMPLATES[0]);
  const scene = useMemo(() => (plan ? buildPlanScene(plan.levels[0]) : null), [plan]);
  const r = scene?.outsideRect;

  // World layout (metres, y = depth): the house, and in front of it a drawing sheet at reduced scale.
  const [hx0, hy0, W, D, H] = [12, 9, 13, 9, 3];
  const [hx1, hy1] = [hx0 + W, hy0 + D];
  const ridgeTop = H + (Math.min(W, D) / 2) * 0.5;
  const k = 0.72;
  const [px, py] = [5.5, -4];
  const planW = r ? (r.maxX - r.minX) * k : 0;
  const planD = r ? (r.maxY - r.minY) * k : 0;
  const sheet = (m: number): P3[] => [
    [px - m, py - m, 0],
    [px + planW + m, py - m, 0],
    [px + planW + m, py + planD + m, 0],
    [px - m, py + planD + m, 0],
  ];
  const planTransform = r ? `matrix(${COS * S} ${0.5 * S} ${COS * S} ${-0.5 * S} 0 0) translate(${px} ${py}) scale(${k}) translate(${-r.minX} ${-r.minY})` : undefined;

  // Drafting grid, running well past the frame so it reaches into the faded edge.
  const grid: ReactNode[] = [];
  for (let v = -30; v <= 40; v += 2) {
    grid.push(<polyline key={`x${v}`} points={pts([v, -30, 0], [v, 40, 0])} />);
    grid.push(<polyline key={`y${v}`} points={pts([-30, v, 0], [40, v, 0])} />);
  }

  const trees: Array<{ at: [number, number]; r?: number; tone?: number }> = [
    { at: [9, 21], r: 1.6 },
    { at: [13, 23.5], r: 2, tone: 1 },
    { at: [18.5, 24], r: 1.7 },
    { at: [23.5, 23.5], r: 2.1, tone: 1 },
    { at: [28.5, 20.5], r: 1.8 },
    { at: [30, 14.5], r: 1.5, tone: 1 },
    { at: [29.5, 7.5], r: 1.4 },
  ];
  trees.sort((p, q) => p.at[0] - p.at[1] - (q.at[0] - q.at[1]));

  // Frame the sheet and the house tightly; trees and garden may run past the frame (the hero clips them).
  const framed = [...sheet(0.6), [hx0 - 0.5, hy0 - 0.5, H], [hx1 + 0.5, hy0 - 0.5, 0], [hx1 + 0.5, hy1 + 0.5, H], [hx0 - 0.5, hy1 + 0.5, H], [hx0 + D / 2, hy0 + D / 2, ridgeTop + 1.2]].map((p) => iso(p as P3));
  const xs = framed.map((p) => p[0]);
  const ys = framed.map((p) => p[1]);
  const [x0, x1, y0, y1] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
  const m = (y1 - y0) * 0.1;
  const [minX, maxX, minY, maxY] = [x0 - m, x1 + m * 1.6, y0 - m, y1 + m * 0.6];

  return (
    <svg className="hero-art" viewBox={`${minX} ${minY} ${maxX - minX} ${maxY - minY}`} preserveAspectRatio="xMaxYMid meet" aria-hidden>
      <IsoDefs ids={ids} />

      <g stroke="#bdb8ad" strokeWidth={0.5} opacity={0.4} fill="none">
        {grid}
      </g>

      {/* Garden and terrace. */}
      <polygon points={pts([hx0 - 5, hy0 - 6, 0], [hx1 + 7, hy0 - 6, 0], [hx1 + 7, hy1 + 7, 0], [hx0 - 5, hy1 + 7, 0])} fill={`url(#${ids.lawn})`} />
      <polygon points={pts([hx0 + 1, hy0 - 2.8, 0], [hx0 + 9.4, hy0 - 2.8, 0], [hx0 + 9.4, hy0, 0], [hx0 + 1, hy0, 0])} fill="#e7e3d9" />

      {trees.map((t, i) => (
        <Tree key={i} {...t} />
      ))}

      <HouseMass x0={hx0} y0={hy0} W={W} D={D} H={H} ids={ids} />

      {/* The drawing sheet, in front. */}
      {r && scene && (
        <g>
          <polygon points={pts(...sheet(1.4))} fill="#3c3a33" opacity={0.14} filter={`url(#${ids.soft})`} />
          <polygon points={pts(...sheet(1))} fill="#fcfbf8" />
          <g transform={planTransform}>
            <PlanDrawing scene={scene} palette="warm" detail />
          </g>
        </g>
      )}
    </svg>
  );
}

// ── Template exteriors: a front elevation in a small garden scene ──

function Shrubs({ at }: { at: number[] }) {
  return (
    <g>
      {at.map((x, i) => (
        <g key={i}>
          <ellipse cx={x} cy={113} rx={9} ry={6} fill="#8e9f7c" />
          <ellipse cx={x + 5} cy={111} rx={6} ry={5} fill="#a5b393" />
        </g>
      ))}
    </g>
  );
}

function Window({ x, y, w, h }: { x: number; y: number; w: number; h: number }) {
  return (
    <g>
      <rect x={x} y={y} width={w} height={h} fill="#5f6d74" stroke="#fbfaf7" strokeWidth={1.4} />
      <path d={`M${x + w / 2} ${y}V${y + h}`} stroke="#fbfaf7" strokeWidth={1} />
      <path d={`M${x + 1.5} ${y + h - 2}L${x + w / 2 - 1} ${y + 2}`} stroke="#ffffff" strokeOpacity={0.18} strokeWidth={2} />
    </g>
  );
}

const HOUSES: Record<TemplateStyle, ReactNode> = {
  bungalow: (
    <g>
      <rect x={52} y={84} width={136} height={30} fill="#f4f1ea" />
      <rect x={52} y={111} width={136} height={3} fill="#c4beb1" />
      <polygon points="40,86 200,86 172,56 68,56" fill="#4d5052" />
      <rect x={40} y={86} width={160} height={2.5} fill="#2f3132" />
      <Window x={62} y={92} w={22} h={13} />
      <Window x={88} y={92} w={14} h={13} />
      <Window x={140} y={92} w={22} h={13} />
      <Window x={166} y={92} w={14} h={13} />
      <rect x={112} y={92} width={14} height={22} fill="#6b5745" />
      <polygon points="104,92 134,92 128,86 110,86" fill="#3f4244" />
      <rect x={106} y={92} width={2} height={22} fill="#e9e5dc" />
      <rect x={130} y={92} width={2} height={22} fill="#e9e5dc" />
    </g>
  ),
  detached: (
    <g>
      <rect x={44} y={80} width={152} height={34} fill="#b98d6c" />
      <polygon points="36,82 204,82 184,52 56,52" fill="#4a4d4f" />
      <rect x={36} y={82} width={168} height={2.5} fill="#2f3132" />
      <rect x={96} y={68} width={50} height={46} fill="#f2eee6" />
      <polygon points="90,70 152,70 121,40" fill="#3f4244" />
      <polygon points="98,70 144,70 121,48" fill="#f2eee6" />
      <rect x={108} y={76} width={26} height={20} fill="#5f6d74" stroke="#fbfaf7" strokeWidth={1.4} />
      <path d="M121 76V96M108 86H134" stroke="#fbfaf7" strokeWidth={1} />
      <rect x={114} y={99} width={14} height={15} fill="#6b5745" />
      <Window x={56} y={90} w={26} h={14} />
      <Window x={158} y={90} w={26} h={14} />
      <rect x={44} y={111} width={152} height={3} fill="#8f6e55" />
    </g>
  ),
  semi: (
    <g>
      <rect x={120} y={76} width={86} height={38} fill="#b98d6c" opacity={0.75} />
      <rect x={34} y={76} width={86} height={38} fill="#f4f1ea" />
      <polygon points="26,78 214,78 192,46 48,46" fill="#4d5052" />
      <rect x={26} y={78} width={188} height={2.5} fill="#2f3132" />
      <rect x={114} y={36} width={12} height={14} fill="#8a6f5a" />
      <Window x={46} y={88} w={28} h={14} />
      <rect x={90} y={95} width={14} height={19} fill="#4f5d55" />
      <polygon points="86,95 108,95 104,90 90,90" fill="#3f4244" />
      <g opacity={0.75}>
        <Window x={166} y={88} w={28} h={14} />
        <rect x={136} y={95} width={14} height={19} fill="#6b5745" />
      </g>
      <rect x={34} y={111} width={172} height={3} fill="#c4beb1" />
    </g>
  ),
  annexe: (
    <g>
      <rect x={72} y={84} width={98} height={30} fill="#a7835f" />
      <g stroke="#8d6b4b" strokeWidth={0.8}>
        {Array.from({ length: 19 }, (_, i) => (
          <path key={i} d={`M${76 + i * 5} 84V114`} />
        ))}
      </g>
      <polygon points="64,86 178,78 178,74 64,82" fill="#3f4244" />
      <rect x={86} y={90} width={46} height={24} fill="#5f6d74" stroke="#f1ede6" strokeWidth={1.6} />
      <path d="M101 90V114M117 90V114" stroke="#f1ede6" strokeWidth={1.2} />
      <Window x={142} y={92} w={18} h={12} />
      <rect x={78} y={114} width={70} height={4} fill="#c9b79d" />
    </g>
  ),
};

/** A front elevation of the kind of house the template lays out. */
export function TemplateExterior({ style }: { style: TemplateStyle }) {
  const sky = useId();
  return (
    <svg className="template-exterior" viewBox="0 22 240 128" preserveAspectRatio="xMidYMid slice" aria-hidden>
      <defs>
        <linearGradient id={sky} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#e9eeec" />
          <stop offset="1" stopColor="#f6f4ee" />
        </linearGradient>
      </defs>
      <rect width={240} height={150} fill={`url(#${sky})`} />
      <g fill="#c4cfb9">
        <ellipse cx={18} cy={98} rx={26} ry={26} />
        <ellipse cx={226} cy={96} rx={30} ry={30} />
        <ellipse cx={200} cy={104} rx={18} ry={18} fill="#b5c2a8" />
        <ellipse cx={44} cy={106} rx={16} ry={14} fill="#b5c2a8" />
      </g>
      <rect y={112} width={240} height={38} fill="#c5d0b1" />
      <polygon points="104,114 136,114 160,150 80,150" fill="#e4e0d6" />
      {HOUSES[style]}
      <Shrubs at={style === "annexe" ? [56, 184] : [30, 200]} />
    </svg>
  );
}
