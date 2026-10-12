import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { it } from "vitest";
import { BRIEF_PRESETS } from "@/domain/brief/rooms";
import { DEFAULT_BRIEF, withPicks, type HouseBrief } from "@/domain/brief/schema";
import { createPlanDocument } from "@/domain/commands";
import { describePlan } from "@/domain/design/planText";
import { assessHouseSense } from "@/domain/design/houseSense";
import { assessSense } from "@/domain/design/sense";
import { planLayouts } from "@/domain/design/stripPlanner";
import { planSvg } from "./planSvg";

/**
 * `npm run plans:render`: lays out every preset (sized from the rooms, as
 * rectangles and as other shapes) and a few fixed houses, and writes an SVG
 * per plan plus `index.html`, a contact sheet with each plan's description.
 * PLANS_OUT picks the folder (default test-results/plans), so a planner
 * change can be compared with `PLANS_OUT=test-results/plans-before`.
 */

const OUT = process.env.PLANS_OUT ?? "test-results/plans";

const preset = (id: string, extra: Partial<HouseBrief> = {}): HouseBrief => ({ ...withPicks(DEFAULT_BRIEF, BRIEF_PRESETS.find((p) => p.id === id)!.picks), ...extra });

const CASES: Array<{ name: string; brief: HouseBrief; auto: boolean; width?: number; depth?: number }> = [
  ...BRIEF_PRESETS.map((p) => ({ name: p.id, brief: preset(p.id), auto: true })),
  { name: "family-4-any", brief: preset("family-4", { houseShape: "any" }), auto: true },
  { name: "family-3-L", brief: preset("family-3", { houseShape: "L" }), auto: true },
  { name: "bungalow-U", brief: preset("bungalow", { houseShape: "U" }), auto: true },
  { name: "default-8x10", brief: DEFAULT_BRIEF, auto: false, width: 8, depth: 10 },
  { name: "family-3-12x9", brief: preset("family-3"), auto: false, width: 12, depth: 9 },
  // Two storeys: sized from the rooms, and stacked on a drawn house.
  { name: "family-3-two-storey", brief: preset("family-3", { storeys: 2 }), auto: true },
  { name: "family-4-two-storey", brief: preset("family-4", { storeys: 2 }), auto: true },
  { name: "default-two-storey-7.5x9", brief: { ...DEFAULT_BRIEF, storeys: 2 }, auto: false, width: 7.5, depth: 9 },
];

it("renders the plans", () => {
  mkdirSync(OUT, { recursive: true });
  const cards: string[] = [];
  const report: string[] = [];
  for (const c of CASES) {
    const source = createPlanDocument({ id: "plans", name: c.name, width: c.width ?? 10, depth: c.depth ?? 9, externalThickness: 0.3, wallHeight: 2.4 });
    const result = planLayouts({ intent: { action: "generate_layouts", brief: c.brief, count: 3, ...(c.auto ? { footprint: "auto" as const } : {}) }, source, brief: c.brief, idPrefix: "p" });
    report.push(`### ${c.name}${result.issues.length ? `  issues: ${result.issues.map((i) => i.message).join("; ")}` : ""}`);
    result.candidates.forEach((candidate, i) => {
      const { levels } = candidate.document;
      // Every floor side by side, ground first.
      const svgs = levels.map(planSvg);
      levels.forEach((_, k) => writeFileSync(join(OUT, `${c.name}-${i}${levels.length > 1 ? `-${k}` : ""}.svg`), svgs[k]));
      const svg = svgs.length > 1 ? `<div style="display:flex;gap:8px">${svgs.map((s, k) => `<div style="flex:1"><b>${levels[k].name}</b>${s}</div>`).join("")}</div>` : svgs[0];
      const sense = levels.length > 1 ? assessHouseSense(candidate.document) : assessSense(levels[0]);
      const text = [...levels.flatMap((l) => [...(levels.length > 1 ? [`${l.name}:`] : []), ...describePlan(l)]), `sense: ${sense.score}/100`, ...sense.findings.map((f) => `  ✗ ${f.rule}: ${f.message}`)];
      const title = `${c.name} #${i} — ${candidate.variant ?? candidate.arrangement ?? ""}`;
      report.push(`-- ${title}`, ...text, ...candidate.notes.map((n) => `  note: ${n}`), "");
      cards.push(`<figure><figcaption>${title}</figcaption>${svg}<pre>${[...text, ...candidate.notes.map((n) => `note: ${n}`)].join("\n").replace(/</g, "&lt;")}</pre></figure>`);
    });
  }
  writeFileSync(join(OUT, "report.txt"), report.join("\n"));
  writeFileSync(
    join(OUT, "index.html"),
    `<!doctype html><meta charset="utf-8"><title>Generated plans</title><style>body{font:13px sans-serif;margin:16px}figure{display:inline-block;vertical-align:top;margin:0 16px 24px 0;max-width:900px}figcaption{font-weight:600;margin-bottom:4px}svg{max-width:100%;height:auto;display:block}pre{font-size:10px;white-space:pre-wrap}</style>${cards.join("\n")}`,
  );
  console.info(`Wrote ${cards.length} plans to ${OUT}/index.html`);
});
