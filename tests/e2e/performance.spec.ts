import { expect, test } from "@playwright/test";
import { serializePlanDocument } from "@/domain/commands";
import { buildLargePlan } from "../fixtures/largePlan";
import { createHouse, freshEditor, getDoc, historySize, level, toScreen } from "./support";

test("stays responsive while dragging a wall in a 100-wall plan", async ({ page }) => {
  await freshEditor(page);
  await createHouse(page);
  const plan = buildLargePlan();
  await page.getByTestId("import-file-input").setInputFiles({
    name: "large.json",
    mimeType: "application/json",
    buffer: Buffer.from(serializePlanDocument(plan)),
  });
  await expect(page.getByTestId("notice")).toContainText("Opened");
  expect(Object.keys(level(await getDoc(page)).walls).length).toBeGreaterThanOrEqual(100);
  await page.waitForTimeout(400);

  // Vertical wall chain at x = 3 m; grab it clear of its doors (which sit 1.0–1.8 m along each segment).
  const from = await toScreen(page, { x: 3, y: 2.5 });
  // Drag 1.2 m whatever the fitted zoom, so the chain stays within the range checked below.
  const to = await toScreen(page, { x: 4.2, y: 2.5 });
  const before = await historySize(page);
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  const t0 = Date.now();
  const steps = 30;
  for (let i = 1; i <= steps; i++) {
    await page.mouse.move(from.x + ((to.x - from.x) * i) / steps, from.y);
  }
  // Wait for the last animation frame to render.
  await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
  const elapsed = Date.now() - t0;
  await page.mouse.up();
  const moved = await getDoc(page);
  const chainVertex = Object.values(level(moved).vertices).filter((p) => Math.abs(p.y - 0.15) < 1e-6 && p.x > 2.5 && p.x < 4.5);
  expect(chainVertex.some((p) => p.x > 3.05)).toBe(true);
  const perMove = elapsed / steps;
  console.info(`100-wall drag: ${perMove.toFixed(1)} ms per pointer move`);
<<<<<<< HEAD
  // A wall-clock budget: main itself measures 52-62 ms on shared CI runners and ~90 ms here, so 50 only tracked runner speed.
  expect(perMove).toBeLessThan(100);
=======
  // Wall-clock on a software-rendered runner: 50-75 ms across CI machines, so this catches order-of-magnitude regressions only.
  expect(perMove).toBeLessThan(150);
>>>>>>> origin/main
  expect((await historySize(page)).past).toBe(before.past + 1);
  await page.screenshot({ path: "test-results/large-plan.png" });
});
