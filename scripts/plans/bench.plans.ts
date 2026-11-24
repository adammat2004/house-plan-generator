import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { it } from "vitest";
import { runScenario, summarise } from "@/domain/design/eval/benchmark";
import { BENCH_SCENARIOS } from "../../tests/fixtures/benchScenarios";

/**
 * `npm run plans:bench`: plans every benchmark scenario and writes
 * `bench.json` (the summaries, as snapshotted by tests/design/bench.test.ts,
 * plus every plan's metrics) and `bench.txt` (a table to read or diff).
 * BENCH_OUT picks the folder (default test-results/bench) and BENCH_COUNT
 * how many layouts per scenario (default 3, as the editor shows), so a
 * planner change can be compared with `BENCH_OUT=test-results/bench-before`.
 */

const OUT = process.env.BENCH_OUT ?? "test-results/bench";
const COUNT = Number(process.env.BENCH_COUNT ?? 3);
const pct = (x: number) => `${(x * 100).toFixed(1)}%`;

it("benchmarks the planners", () => {
  mkdirSync(OUT, { recursive: true });
  const json: unknown[] = [];
  const lines: string[] = [];
  for (const s of BENCH_SCENARIOS) {
    const t0 = performance.now();
    const run = runScenario(s, COUNT);
    const ms = Math.round(performance.now() - t0);
    const summary = summarise(s.name, run);
    json.push({ ...summary, ms, plans: run.candidates.map((c) => ({ arrangement: c.arrangement, score: c.score, findings: c.findings, metrics: c.metrics })) });
    lines.push(
      `## ${s.name}  (${ms} ms)${summary.issue ? `  issue: ${summary.issue}` : ""}`,
      `   ideas ${summary.ideas}/${summary.candidates}  pairs: ${summary.pairs.distinct} distinct, ${summary.pairs.sameIdea} same idea, ${summary.pairs.identical} identical  graph ${summary.meanGraphDistance}  spatial ${summary.meanSpatialDistance}`,
    );
    for (const c of run.candidates) {
      const g = c.metrics.levels[0];
      const d = c.metrics.descriptor;
      lines.push(
        `   ${c.arrangement}`,
        `     sense ${c.score}${c.findings.length ? ` (${c.findings.join(", ")})` : ""}  hall ${pct(c.metrics.hallShare)}  circulation ${pct(c.metrics.circulationShare)}  hall/door ${g.hallPerDoor.toFixed(1)} m²  depth ${g.meanDepth.toFixed(1)}/${g.maxDepth}  privacy ${g.privacyGradient.toFixed(1)}  furniture missing ${c.metrics.furnitureMissing}`,
        `     idea: entry ${d.entry}, ${d.openGroup}, master ${d.masterPos}, kitchen ${d.kitchenPos}, garden from ${d.gardenRoom}, hall ${d.hall}`,
        `     halls: entrance ${pct(c.metrics.hallByKind.entry)}  corridor ${pct(c.metrics.hallByKind.corridor)}  landing ${pct(c.metrics.hallByKind.landing)}  central ${pct(c.metrics.hallByKind.hub)}`,
      );
    }
    lines.push("");
  }
  writeFileSync(join(OUT, "bench.json"), JSON.stringify(json, null, 2));
  writeFileSync(join(OUT, "bench.txt"), lines.join("\n"));
  console.info(`Wrote ${BENCH_SCENARIOS.length} scenarios to ${OUT}/bench.txt`);
});
