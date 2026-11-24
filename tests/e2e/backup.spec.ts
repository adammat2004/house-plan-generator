import { expect, test } from "@playwright/test";
import { freshHome } from "./support";

test.describe("Backups and save status", () => {
  test.beforeEach(async ({ page }) => {
    await freshHome(page);
  });

  test("a downloaded backup opens again as a project, and a bad file gets a friendly error", async ({ page }) => {
    await page.getByTestId("template-card").first().click();
    await expect(page.getByTestId("plan-canvas")).toBeVisible();
    await expect(page.getByTestId("save-status")).toContainText("Saved on this device", { timeout: 5000 });
    await page.getByTestId("home-link").click();

    await page.getByTestId("project-card").first().getByLabel(/Actions for/).click();
    const download = page.waitForEvent("download");
    await page.getByRole("menuitem", { name: /Download backup/ }).click();
    const path = await (await download).path();

    await page.goto("/projects");
    await page.getByTestId("open-backup-input").setInputFiles({ name: "bad.json", mimeType: "application/json", buffer: Buffer.from("{ nope") });
    await expect(page.getByTestId("open-backup-error")).toContainText("isn't a HomeDesign backup");

    await page.getByTestId("open-backup-input").setInputFiles(path!);
    await expect(page.getByTestId("plan-canvas")).toBeVisible();
    await page.getByTestId("home-link").click();
    await page.goto("/projects");
    await expect(page.getByTestId("project-card")).toHaveCount(2);
  });

  test("shows a dismissible backup reminder once enough work is unbacked-up", async ({ page }) => {
    await page.evaluate(() =>
      localStorage.setItem("floorplan-backup-reminder", JSON.stringify({ edits: 100, dirtySince: 1, lastBackupAt: null, snoozedUntil: 0 })),
    );
    await page.getByTestId("template-card").first().click();
    await expect(page.getByTestId("plan-canvas")).toBeVisible();
    await expect(page.getByTestId("backup-reminder")).toBeVisible({ timeout: 5000 });
    await page.getByTestId("backup-reminder-dismiss").click();
    await expect(page.getByTestId("backup-reminder")).toBeHidden();
  });
});
