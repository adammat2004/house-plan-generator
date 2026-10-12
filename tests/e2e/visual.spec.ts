import { expect, test } from "@playwright/test";
import { serializePlanDocument } from "@/domain/commands";
import { buildSamplePlan } from "../fixtures/samplePlan";
import { clickAt, createHouse, freshEditor, freshHome, getDoc, level } from "./support";

/**
 * Captures the real UI at several desktop sizes and zoom levels for visual
 * review (written to test-results/visual). Fails on console errors.
 */
for (const size of [
  { width: 1280, height: 800 },
  { width: 1440, height: 900 },
  { width: 1920, height: 1080 },
]) {
  test(`renders a furnished plan at ${size.width}×${size.height}`, async ({ page }) => {
    const errors: string[] = [];
    page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
    page.on("pageerror", (e) => errors.push(e.message));
    await page.setViewportSize(size);
    await freshEditor(page);
    await createHouse(page);
    await page.getByTestId("import-file-input").setInputFiles({
      name: "sample.json",
      mimeType: "application/json",
      buffer: Buffer.from(serializePlanDocument(buildSamplePlan())),
    });
    await expect(page.getByTestId("notice")).toContainText("Opened");
    await page.getByRole("button", { name: "Dismiss" }).click();
    expect(Object.keys(level(await getDoc(page)).rooms)).toHaveLength(6);
    const dir = `test-results/visual/${size.width}x${size.height}`;
    await page.screenshot({ path: `${dir}-fit.png` });

    await clickAt(page, { x: 4.2, y: 2 });
    await page.screenshot({ path: `${dir}-wall-selected.png` });

    const canvas = (await page.getByTestId("plan-canvas").boundingBox())!;
    await page.mouse.move(canvas.x + canvas.width * 0.4, canvas.y + canvas.height * 0.55);
    await page.keyboard.down("Control");
    for (let i = 0; i < 6; i++) await page.mouse.wheel(0, -240);
    await page.waitForTimeout(150);
    await page.screenshot({ path: `${dir}-zoom-in.png` });

    for (let i = 0; i < 12; i++) await page.mouse.wheel(0, 240);
    await page.keyboard.up("Control");
    await page.waitForTimeout(150);
    await page.screenshot({ path: `${dir}-zoom-out.png` });
    expect(errors).toEqual([]);
  });
}

/**
 * Captures each step of the main flow (Home, Rooms, Layouts, Refine, 3D),
 * plus Help and Settings, at laptop, desktop and phone widths to
 * test-results/visual/screens, for before/after review of the premium pass. Nothing here asserts on pixels:
 * every PR in the pass changes them on purpose. Steps that can't be reached
 * at a size are skipped, so the capture never blocks the suite.
 */
for (const size of [
  { width: 1280, height: 800, name: "1280" },
  { width: 1440, height: 900, name: "1440" },
  { width: 390, height: 844, name: "390" },
]) {
  test(`captures the main flow at ${size.name}`, async ({ page }) => {
    test.setTimeout(120_000);
    // A blocked click (e.g. chrome overlapping a control) skips the step instead of hanging.
    page.setDefaultTimeout(10_000);
    await page.setViewportSize({ width: size.width, height: size.height });
    const shot = (screen: string) => page.screenshot({ path: `test-results/visual/screens/${size.name}-${screen}.png` });
    const step = async (screen: string, go: () => Promise<void>) => {
      try {
        await go();
        await page.waitForTimeout(600);
        await shot(screen);
        return true;
      } catch {
        return false;
      }
    };

    await freshHome(page);
    await shot("home");
    for (const screen of ["help", "settings"]) {
      await page.goto(`/${screen}`);
      await page.waitForTimeout(400);
      await shot(screen);
    }
    await page.goto("/");
    await expect(page.getByTestId("start-rooms")).toBeVisible();
    if (!(await step("rooms", async () => {
      await page.getByTestId("start-rooms").click();
      await expect(page.getByTestId("room-picker")).toBeVisible();
    }))) return;
    if (!(await step("layouts", async () => {
      await page.getByTestId("generate-layouts").click();
      await expect(page.getByTestId("concept-board")).toBeVisible({ timeout: 15_000 });
    }))) return;
    if (!(await step("refine", async () => {
      await page.getByTestId(/^open-concept-/).first().click();
      await expect(page.getByTestId("plan-canvas")).toBeVisible();
    }))) return;
    await step("3d", async () => {
      await page.getByTestId("view-3d").click();
      await expect(page.getByTestId("three-view").locator("canvas")).toBeVisible({ timeout: 15_000 });
      await page.waitForTimeout(1500);
    });
  });
}
