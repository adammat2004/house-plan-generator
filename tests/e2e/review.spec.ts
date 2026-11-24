import { readFileSync } from "node:fs";
import { expect, test } from "@playwright/test";
import { freshHome } from "./support";

/** A PNG's size, from its header. */
const pngSize = (bytes: Buffer) => ({ width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) });

test("sums up the chosen design, its rooms and finishes, and downloads a presentation image", async ({ page }) => {
  await freshHome(page);
  await page.getByTestId("start-rooms").click();
  await page.getByTestId("generate-layouts").click();
  await expect(page.getByTestId("concept-board").locator(".layout-card:not(.is-loading)")).toHaveCount(5);
  await page.getByTestId(/^open-concept-/).first().click();
  await page.getByTestId("step-review").click();

  const panel = page.getByTestId("review-panel");
  await expect(panel).toBeVisible();
  await expect(page.getByTestId("review-facts")).toContainText("3 bed");
  await expect(page.getByTestId("review-style")).toHaveText("Warm minimal interior");
  // Every room with a use shows the floor it's drawn with.
  await expect(page.getByTestId("room-schedule")).toContainText("Herringbone wood");
  await expect(page.getByTestId("room-schedule")).toContainText("Porcelain tile");

  const [download] = await Promise.all([page.waitForEvent("download"), page.getByTestId("review-export-presentation").click()]);
  expect(download.suggestedFilename()).toMatch(/presentation\.png$/);
  await download.saveAs("test-results/visual/presentation.png");
  const size = pngSize(readFileSync((await download.path())!));
  // The longer side about 2400 px, with the title block under the plot.
  expect(Math.max(size.width, size.height)).toBeGreaterThan(1600);
  expect(size.height).toBeGreaterThan(size.width * 0.5);

  // The plain plan image is still there, from the Export menu too.
  await page.getByTestId("export-menu").click();
  await expect(page.getByTestId("export-presentation")).toBeVisible();
});
