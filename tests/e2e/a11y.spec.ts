import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Locator, type Page } from "@playwright/test";
import { freshHome } from "./support";

/**
 * WCAG 2.2 AA checks with axe on the main flow, and the same flow by
 * keyboard alone. Only serious and critical findings fail the test.
 */

async function problems(page: Page): Promise<string[]> {
  const { violations } = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"]).analyze();
  return violations
    .filter((v) => v.impact === "serious" || v.impact === "critical")
    .map((v) => `${v.id}: ${v.help} — ${v.nodes.slice(0, 3).map((n) => n.target.join(" ")).join(", ")}`);
}

/** Presses Tab until `target` has focus, as a keyboard user would. */
async function tabTo(page: Page, target: Locator, limit = 60) {
  for (let i = 0; i < limit; i++) {
    if (await target.evaluate((el) => el === document.activeElement)) return;
    await page.keyboard.press("Tab");
  }
  throw new Error(`Couldn't reach ${target} with Tab`);
}

test("Home, Rooms, Layouts and Refine have no serious accessibility problems", async ({ page }) => {
  await freshHome(page);
  expect(await problems(page)).toEqual([]);

  await page.getByTestId("start-rooms").click();
  await expect(page.getByTestId("room-picker")).toBeVisible();
  await page.waitForTimeout(300);
  expect(await problems(page)).toEqual([]);

  await page.getByTestId("generate-layouts").click();
  await expect(page.getByTestId("concept-board").locator(".layout-card")).toHaveCount(3);
  await page.waitForTimeout(700);
  expect(await problems(page)).toEqual([]);

  await page.getByTestId(/^open-concept-/).first().click();
  await expect(page.getByTestId("step-refine")).toHaveAttribute("aria-current", "step");
  await page.waitForTimeout(300);
  expect(await problems(page)).toEqual([]);
});

test("goes from Home to Refine with the keyboard alone", async ({ page }) => {
  await freshHome(page);
  // The skip link comes first, and shows when focused.
  await page.keyboard.press("Tab");
  await expect(page.getByRole("link", { name: "Skip to content" })).toBeFocused();
  await expect(page.getByRole("link", { name: "Skip to content" })).toBeInViewport();

  await tabTo(page, page.getByTestId("start-rooms"));
  await page.keyboard.press("Enter");
  await expect(page.getByTestId("room-picker")).toBeVisible();

  // Counters are buttons named for the room, and say the new count.
  const add = page.getByRole("button", { name: "Add a single bedroom" });
  await tabTo(page, add);
  await page.keyboard.press("Enter");
  await expect(page.getByTestId("pick-single_bedroom-count")).toHaveText("1");
  await tabTo(page, page.getByTestId("generate-layouts"));
  await page.keyboard.press("Enter");

  // Layouts are a radio group: arrows choose, Enter opens Refine.
  const board = page.getByTestId("concept-board");
  await expect(board.locator(".layout-card")).toHaveCount(3);
  // Tab lands on the chosen layout's radio.
  await tabTo(page, board.locator("input[type=radio]:checked"));
  const before = await board.locator("input[type=radio]:checked").getAttribute("aria-label");
  await page.keyboard.press("ArrowRight");
  const after = await board.locator("input[type=radio]:checked").getAttribute("aria-label");
  expect(after).not.toBe(before);
  await page.keyboard.press("Enter");
  await expect(page.getByTestId("step-refine")).toHaveAttribute("aria-current", "step");
});
