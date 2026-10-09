import { toPlan } from "@/domain/furniture/geometry";
import type { Ring } from "@/domain/geometry/polygons";
import type { Furniture, FurnitureKind, Point2 } from "@/domain/plan/types";

/**
 * Plan symbols for furniture, drawn the way architectural plans show them:
 * outlines with a few telling details (pillows on a bed, burners on a hob).
 * Parts are built in the item's own frame (centre origin, width along x,
 * back at +y) and mapped to the plan, so callers draw plain rings.
 */

/** Fill tones; renderers map them to colours. */
export type SymbolTone = "body" | "soft" | "dark" | "water" | "leaf" | "none";

export interface SymbolPart {
  ring: Ring;
  tone: SymbolTone;
  /** Open polylines are stroked only. */
  closed: boolean;
}

type Local = SymbolPart;

const rect = (x0: number, y0: number, x1: number, y1: number, tone: SymbolTone = "body", radius = 0): Local => {
  const [a, b] = [Math.min(x0, x1), Math.max(x0, x1)];
  const [c, d] = [Math.min(y0, y1), Math.max(y0, y1)];
  const r = Math.min(radius, (b - a) / 2, (d - c) / 2);
  if (r <= 0.001) {
    return { ring: [{ x: a, y: c }, { x: b, y: c }, { x: b, y: d }, { x: a, y: d }], tone, closed: true };
  }
  const ring: Ring = [];
  const corners: Array<[number, number, number]> = [
    [b - r, c + r, -Math.PI / 2],
    [b - r, d - r, 0],
    [a + r, d - r, Math.PI / 2],
    [a + r, c + r, Math.PI],
  ];
  for (const [cx, cy, start] of corners) {
    for (let i = 0; i <= 4; i++) {
      const t = start + (i / 4) * (Math.PI / 2);
      ring.push({ x: cx + Math.cos(t) * r, y: cy + Math.sin(t) * r });
    }
  }
  return { ring, tone, closed: true };
};

const ellipse = (cx: number, cy: number, rx: number, ry: number, tone: SymbolTone = "body", steps = 20): Local => ({
  ring: Array.from({ length: steps }, (_, i) => {
    const t = (i / steps) * Math.PI * 2;
    return { x: cx + Math.cos(t) * rx, y: cy + Math.sin(t) * ry };
  }),
  tone,
  closed: true,
});

const line = (...points: Array<[number, number]>): Local => ({ ring: points.map(([x, y]) => ({ x, y })), tone: "none", closed: false });

/** Sofas and armchairs: a back, two arms and seat cushions. */
function seating(w: number, d: number, seats: number): Local[] {
  const x = w / 2;
  const y = d / 2;
  const arm = Math.min(0.18, w * 0.18);
  const back = Math.min(0.22, d * 0.26);
  const parts = [rect(-x, -y, x, y, "body", 0.08), rect(-x + arm, y - back, x - arm, y, "soft", 0.04), rect(-x, -y, -x + arm, y, "soft", 0.06), rect(x - arm, -y, x, y, "soft", 0.06)];
  const inner = w - 2 * arm;
  for (let i = 0; i < seats; i++) {
    const x0 = -x + arm + (inner * i) / seats;
    parts.push(rect(x0 + 0.02, -y + 0.05, x0 + inner / seats - 0.02, y - back - 0.02, "body", 0.05));
  }
  return parts;
}

function bed(w: number, d: number, pillows: number): Local[] {
  const x = w / 2;
  const y = d / 2;
  const parts = [rect(-x, -y, x, y, "body", 0.04), rect(-x + 0.04, -y + 0.04, x - 0.04, y - 0.08, "soft", 0.04)];
  // Headboard.
  parts.push(rect(-x, y - 0.08, x, y, "dark"));
  const gap = 0.06;
  const pw = (w - 0.12 - gap * (pillows - 1)) / pillows;
  for (let i = 0; i < pillows; i++) {
    const x0 = -x + 0.06 + i * (pw + gap);
    parts.push(rect(x0, y - 0.45, x0 + pw, y - 0.14, "body", 0.06));
  }
  // The turned-down duvet.
  parts.push(rect(-x + 0.04, -y + 0.04, x - 0.04, y - 0.62, "body", 0.03), line([-x + 0.04, y - 0.78], [x - 0.04, y - 0.78]));
  return parts;
}

function dining(w: number, d: number, perSide: number): Local[] {
  const chair = 0.42;
  const tableD = Math.max(d - 2 * 0.45, 0.6);
  const tableW = w - 0.1;
  const parts: Local[] = [];
  for (const side of [-1, 1]) {
    for (let i = 0; i < perSide; i++) {
      const cx = -tableW / 2 + (tableW * (i + 0.5)) / perSide;
      const cy = side * (tableD / 2 + 0.16);
      parts.push(rect(cx - chair / 2, cy - 0.2, cx + chair / 2, cy + 0.2, "body", 0.06));
      parts.push(line([cx - chair / 2 + 0.04, cy + side * 0.16], [cx + chair / 2 - 0.04, cy + side * 0.16]));
    }
  }
  parts.push(rect(-tableW / 2, -tableD / 2, tableW / 2, tableD / 2, "soft", 0.03));
  return parts;
}

function kitchenRun(w: number, d: number): Local[] {
  const x = w / 2;
  const y = d / 2;
  const parts = [rect(-x, -y, x, y, "soft"), line([-x, -y + 0.04], [x, -y + 0.04])];
  // Unit joints every 600 mm.
  for (let s = -x + 0.6; s < x - 0.05; s += 0.6) parts.push(line([s, -y + 0.04], [s, y]));
  // A sink a third of the way along, and a hob two thirds along when there is room.
  const sinkX = w >= 1.8 ? -x + w * 0.3 : 0;
  parts.push(rect(sinkX - 0.3, -y + 0.1, sinkX + 0.3, y - 0.1, "water", 0.05), ellipse(sinkX, 0.02, 0.025, 0.025, "dark", 10));
  if (w >= 1.8) {
    const hobX = -x + w * 0.72;
    parts.push(rect(hobX - 0.29, -y + 0.06, hobX + 0.29, y - 0.06, "dark", 0.02));
    for (const [dx, dy, r] of [
      [-0.14, -0.11, 0.07],
      [0.14, -0.11, 0.06],
      [-0.14, 0.11, 0.06],
      [0.14, 0.11, 0.08],
    ]) {
      parts.push(ellipse(hobX + dx, dy, r, r, "none", 14));
    }
  }
  return parts;
}

function symbolParts(kind: FurnitureKind, w: number, d: number): Local[] {
  const x = w / 2;
  const y = d / 2;
  switch (kind) {
    case "sofa_3":
      return seating(w, d, 3);
    case "sofa_2":
      return seating(w, d, 2);
    case "armchair":
      return seating(w, d, 1);
    case "coffee_table":
      return [rect(-x, -y, x, y, "soft", 0.05), rect(-x + 0.06, -y + 0.06, x - 0.06, y - 0.06, "none", 0.03)];
    case "tv_unit":
      return [rect(-x, -y, x, y, "soft"), rect(-x * 0.75, y - 0.14, x * 0.75, y - 0.07, "dark")];
    case "bookcase":
    case "shelving": {
      const parts = [rect(-x, -y, x, y, "soft")];
      for (let s = -x + 0.5; s < x - 0.1; s += 0.5) parts.push(line([s, -y], [s, y]));
      parts.push(line([-x, -y + 0.06], [x, -y + 0.06]));
      return parts;
    }
    case "dining_set_4":
      return dining(w, d, 2);
    case "dining_set_6":
      return dining(w, d, 3);
    case "sideboard":
    case "chest_of_drawers":
      return [rect(-x, -y, x, y, "soft"), line([-x / 3, -y], [-x / 3, y]), line([x / 3, -y], [x / 3, y]), line([-x, -y + 0.05], [x, -y + 0.05])];
    case "kitchen_run":
      return kitchenRun(w, d);
    case "kitchen_island":
      return [rect(-x, -y, x, y, "soft", 0.03), line([-x, -y + 0.3], [x, -y + 0.3]), rect(-0.25, y - 0.42, 0.25, y - 0.08, "water", 0.05)];
    case "worktop":
      return [rect(-x, -y, x, y, "soft"), line([-x, -y + 0.04], [x, -y + 0.04])];
    case "fridge":
      return [rect(-x, -y, x, y, "body", 0.03), line([-x, -y + 0.06], [x, -y + 0.06]), line([-x + 0.06, -y + 0.06], [x - 0.06, y - 0.04])];
    case "bed_single":
      return bed(w, d, 1);
    case "bed_double":
    case "bed_king":
      return bed(w, d, 2);
    case "bedside_table":
      return [rect(-x, -y, x, y, "soft", 0.03), ellipse(0, 0.02, Math.min(x, y) * 0.55, Math.min(x, y) * 0.55, "body", 16)];
    case "wardrobe": {
      const parts = [rect(-x, -y, x, y, "soft"), line([-x + 0.05, 0], [x - 0.05, 0])];
      for (let s = -x + 0.12; s < x - 0.08; s += 0.14) parts.push(line([s - 0.03, -0.16], [s + 0.03, 0.16]));
      return parts;
    }
    case "desk":
      return [
        rect(-x, y - 0.6, x, y, "soft"),
        rect(-0.3, y - 0.12, 0.3, y - 0.07, "dark"),
        rect(-0.24, y - 0.82, 0.24, y - 0.36, "body", 0.08),
        line([-0.2, y - 0.8], [0.2, y - 0.8]),
      ];
    case "bath":
      return [rect(-x, -y, x, y, "body", 0.03), rect(-x + 0.08, -y + 0.08, x - 0.08, y - 0.08, "water", Math.min(y - 0.08, 0.25)), ellipse(x - 0.22, 0, 0.03, 0.03, "dark", 10)];
    case "shower":
      return [rect(-x, -y, x, y, "water"), line([-x, -y], [x, y]), line([-x, y], [x, -y]), ellipse(0, 0, 0.05, 0.05, "body", 12)];
    case "toilet":
      return [rect(-x, y - 0.18, x, y, "body", 0.03), ellipse(0, y - 0.18 - (d - 0.2) / 2, x * 0.85, (d - 0.2) / 2, "body"), ellipse(0, y - 0.2 - (d - 0.2) / 2, x * 0.55, (d - 0.2) / 2 - 0.07, "water")];
    case "basin":
      return [rect(-x, -y, x, y, "soft", 0.03), ellipse(0, -0.02, x * 0.65, y * 0.6, "water"), ellipse(0, y - 0.07, 0.025, 0.025, "dark", 10)];
    case "washing_machine":
      return [rect(-x, -y, x, y, "body", 0.03), line([-x, y - 0.1], [x, y - 0.1]), ellipse(0, -0.05, Math.min(x, y) * 0.68, Math.min(x, y) * 0.68, "water"), ellipse(0, -0.05, Math.min(x, y) * 0.48, Math.min(x, y) * 0.48, "none")];
    case "car":
      return [
        rect(-x, -y, x, y, "body", 0.35),
        rect(-x + 0.15, -y * 0.45, x - 0.15, y * 0.35, "soft", 0.2),
        line([-x + 0.2, -y * 0.45], [x - 0.2, -y * 0.45]),
        line([-x + 0.2, y * 0.35], [x - 0.2, y * 0.35]),
      ];
    case "plant": {
      const r = Math.min(x, y);
      const parts: Local[] = [];
      for (let i = 0; i < 6; i++) {
        const t = (i / 6) * Math.PI * 2;
        parts.push(ellipse(Math.cos(t) * r * 0.45, Math.sin(t) * r * 0.45, r * 0.5, r * 0.5, "leaf", 12));
      }
      parts.push(ellipse(0, 0, r * 0.35, r * 0.35, "leaf", 14));
      return parts;
    }
  }
}

/** A piece's symbol on the plan, plus its footprint outline. */
export function furnitureSymbol(item: Pick<Furniture, "kind" | "position" | "rotation" | "width" | "depth">): { outline: Ring; parts: SymbolPart[] } {
  const map = (p: Point2) => toPlan(item, p);
  const x = item.width / 2;
  const y = item.depth / 2;
  return {
    outline: [map({ x: -x, y: -y }), map({ x, y: -y }), map({ x, y }), map({ x: -x, y })],
    parts: symbolParts(item.kind, item.width, item.depth).map((part) => ({ ...part, ring: part.ring.map(map) })),
  };
}

/** The symbol in its own frame, for catalog thumbnails: back at the top of the picture. */
export function furnitureSymbolLocal(kind: FurnitureKind, width: number, depth: number): SymbolPart[] {
  return symbolParts(kind, width, depth);
}
