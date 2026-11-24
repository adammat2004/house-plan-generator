import { expect, test } from "@playwright/test";
import { createHouse, freshEditor, getProject } from "./support";

test("sets the plot, what to leave free and north on Map, says what doesn't fit, and keeps it", async ({ page }) => {
  await freshEditor(page);
  await createHouse(page);
  await page.getByTestId("step-map").click();
  await expect(page.getByTestId("map-panel")).toBeVisible();
  // The first visit asks whether there's a real site to trace; "No site yet" is today's plot form.
  await page.getByTestId("site-mode-dream").click();
  // Typical gaps to start with; the plot itself is optional.
  await expect(page.getByTestId("site-front")).toHaveValue("6");
  await expect(page.getByTestId("site-side")).toHaveValue("1");
  await expect(page.getByTestId("site-rear")).toHaveValue("11");

  await page.getByTestId("rooms-plot-width").fill("15");
  await page.getByTestId("rooms-plot-depth").fill("35");
  await expect(page.getByTestId("site-buildable")).toContainText("13 m wide × 18 m deep");

  // Too narrow for the house: said plainly, in place of the room left.
  await page.getByTestId("rooms-plot-width").fill("9");
  await expect(page.getByTestId("site-issues")).toContainText("The house is 8 m wide; the plot leaves 7 m between the side gaps.");
  await page.getByTestId("rooms-plot-width").fill("15");
  await expect(page.getByTestId("site-issues")).toBeHidden();

  // North, a quarter turn to the right of up, in 15° steps from the keyboard.
  const dial = page.getByTestId("site-north");
  await expect(dial).toHaveAttribute("aria-valuetext", "Not set");
  await dial.focus();
  for (let i = 0; i < 6; i++) await page.keyboard.press("ArrowRight");
  await expect(dial).toHaveAttribute("aria-valuenow", "90");
  await expect(page.getByTestId("site-garden-faces")).toContainText("west");
  await page.waitForTimeout(400);
  await page.screenshot({ path: "test-results/visual/map-site.png" });

  const site = { plot: { width: 15, depth: 35 }, setbacks: { front: 6, side: 1, rear: 11 }, north: 90 };
  expect((await getProject(page)) as unknown as { site: unknown }).toMatchObject({ site });

  // Saved with the project.
  await page.waitForTimeout(800);
  await page.reload();
  await expect(page.getByTestId("plan-canvas")).toBeVisible();
  await expect.poll(async () => ((await getProject(page)) as unknown as { site: unknown }).site).toEqual(site);
});

test("falls back to the plot form when the satellite map can't load, and Continue still works", async ({ page }) => {
  // The map key is blanked for e2e (package.json test:e2e), so "I have a site" always hits this state deterministically.
  await freshEditor(page);
  await createHouse(page);
  await page.getByTestId("step-map").click();
  await page.getByTestId("site-mode-trace").click();
  await expect(page.getByTestId("site-map-failed")).toBeVisible();
  await expect(page.getByTestId("site-map-failed")).toContainText("The map couldn't load.");
  // The plot form underneath still works, with a note explaining why it's there.
  await expect(page.getByTestId("site-map-fallback-note")).toBeVisible();
  await expect(page.getByTestId("rooms-plot-width")).toBeVisible();
  await page.getByTestId("rooms-plot-width").fill("15");
  await page.getByTestId("rooms-plot-depth").fill("35");
  // Continue is primary once there's something to continue with, and still goes to Requirements.
  await expect(page.getByTestId("map-continue")).toHaveClass(/btn-primary/);
  await page.getByTestId("map-continue").click();
  await expect(page.getByTestId("brief-panel")).toBeVisible();
});
