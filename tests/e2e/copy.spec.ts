import { expect, test, type Page } from "@playwright/test";
import { freshHome, openRoomPicker } from "./support";

/**
 * The copy rule (DESIGN.md): people read what happened and what to do. No
 * vendor names, keys, setup notes, "coming soon" controls or raw units on
 * any step of a production build, with the AI and photo services switched
 * off as they are here.
 */
const FORBIDDEN = /Claude|Anthropic|Gemini|API[_ ]KEY|\.env|paid call|coming soon|px\/m/i;

async function expectCleanCopy(page: Page, step: string) {
  const text = await page.locator("body").innerText();
  const titles = await page.locator("[title], [aria-label], [data-tooltip], [placeholder]").evaluateAll((els) =>
    els.map((el) => [el.getAttribute("title"), el.getAttribute("aria-label"), el.getAttribute("data-tooltip"), el.getAttribute("placeholder")].filter(Boolean).join(" ")),
  );
  const found = [text, ...titles].join("\n").match(FORBIDDEN);
  expect(found?.[0] ?? null, `${step} shows "${found?.[0]}"`).toBeNull();
}

test("no vendor names or setup notes on any step", async ({ page }) => {
  await freshHome(page);
  await expectCleanCopy(page, "Home");
  for (const path of ["/help", "/settings", "/templates", "/new"]) {
    await page.goto(path);
    await page.waitForTimeout(300);
    await expectCleanCopy(page, path);
  }
  await page.goto("/");
  await page.getByTestId("start-rooms").click();
  await openRoomPicker(page);
  await page.getByTestId("rooms-tab-presets").click();
  await expectCleanCopy(page, "Rooms");
  await page.getByTestId("rooms-tab-rooms").click();

  await page.getByTestId("generate-layouts").click();
  await expect(page.getByTestId("concept-board").locator(".layout-card")).toHaveCount(5);
  await expectCleanCopy(page, "Layouts");
  await page.getByTestId("detail-tab-rooms").click();
  await expectCleanCopy(page, "Layouts, rooms tab");

  await page.getByTestId(/^open-concept-/).click();
  await expect(page.getByTestId("step-refine")).toHaveAttribute("aria-current", "step");
  await expectCleanCopy(page, "Refine");
  // Asking for a change with the AI off: the built-in reader answers, without excuses.
  await page.getByTestId("open-ai").click();
  await page.getByTestId("ai-input").fill("add a utility room");
  await page.getByTestId("ai-send").click();
  await page.waitForTimeout(500);
  await expectCleanCopy(page, "Refine, after asking for a change");

  await page.getByTestId("view-3d").click();
  await expect(page.getByTestId("present-panel")).toBeVisible();
  for (const tab of ["camera", "look", "show"]) {
    await page.getByTestId(`present-tab-${tab}`).click();
    await expectCleanCopy(page, `3D, ${tab}`);
  }
});
