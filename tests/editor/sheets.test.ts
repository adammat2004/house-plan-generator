import { describe, expect, it } from "vitest";
import { createPlanDocument } from "@/domain/commands";
import { DEFAULT_BRIEF } from "@/domain/brief/schema";
import { planLayouts } from "@/domain/design/stripPlanner";
import { buildElevations } from "@/editor/rendering/drawing/elevations";
import { DRAWING_AREA, drawElevations, drawFrame, drawPlan, fitScale, PAGE, pdfText, type Pen } from "@/editor/rendering/drawing/sheets";

/** A pen that records what's drawn, and where. */
function recorder() {
  const texts: string[] = [];
  const points: Array<{ x: number; y: number }> = [];
  const calls: string[] = [];
  const pen: Pen = {
    moveTo: (x, y) => points.push({ x, y }),
    lineTo: (x, y) => points.push({ x, y }),
    close: () => calls.push("close"),
    stroke: () => calls.push("stroke"),
    fill: () => calls.push("fill"),
    fillEvenOdd: () => calls.push("fillEvenOdd"),
    line: (x1, y1, x2, y2) => points.push({ x: x1, y: y1 }, { x: x2, y: y2 }),
    rect: (x, y, w, h) => points.push({ x, y }, { x: x + w, y: y + h }),
    setLineWidth: () => {},
    setDrawColor: () => {},
    setFillColor: () => {},
    setTextColor: () => {},
    setFontSize: () => {},
    setFont: () => {},
    setLineDashPattern: () => {},
    text: (t) => texts.push(t),
    getTextWidth: (t) => t.length * 2,
  };
  return { pen, texts, points, calls };
}

const plan = () => {
  const source = createPlanDocument({ id: "x", width: 12, depth: 10 });
  return planLayouts({ intent: { action: "generate_layouts", brief: DEFAULT_BRIEF, count: 1, footprint: "auto" }, source, brief: DEFAULT_BRIEF, idPrefix: "s" }).candidates[0].document;
};

describe("drawing sheets", () => {
  it("picks the largest standard scale that fits", () => {
    expect(fitScale(15, 10, { x: 0, y: 0, w: 380, h: 240 }).scale).toBe(50);
    expect(fitScale(30, 20, { x: 0, y: 0, w: 380, h: 240 }).scale).toBe(100);
    expect(fitScale(60, 40, { x: 0, y: 0, w: 380, h: 240 }).scale).toBe(200);
  });

  it("draws a floor in black and white, names every room, and keeps inside the drawing area", () => {
    const doc = plan();
    const r = recorder();
    const scale = drawPlan(r.pen, doc.levels[0], DRAWING_AREA, (m) => `${m.toFixed(2)} m`, (a) => `${a.toFixed(1)} m²`);
    expect([50, 100]).toContain(scale);
    expect(r.calls).toContain("fillEvenOdd");
    for (const room of Object.values(doc.levels[0].rooms)) expect(r.texts).toContain(room.name);
    for (const p of r.points) {
      expect(p.x).toBeGreaterThanOrEqual(DRAWING_AREA.x - 1e-6);
      expect(p.x).toBeLessThanOrEqual(DRAWING_AREA.x + DRAWING_AREA.w + 1e-6);
      expect(p.y).toBeGreaterThanOrEqual(DRAWING_AREA.y - 1e-6);
      expect(p.y).toBeLessThanOrEqual(DRAWING_AREA.y + DRAWING_AREA.h + 1e-6);
    }
  });

  it("draws the four elevations, titled, at one scale", () => {
    const r = recorder();
    const scale = drawElevations(r.pen, buildElevations(plan(), "hipped"), DRAWING_AREA);
    expect(scale).toBeGreaterThan(0);
    for (const title of ["Front elevation", "Rear elevation", "Left side elevation", "Right side elevation"]) expect(r.texts).toContain(title);
  });

  it("frames the page with its title block", () => {
    const r = recorder();
    drawFrame(r.pen, { project: "Our house", design: "B · Biggest living space", sheet: "Floor plan", scale: "1:50", date: "25 October 2026", page: 3, pages: 4 });
    expect(r.texts).toEqual(expect.arrayContaining(["Our house", "Floor plan", "1:50", "3 of 4"]));
    for (const p of r.points) expect(p.x).toBeLessThanOrEqual(PAGE.w);
    expect(pdfText("12′ 6″ − 3")).toBe(`12' 6" - 3`);
  });
});
