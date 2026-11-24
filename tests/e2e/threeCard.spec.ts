import { expect, test } from "@playwright/test";
import { clickAt, createHouse, freshEditor } from "./support";

test.describe("The 3D card beside the plan", () => {
  test.beforeEach(async ({ page }) => {
    await freshEditor(page);
  });

  test("shows the house in 3D, folds to a chip while the inspector is open, and opens the 3D view", async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await createHouse(page, { width: "10", depth: "9" });
    const card = page.getByTestId("three-card");
    await expect(card).toBeVisible();
    await expect(card.locator("img")).toHaveAttribute("src", /^data:image\//, { timeout: 10_000 });

    // Picking the room folds the card away for the inspector.
    await clickAt(page, { x: 5, y: 4.5 });
    await expect(page.getByTestId("inspector")).toBeVisible();
    await expect(card).toHaveCount(0);
    await expect(page.getByTestId("three-card-chip")).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(card).toBeVisible();

    await card.click();
    await expect(page.getByTestId("three-view").locator("canvas")).toBeVisible();
    await expect(card).toHaveCount(0);
    expect(errors).toEqual([]);
  });

  test("leaves the card out, quietly, where 3D can't be drawn", async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await createHouse(page, { width: "10", depth: "9" });
    await page.goto(`${page.url()}&webgl=off`);
    await expect(page.getByTestId("plan-canvas")).toBeVisible();
    await page.waitForTimeout(1000);
    await expect(page.getByTestId("three-card")).toHaveCount(0);
    await expect(page.getByTestId("three-card-chip")).toHaveCount(0);
    await expect(page.getByText(/WebGL|couldn.t draw/i)).toHaveCount(0);
    expect(errors).toEqual([]);
  });

  test("puts the house from the garden on the project's card on Home", async ({ page }) => {
    await createHouse(page, { width: "10", depth: "9", name: "Cover house" });
    // The cover is drawn once the plan has stayed the same for a few seconds.
    await page.waitForTimeout(7000);
    await page.getByTestId("home-link").click();
    const card = page.getByTestId("project-card").filter({ hasText: "Cover house" });
    await expect(card.getByTestId("project-cover")).toBeVisible({ timeout: 10_000 });
    await expect(card.getByTestId("project-cover")).toHaveAttribute("src", /^blob:/);
  });
});
