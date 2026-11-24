import { readFileSync } from "node:fs";
import { expect, test } from "@playwright/test";
import { freshHome } from "./support";

test.describe("Exterior gallery and elevations", () => {
  test.beforeEach(async ({ page }) => {
    await freshHome(page);
    await page.getByTestId("template-card").first().click();
    await expect(page.getByTestId("plan-canvas")).toBeVisible();
    await page.getByTestId("view-3d").click();
    await expect(page.getByTestId("present-tab-elevations")).toBeVisible();
  });

  test("the Elevations tab draws all four sides and downloads the drawings", async ({ page }) => {
    await page.getByTestId("present-tab-elevations").click();
    await expect(page.getByTestId("elevations-view")).toBeVisible();
    await expect(page.getByTestId("elevation")).toHaveCount(4);
    await expect(page.getByTestId("elevation").first().locator("rect.elevation-window, rect.elevation-door").first()).toBeVisible();
    const download = page.waitForEvent("download");
    await page.getByTestId("elevations-download").click();
    expect((await download).suggestedFilename()).toMatch(/\.pdf$/);
    await page.getByTestId("present-tab-3d").click();
    await expect(page.getByTestId("elevations-view")).toBeHidden();
  });

  test("the Gallery tab renders each angle by day or dusk, keeping the 3D view where a render fails", async ({ page }) => {
    // A stand-in for the Gemini route: tests never make paid calls. Dusk views fail.
    const photo = readFileSync("tests/fixtures/room-render.jpg").toString("base64");
    const requests: Array<{ angle?: string; light?: string }> = [];
    await page.route("**/api/design/render", (route) => {
      if (route.request().method() === "GET") return route.fulfill({ json: { available: true, model: "test-model" } });
      const view = route.request().postDataJSON().view;
      requests.push({ angle: view.angle, light: view.light });
      return view.light === "dusk" ? route.fulfill({ status: 502, json: { error: "The model is busy." } }) : route.fulfill({ json: { image: photo, mimeType: "image/jpeg", model: "test-model" } });
    });
    await page.getByTestId("present-tab-gallery").click();
    const tiles = page.getByTestId("gallery-tile");
    await expect(tiles).toHaveCount(3);
    await expect(tiles.first()).toHaveAttribute("data-kind", "still", { timeout: 15000 });

    await page.getByTestId("gallery-render-all").click();
    await expect(tiles.first()).toHaveAttribute("data-kind", "photo", { timeout: 15000 });
    await expect(tiles.nth(1)).toHaveAttribute("data-kind", "photo");
    await expect(tiles.nth(2)).toHaveAttribute("data-kind", "photo");
    expect(requests.map((r) => r.angle ?? "front").sort()).toEqual(["aerial", "front", "rear"]);

    await page.getByTestId("gallery-light-dusk").click();
    await expect(tiles.first()).toHaveAttribute("data-view", "exterior:front:dusk");
    await page.getByTestId("gallery-render-all").click();
    await expect(page.getByTestId("gallery-error")).toBeVisible({ timeout: 15000 });
    await expect(tiles.first()).toHaveAttribute("data-kind", "still");
    await expect(tiles.first().locator("img")).toBeVisible();
  });
});
