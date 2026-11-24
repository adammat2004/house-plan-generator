import { analyzeEnvelope } from "@/domain/geometry/envelope";
import type { Ring } from "@/domain/geometry/polygons";
import type { Level } from "@/domain/plan/types";
import { buildPlanScene } from "../scene/planScene";
import type { Elevation } from "./elevations";

/**
 * Drawing sheets for the PDF, in millimetres on the page, drawn through a
 * pen that jsPDF satisfies (and tests can record): a plan in black and
 * white at a stated scale, and the four elevations. The page frame and
 * title block are drawn by `drawFrame`.
 */

export interface Pen {
  moveTo(x: number, y: number): unknown;
  lineTo(x: number, y: number): unknown;
  close(): unknown;
  stroke(): unknown;
  fill(): unknown;
  fillEvenOdd(): unknown;
  line(x1: number, y1: number, x2: number, y2: number): unknown;
  rect(x: number, y: number, w: number, h: number, style?: string | null): unknown;
  setLineWidth(width: number): unknown;
  setDrawColor(colour: string): unknown;
  setFillColor(colour: string): unknown;
  setTextColor(colour: string): unknown;
  setFontSize(size: number): unknown;
  setFont(name: string, style?: string): unknown;
  setLineDashPattern(dash: number[], phase: number): unknown;
  text(text: string, x: number, y: number, options?: { align?: "left" | "center" | "right"; baseline?: "alphabetic" | "middle" | "top" | "bottom" }): unknown;
  getTextWidth(text: string): number;
}

export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** A3 landscape. */
export const PAGE = { w: 420, h: 297 } as const;
const MARGIN = 10;
const TITLE_H = 24;
/** Where a sheet's drawing goes: inside the border, above the title block. */
export const DRAWING_AREA: Box = { x: MARGIN + 6, y: MARGIN + 6, w: PAGE.w - 2 * MARGIN - 12, h: PAGE.h - 2 * MARGIN - TITLE_H - 12 };

/** Scales offered, as 1:n, largest drawing first. */
const SCALES = [50, 100, 200, 500] as const;

/** The largest standard scale at which `width` by `height` metres fits in the box, and mm per metre. */
export function fitScale(width: number, height: number, box: Box): { scale: number; k: number } {
  for (const scale of SCALES) {
    const k = 1000 / scale;
    if (width * k <= box.w && height * k <= box.h) return { scale, k };
  }
  return { scale: 1000, k: 1 };
}

/** jsPDF's standard fonts are WinAnsi: primes become plain quote marks. */
export const pdfText = (text: string) => text.replace(/′/g, "'").replace(/″/g, '"').replace(/−/g, "-").replace(/[–—]/g, "-");

const INK = "#1c1a17";
const GREY = "#8a857c";

function path(pen: Pen, rings: readonly Ring[], map: (p: { x: number; y: number }) => { x: number; y: number }) {
  for (const ring of rings) {
    ring.forEach((p, i) => {
      const q = map(p);
      if (i === 0) pen.moveTo(q.x, q.y);
      else pen.lineTo(q.x, q.y);
    });
    pen.close();
  }
}

function polyline(pen: Pen, points: ReadonlyArray<{ x: number; y: number }>, map: (p: { x: number; y: number }) => { x: number; y: number }) {
  points.forEach((p, i) => {
    const q = map(p);
    if (i === 0) pen.moveTo(q.x, q.y);
    else pen.lineTo(q.x, q.y);
  });
  pen.stroke();
}

/** A dimension line from a to b (page mm) with ticks and its text, offset to one side. */
function dimension(pen: Pen, a: { x: number; y: number }, b: { x: number; y: number }, text: string, vertical: boolean) {
  pen.setLineWidth(0.15);
  pen.setDrawColor(INK);
  pen.line(a.x, a.y, b.x, b.y);
  const t = 1.4;
  for (const p of [a, b]) pen.line(p.x - t, p.y + t, p.x + t, p.y - t);
  pen.setFontSize(7);
  const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
  if (vertical) pen.text(text, mid.x - 1.5, mid.y, { align: "right", baseline: "middle" });
  else pen.text(text, mid.x, mid.y - 1.5, { align: "center" });
}

/** A scale bar of `metres`, starting at (x, y) on the page. */
export function scaleBar(pen: Pen, x: number, y: number, k: number, metres = 5) {
  pen.setLineWidth(0.2);
  pen.setDrawColor(INK);
  for (let i = 0; i < metres; i++) {
    pen.setFillColor(i % 2 ? "#ffffff" : INK);
    pen.rect(x + i * k, y, k, 1.6, "FD");
  }
  pen.setFontSize(6.5);
  pen.setTextColor(INK);
  for (const m of [0, metres]) pen.text(`${m}${m ? " m" : ""}`, x + m * k, y + 5, { align: "center" });
}

/**
 * One floor's plan in black and white: solid walls with their openings,
 * doors with their swings, windows, room outlines, names and areas, and
 * the overall sizes. Returns the scale used (1:n).
 */
export function drawPlan(pen: Pen, level: Level, box: Box, lengthText: (m: number) => string, areaText: (m2: number) => string): number | null {
  const scene = buildPlanScene(level);
  const env = analyzeEnvelope(level);
  const rings = scene.wallMass.flatMap((p) => [p.outer, ...p.holes]);
  if (!rings.length || !env.ok) return null;
  const pts = rings.flat();
  const minX = Math.min(...pts.map((p) => p.x));
  const maxX = Math.max(...pts.map((p) => p.x));
  const minY = Math.min(...pts.map((p) => p.y));
  const maxY = Math.max(...pts.map((p) => p.y));
  // Room for the dimension lines around the plan.
  const pad = 2.2;
  const { scale, k } = fitScale(maxX - minX + 2 * pad, maxY - minY + 2 * pad, box);
  const ox = box.x + (box.w - (maxX - minX) * k) / 2;
  const oy = box.y + (box.h - (maxY - minY) * k) / 2;
  const map = (p: { x: number; y: number }) => ({ x: ox + (p.x - minX) * k, y: oy + (maxY - p.y) * k });

  // Room outlines first, thin and grey.
  pen.setLineWidth(0.1);
  pen.setDrawColor(GREY);
  for (const room of scene.rooms) {
    path(pen, room.clear.map((p) => p.outer), map);
    pen.stroke();
  }
  // The walls, solid.
  pen.setFillColor(INK);
  path(pen, rings, map);
  pen.fillEvenOdd();
  // Doors and windows.
  pen.setDrawColor(INK);
  for (const o of scene.openings) {
    pen.setLineWidth(0.18);
    if (o.leaf) polyline(pen, o.leaf, map);
    if (o.arc) {
      pen.setLineWidth(0.1);
      polyline(pen, o.arc, map);
    }
    for (const s of o.sliders ?? []) {
      path(pen, [s], map);
      pen.stroke();
    }
    if (o.frame) {
      pen.setLineWidth(0.15);
      path(pen, [o.frame], map);
      pen.stroke();
    }
    for (const g of o.glazing ?? []) polyline(pen, g, map);
  }
  // Names and areas.
  pen.setTextColor(INK);
  for (const room of scene.rooms) {
    const at = map(room.label);
    const w = (room.bounds.maxX - room.bounds.minX) * k;
    pen.setFontSize(Math.min(9, Math.max(5.5, w / 3.2)));
    pen.text(pdfText(room.name), at.x, at.y - 0.6, { align: "center" });
    pen.setFontSize(Math.min(7, Math.max(5, w / 4)));
    pen.text(pdfText(areaText(room.clearArea)), at.x, at.y + 2.6, { align: "center" });
  }
  // Overall sizes, below and to the left.
  const o = env.info.outsideRect;
  const below = map({ x: o.minX, y: o.minY - 1.2 });
  const belowEnd = map({ x: o.maxX, y: o.minY - 1.2 });
  dimension(pen, below, belowEnd, pdfText(lengthText(o.maxX - o.minX)), false);
  const left = map({ x: o.minX - 1.2, y: o.minY });
  const leftEnd = map({ x: o.minX - 1.2, y: o.maxY });
  dimension(pen, left, leftEnd, pdfText(lengthText(o.maxY - o.minY)), true);
  scaleBar(pen, box.x, box.y + box.h - 6, k);
  return scale;
}

/** The four elevations in a two-by-two grid, all at one scale. Returns the scale (1:n). */
export function drawElevations(pen: Pen, elevations: readonly Elevation[], box: Box): number | null {
  if (!elevations.length) return null;
  const cellW = box.w / 2;
  const cellH = box.h / 2;
  const widest = Math.max(...elevations.map((e) => e.extent.u1 - e.extent.u0));
  const tallest = Math.max(...elevations.map((e) => e.extent.top));
  const cell = { x: 0, y: 0, w: cellW - 4, h: cellH - 16 };
  const { scale, k } = fitScale(widest + 1, tallest + 1, cell);
  elevations.slice(0, 4).forEach((e, i) => {
    const cx = box.x + (i % 2) * cellW;
    const cy = box.y + Math.floor(i / 2) * cellH;
    const ground = cy + cellH - 12;
    const ox = cx + (cellW - (e.extent.u1 - e.extent.u0) * k) / 2;
    const at = (u: number, z: number) => ({ x: ox + (u - e.extent.u0) * k, y: ground - z * k });
    // Far things first, so nearer walls and roofs cover them.
    type Item = { depth: number; draw: () => void };
    const items: Item[] = [
      ...e.walls.map((w) => ({
        depth: w.depth,
        draw: () => {
          const a = at(w.u0, w.z1);
          pen.setFillColor("#ffffff");
          pen.setLineWidth(0.25);
          pen.rect(a.x, a.y, (w.u1 - w.u0) * k, (w.z1 - w.z0) * k, "FD");
        },
      })),
      ...e.bands.map((b) => ({
        depth: b.depth,
        draw: () => {
          const a = at(b.u0, b.z1);
          pen.setFillColor("#ffffff");
          pen.setLineWidth(0.25);
          pen.rect(a.x, a.y, (b.u1 - b.u0) * k, (b.z1 - b.z0) * k, "FD");
        },
      })),
      ...e.openings.map((o) => ({
        depth: o.depth,
        draw: () => {
          const a = at(o.u0, o.z1);
          pen.setFillColor(o.kind === "window" ? "#e3e8ec" : "#ffffff");
          pen.setLineWidth(0.18);
          pen.rect(a.x, a.y, (o.u1 - o.u0) * k, (o.z1 - o.z0) * k, "FD");
        },
      })),
      ...e.roofs.map((r) => ({
        depth: r.depth,
        draw: () => {
          pen.setFillColor("#d9d6d0");
          pen.setLineWidth(0.25);
          r.points.forEach((p, j) => {
            const q = at(p.u, p.z);
            if (j === 0) pen.moveTo(q.x, q.y);
            else pen.lineTo(q.x, q.y);
          });
          pen.close();
          pen.fill();
          r.points.forEach((p, j) => {
            const q = at(p.u, p.z);
            if (j === 0) pen.moveTo(q.x, q.y);
            else pen.lineTo(q.x, q.y);
          });
          pen.close();
          pen.stroke();
        },
      })),
    ];
    pen.setDrawColor(INK);
    // Openings sit just in front of their wall; roofs over the walls they stand on.
    items.sort((p, q) => q.depth - p.depth);
    for (const item of items) item.draw();
    // The ground.
    pen.setLineWidth(0.5);
    pen.line(ox - 4, ground, ox + (e.extent.u1 - e.extent.u0) * k + 4, ground);
    pen.setFontSize(9);
    pen.setTextColor(INK);
    pen.text(e.title, cx + cellW / 2, ground + 7, { align: "center" });
  });
  scaleBar(pen, box.x, box.y + box.h - 4, k);
  return scale;
}

export interface TitleBlock {
  project: string;
  design: string;
  sheet: string;
  scale: string;
  date: string;
  page: number;
  pages: number;
}

/** The page border and the title block along its foot. */
export function drawFrame(pen: Pen, t: TitleBlock) {
  pen.setDrawColor(INK);
  pen.setLineWidth(0.35);
  pen.rect(MARGIN, MARGIN, PAGE.w - 2 * MARGIN, PAGE.h - 2 * MARGIN, "S");
  const y = PAGE.h - MARGIN - TITLE_H;
  pen.line(MARGIN, y, PAGE.w - MARGIN, y);
  const cols = [MARGIN, MARGIN + 150, MARGIN + 250, MARGIN + 310, MARGIN + 360, PAGE.w - MARGIN];
  for (const x of cols.slice(1, -1)) pen.line(x, y, x, PAGE.h - MARGIN);
  const cell = (i: number, label: string, value: string) => {
    pen.setTextColor("#6b665e");
    pen.setFontSize(6.5);
    pen.text(label.toUpperCase(), cols[i] + 4, y + 6);
    pen.setTextColor(INK);
    pen.setFontSize(i === 0 ? 13 : 10);
    pen.text(pdfText(value), cols[i] + 4, y + 15);
  };
  cell(0, "Project", t.project);
  cell(1, "Sheet", t.sheet);
  cell(2, "Scale at A3", t.scale);
  cell(3, "Date", t.date);
  cell(4, "Page", `${t.page} of ${t.pages}`);
  pen.setFontSize(6.5);
  pen.setTextColor("#6b665e");
  pen.text(pdfText(`${t.design} · Concept design: check every size on site before building.`), cols[0] + 4, PAGE.h - MARGIN - 3);
}
