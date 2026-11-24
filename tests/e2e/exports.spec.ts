import { readFileSync } from "node:fs";
import { expect, test, type Page } from "@playwright/test";
import { freshHome } from "./support";

/*
 * Pictures of the plan draw their own look, whatever the view on screen:
 * the plain plan image is always the schematic plan (rooms in their
 * colours), the presentation image always the furnished plan in its garden.
 */

/** The bedroom colour on the schematic plan (--room-bedroom). */
const BEDROOM = [0xf2, 0xcb, 0xbe];

/** How many pixels of a PNG are within a few levels of a colour, counted in the page. */
async function pixelsNear(page: Page, png: Buffer, [r, g, b]: number[]): Promise<number> {
  return page.evaluate(
    async ({ data, r, g, b }) => {
      const image = new Image();
      image.src = `data:image/png;base64,${data}`;
      await image.decode();
      const canvas = document.createElement("canvas");
      canvas.width = image.width;
      canvas.height = image.height;
      const ctx = canvas.getContext("2d")!;
      ctx.drawImage(image, 0, 0);
      const px = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
      let n = 0;
      for (let i = 0; i < px.length; i += 4) if (Math.abs(px[i] - r) <= 3 && Math.abs(px[i + 1] - g) <= 3 && Math.abs(px[i + 2] - b) <= 3) n++;
      return n;
    },
    { data: png.toString("base64"), r, g, b },
  );
}

async function download(page: Page, testId: string): Promise<Buffer> {
  const [file] = await Promise.all([page.waitForEvent("download"), (async () => {
    await page.getByTestId("export-menu").click();
    await page.getByTestId(testId).click();
  })()]);
  return readFileSync((await file.path())!);
}

test("the plain plan image is the schematic plan even when the furnished plan is on screen", async ({ page }) => {
  await freshHome(page);
  await page.getByTestId("start-rooms").click();
  await page.getByTestId("generate-layouts").click();
  await expect(page.getByTestId("concept-board").locator(".layout-card:not(.is-loading)")).toHaveCount(5);
  await page.getByTestId(/^open-concept-/).first().click();

  await page.getByTestId("view-furnished").click();
  const plain = await download(page, "export-png");
  // Bedrooms in their schematic colour: thousands of pixels, where finishes would give none.
  expect(await pixelsNear(page, plain, BEDROOM)).toBeGreaterThan(2000);
  // The view on screen is left as it was.
  await expect(page.getByTestId("view-furnished")).toHaveAttribute("aria-checked", "true");

  await page.getByTestId("view-plan").click();
  const presentation = await download(page, "export-presentation");
  // The presentation is the furnished plan: floors show their finish, not the bedroom colour.
  expect(await pixelsNear(page, presentation, BEDROOM)).toBeLessThan(200);
});

test("downloads the drawing set: a PDF, a DXF plan and an IFC model", async ({ page }) => {
  await freshHome(page);
  await page.getByTestId("start-rooms").click();
  await page.getByTestId("generate-layouts").click();
  await expect(page.getByTestId("concept-board").locator(".layout-card:not(.is-loading)")).toHaveCount(5);
  await page.getByTestId(/^open-concept-/).click();
  for (const [id, ext, magic] of [
    ["export-pdf", ".pdf", "%PDF"],
    ["export-dxf", ".dxf", "0\nSECTION"],
    ["export-ifc", ".ifc", "ISO-10303-21;"],
  ] as const) {
    await page.getByTestId("export-menu").click();
    const [download] = await Promise.all([page.waitForEvent("download", { timeout: 60_000 }), page.getByTestId(id).click()]);
    expect(download.suggestedFilename().endsWith(ext)).toBe(true);
    const path = await download.path();
    const head = readFileSync(path!).subarray(0, 20).toString("latin1");
    expect(head.startsWith(magic)).toBe(true);
  }
});
