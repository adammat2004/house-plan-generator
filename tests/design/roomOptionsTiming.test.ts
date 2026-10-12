import { describe, expect, it } from "vitest";
import { DEFAULT_BRIEF } from "@/domain/brief/schema";
import { suggestedGoals } from "@/domain/design/intent";
import { planLayouts } from "@/domain/design/stripPlanner";
import { apply, level, newHouse } from "../helpers";

const withRear = () => apply(newHouse(10, 12), { type: "setRearWall", wallId: level(newHouse(10, 12)).envelope.wallIds[2] });

describe("room options, timed", () => {
  it("plans each suggested goal for every room of a generated three-bed plan quickly enough to run between frames", () => {
    const docs = planLayouts({ intent: { action: "generate_layouts", brief: DEFAULT_BRIEF, count: 3 }, source: withRear(), brief: DEFAULT_BRIEF, idPrefix: "t" }).candidates.map((c) => c.document);
    const times: number[] = [];
    for (const doc of docs) {
      for (const room of Object.values(level(doc).rooms)) {
        for (const goal of suggestedGoals(room.type)) {
          const t0 = performance.now();
          planLayouts({ intent: { action: "redesign_room", roomId: room.id, goals: [goal] }, source: doc, brief: DEFAULT_BRIEF, idPrefix: "r" });
          times.push(performance.now() - t0);
        }
      }
    }
    times.sort((a, b) => a - b);
    const p95 = times[Math.floor(times.length * 0.95)];
    console.info(`room goal: median ${times[Math.floor(times.length / 2)].toFixed(1)} ms, p95 ${p95.toFixed(1)} ms, max ${times[times.length - 1].toFixed(1)} ms over ${times.length}`);
    expect(times.length).toBeGreaterThan(20);
    // The inspector plans these in idle moments on the main thread (state/roomOptions.ts); past this they'd need a worker.
    expect(p95).toBeLessThan(60);
  });
});
