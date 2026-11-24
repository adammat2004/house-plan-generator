import { expect, test, type Page } from "@playwright/test";
import { freshHome, openRoomPicker } from "./support";

/**
 * Pixel baselines for the main flow: Home, Requirements, Explore, Refine (furnished and in 3D), Review and Map at
 * laptop, desktop and phone widths. They're Linux screenshots taken in the
 * Playwright Docker image, so they only run there (`npm run test:screens`;
 * after an intended change, `npm run test:screens:update` and commit the
 * new images). Anything that changes by itself is hidden by screens.css: the
 * save time and the WebGL pictures (the 3D view is checked separately for
 * being drawn).
 */

test.skip(!process.env.PLAYWRIGHT_DOCKER, "Pixel baselines run in the Playwright Docker image: npm run test:screens");


async function settle(page: Page) {
  await page.waitForLoadState("networkidle");
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(500);
}

/** The 3D picture was drawn: a blank canvas compresses to almost nothing. */
async function expectDrawn(page: Page) {
  const shot = await page.getByTestId("three-view").locator("canvas").screenshot();
  expect(shot.length).toBeGreaterThan(20_000);
}

async function mainFlow(page: Page, name: string, phone = false) {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await freshHome(page);
  await settle(page);
  await expect(page).toHaveScreenshot(`${name}-home.png`);

  await page.getByTestId("start-rooms").click();
  await openRoomPicker(page);
  await settle(page);
  await expect(page).toHaveScreenshot(`${name}-rooms.png`);

  await page.getByTestId("generate-layouts").click();
  await expect(page.getByTestId("concept-board").locator(".layout-card")).toHaveCount(5);
  await settle(page);
  await expect(page).toHaveScreenshot(`${name}-layouts.png`);

  await page.getByTestId(/^open-concept-/).click();
  await expect(page.getByTestId("step-refine")).toHaveAttribute("aria-current", "step");
  await settle(page);
  await expect(page).toHaveScreenshot(`${name}-refine.png`);

  await page.getByTestId("view-3d").click();
  await expect(page.getByTestId("three-view").locator("canvas")).toBeVisible();
  await page.waitForTimeout(1500);
  await expectDrawn(page);
  await page.mouse.move(0, 0);
  await expect(page).toHaveScreenshot(`${name}-3d.png`);
  await page.getByTestId("view-furnished").click();

  const goTo = async (step: string) => {
    if (phone) {
      await page.getByTestId("compact-stepper").click();
      await page.getByTestId(`compact-step-${step}`).click();
    } else await page.getByTestId(`step-${step}`).click();
  };
  await goTo("review");
  await expect(page.getByTestId("review-panel")).toBeVisible();
  await settle(page);
  await expect(page).toHaveScreenshot(`${name}-review.png`);

  await goTo("map");
  await expect(page.getByTestId("map-panel")).toBeVisible();
  await settle(page);
  await expect(page).toHaveScreenshot(`${name}-map.png`);
}

for (const size of [
  { name: "1280", width: 1280, height: 800 },
  { name: "1440", width: 1440, height: 900 },
]) {
  test(`looks as approved at ${size.name}`, async ({ page }) => {
    await page.setViewportSize(size);
    await mainFlow(page, size.name);
  });
}

test.describe("on a phone", () => {
  test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  test("looks as approved at 390", async ({ page }) => {
    await mainFlow(page, "390", true);
  });
});
