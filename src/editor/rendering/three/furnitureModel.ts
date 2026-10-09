import { toPlan } from "@/domain/furniture/geometry";
import type { Furniture } from "@/domain/plan/types";
import type { Box } from "./houseModel";

/**
 * Simple massing for furniture in 3D: a few boxes per piece (seat, back and
 * arms for a sofa; top and legs for a table), enough to read the room at a
 * glance. Pure data in the house model's frame, like the rest of it.
 */

export type FurnitureTone = "fabric" | "cushion" | "wood" | "white" | "dark" | "worktop" | "water" | "leaf" | "linen" | "duvet" | "glass" | "paint";

type Piece = [x0: number, x1: number, y0: number, y1: number, z0: number, z1: number, tone: FurnitureTone];

function pieces(item: Furniture): Piece[] {
  const x = item.width / 2;
  const y = item.depth / 2;
  const h = item.height;
  switch (item.kind) {
    case "sofa_3":
    case "sofa_2":
    case "armchair": {
      const arm = Math.min(0.18, item.width * 0.18);
      const back = Math.min(0.22, item.depth * 0.26);
      const seat = h * 0.5;
      return [
        [-x + arm, x - arm, -y, y - back, 0, seat, "fabric"],
        [-x + arm, x - arm, -y + 0.04, y - back, seat, seat + 0.08, "cushion"],
        [-x, x, y - back, y, 0, h, "fabric"],
        [-x, -x + arm, -y, y - back, 0, h * 0.72, "fabric"],
        [x - arm, x, -y, y - back, 0, h * 0.72, "fabric"],
      ];
    }
    case "coffee_table":
      return [
        [-x, x, -y, y, h - 0.04, h, "wood"],
        [-x + 0.08, x - 0.08, -y + 0.08, y - 0.08, 0, h - 0.04, "dark"],
      ];
    case "tv_unit": {
      const tv = Math.min(1.3, item.width * 0.8) / 2;
      return [
        [-x, x, -y, y, 0, h, "wood"],
        [-tv, tv, y - 0.12, y - 0.07, h + 0.05, h + 0.05 + tv * 1.12, "dark"],
        [-0.15, 0.15, y - 0.2, y - 0.02, h, h + 0.05, "dark"],
      ];
    }
    case "bookcase":
    case "shelving":
    case "wardrobe":
    case "sideboard":
    case "chest_of_drawers":
      return [[-x, x, -y, y, 0, h, item.kind === "shelving" ? "white" : "wood"]];
    case "dining_set_4":
    case "dining_set_6": {
      const perSide = item.kind === "dining_set_6" ? 3 : 2;
      const tableD = Math.max(item.depth - 0.9, 0.6) / 2;
      const tableW = (item.width - 0.1) / 2;
      const out: Piece[] = [[-tableW, tableW, -tableD, tableD, h - 0.04, h, "wood"]];
      for (const [lx, ly] of [
        [-1, -1],
        [1, -1],
        [-1, 1],
        [1, 1],
      ]) {
        const cx = lx * (tableW - 0.08);
        const cy = ly * (tableD - 0.08);
        out.push([cx - 0.03, cx + 0.03, cy - 0.03, cy + 0.03, 0, h - 0.04, "wood"]);
      }
      for (const side of [-1, 1]) {
        for (let i = 0; i < perSide; i++) {
          const cx = -tableW + (2 * tableW * (i + 0.5)) / perSide;
          const near = side * (tableD + 0.02);
          const far = side * (tableD + 0.42);
          const [y0, y1] = [Math.min(near, far), Math.max(near, far)];
          out.push([cx - 0.2, cx + 0.2, y0, y1, 0.42, 0.46, "wood"]);
          out.push([cx - 0.2, cx + 0.2, side > 0 ? y1 - 0.04 : y0, side > 0 ? y1 : y0 + 0.04, 0.46, 0.88, "wood"]);
          out.push([cx - 0.17, cx + 0.17, y0 + 0.03, y1 - 0.03, 0, 0.42, "dark"]);
        }
      }
      return out;
    }
    case "kitchen_run":
    case "kitchen_island":
    case "worktop": {
      const top = h;
      const out: Piece[] = [
        [-x, x, -y + 0.05, y, 0.1, top - 0.04, "white"],
        [-x, x, -y + 0.1, y, 0, 0.1, "dark"],
        [-x, x, -y, y, top - 0.04, top, "worktop"],
      ];
      if (item.kind === "kitchen_run") {
        const sinkX = item.width >= 1.8 ? -x + item.width * 0.3 : 0;
        out.push([sinkX - 0.28, sinkX + 0.28, -y + 0.1, y - 0.1, top, top + 0.005, "water"]);
        if (item.width >= 1.8) {
          const hobX = -x + item.width * 0.72;
          out.push([hobX - 0.29, hobX + 0.29, -y + 0.06, y - 0.06, top, top + 0.01, "dark"]);
        }
      }
      return out;
    }
    case "fridge":
    case "washing_machine":
      return [[-x, x, -y, y, 0, h, "white"]];
    case "bed_single":
    case "bed_double":
    case "bed_king": {
      const pillows = item.kind === "bed_single" ? 1 : 2;
      const pw = (item.width - 0.12 - 0.06 * (pillows - 1)) / pillows;
      const out: Piece[] = [
        [-x, x, -y, y - 0.08, 0, 0.28, "wood"],
        [-x + 0.03, x - 0.03, -y + 0.03, y - 0.1, 0.28, h, "linen"],
        [-x + 0.02, x - 0.02, -y + 0.02, y - 0.65, h, h + 0.04, "duvet"],
        [-x, x, y - 0.08, y, 0, 1, "wood"],
      ];
      for (let i = 0; i < pillows; i++) {
        const x0 = -x + 0.06 + i * (pw + 0.06);
        out.push([x0, x0 + pw, y - 0.45, y - 0.14, h, h + 0.1, "linen"]);
      }
      return out;
    }
    case "bedside_table":
      return [
        [-x, x, -y, y, 0, h, "wood"],
        [-0.08, 0.08, -0.08, 0.08, h, h + 0.32, "white"],
      ];
    case "desk":
      return [
        [-x, x, y - 0.6, y, 0.72, 0.75, "wood"],
        [-x, -x + 0.04, y - 0.6, y, 0, 0.72, "wood"],
        [x - 0.04, x, y - 0.6, y, 0, 0.72, "wood"],
        [-0.3, 0.3, y - 0.12, y - 0.08, 0.8, 1.15, "dark"],
        [-0.24, 0.24, y - 0.82, y - 0.38, 0.42, 0.48, "fabric"],
        [-0.24, 0.24, y - 0.86, y - 0.82, 0.48, 0.92, "fabric"],
        [-0.04, 0.04, y - 0.64, y - 0.56, 0, 0.42, "dark"],
      ];
    case "bath":
      return [
        [-x, x, -y, y, 0, h, "white"],
        [-x + 0.08, x - 0.08, -y + 0.08, y - 0.08, h - 0.12, h - 0.11, "water"],
      ];
    case "shower":
      return [
        [-x, x, -y, y, 0, 0.05, "white"],
        [-x, x, -y, -y + 0.01, 0.05, h, "glass"],
        [-x, -x + 0.01, -y, y, 0.05, h, "glass"],
      ];
    case "toilet":
      return [
        [-x, x, y - 0.18, y, 0, h, "white"],
        [-x * 0.85, x * 0.85, -y + 0.05, y - 0.18, 0, 0.4, "white"],
      ];
    case "basin":
      return [
        [-x, x, -y, y, 0, h - 0.06, "wood"],
        [-x, x, -y, y, h - 0.06, h, "white"],
      ];
    case "car":
      return [
        [-x, x, -y, y, 0.15, h * 0.5, "paint"],
        [-x + 0.08, x - 0.08, -y * 0.45, y * 0.35, h * 0.5, h, "glass"],
        [-x + 0.1, x - 0.1, -y * 0.4, y * 0.3, h - 0.04, h, "paint"],
      ];
    case "plant":
      return [
        [-x * 0.6, x * 0.6, -y * 0.6, y * 0.6, 0, 0.35, "wood"],
        [-x, x, -y, y, 0.35, h, "leaf"],
      ];
  }
}

/** Boxes for one piece; in a cutaway nothing rises above the cut. */
export function furnitureBoxes(item: Furniture, cap = Infinity): Box[] {
  const angle = (item.rotation * Math.PI) / 180;
  const out: Box[] = [];
  for (const [x0, x1, y0, y1, z0, z1raw, tone] of pieces(item)) {
    const z1 = Math.min(z1raw, cap);
    if (z1 - z0 < 0.005 || x1 - x0 < 0.005 || y1 - y0 < 0.005) continue;
    out.push({
      kind: "furniture",
      tone,
      center: toPlan(item, { x: (x0 + x1) / 2, y: (y0 + y1) / 2 }),
      z0,
      length: x1 - x0,
      depth: y1 - y0,
      height: z1 - z0,
      angle,
      furnitureId: item.id,
    });
  }
  return out;
}
