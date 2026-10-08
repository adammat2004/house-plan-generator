import { expect, test } from "@playwright/test";
import { serializePlanDocument } from "@/domain/commands";
import { buildSamplePlan } from "../fixtures/samplePlan";
import { clickAt, createHouse, freshEditor, getDoc, level } from "./support";

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
    for (let i = 0; i < 6; i++) await page.mouse.wheel(0, -240);
    await page.waitForTimeout(150);
    await page.screenshot({ path: `${dir}-zoom-in.png` });

    for (let i = 0; i < 12; i++) await page.mouse.wheel(0, 240);
    await page.waitForTimeout(150);
    await page.screenshot({ path: `${dir}-zoom-out.png` });
    expect(errors).toEqual([]);
  });
}
