import { expect, test, type Page } from "@playwright/test";
import { freshHome, getDoc, openRoomPicker } from "./support";

/**
 * A touch-only phone (the "phone" project: 390 × 844, touch). Rooms and
 * Layouts work in one column; Refine and 3D are read-only, with "Send to my
 * computer" to carry on editing elsewhere.
 */

/** Captures what would go to the share sheet instead of opening one. */
async function stubShare(page: Page) {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "share", {
      configurable: true,
      value: async (data: ShareData) => {
        (window as unknown as { __shared: string | undefined }).__shared = data.url;
      },
    });
  });
}

const shared = (page: Page) => page.waitForFunction(() => (window as unknown as { __shared?: string }).__shared).then((h) => h.jsonValue() as Promise<string>);

test("picks rooms and compares layouts on a phone, then sends one to a computer", async ({ page, browser }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await stubShare(page);
  await freshHome(page);
  expect(await page.evaluate(() => matchMedia("(pointer: coarse)").matches && !matchMedia("(any-pointer: fine)").matches)).toBe(true);

  // Rooms: the plan above the list, nothing wider than the screen, counters that work by touch.
  await page.getByTestId("start-rooms").tap();
  await openRoomPicker(page);
  await expect(page.getByTestId("compact-stepper")).toContainText("Step 2 of 5");
  const preview = (await page.locator(".rooms-preview").boundingBox())!;
  const list = (await page.getByTestId("room-picker").boundingBox())!;
  expect(preview.y + preview.height).toBeLessThanOrEqual(list.y + 1);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  await page.getByTestId("pick-single_bedroom-inc").tap();
  await expect(page.getByTestId("rooms-preview-facts")).toContainText("4 bed");
  await page.waitForTimeout(400);
  await page.screenshot({ path: "test-results/visual/screens/phone-rooms.png" });

  // Layouts: one column of cards, and a sheet for the chosen one.
  await page.getByTestId("generate-layouts").tap();
  const board = page.getByTestId("concept-board");
  await expect(board.locator(".layout-card")).toHaveCount(5);
  const [a, b] = await Promise.all([board.getByTestId("concept-Plan A").boundingBox(), board.getByTestId("concept-Plan B").boundingBox()]);
  expect(b!.y).toBeGreaterThan(a!.y + a!.height - 1);
  const sheet = page.getByTestId("concept-detail");
  await expect(sheet.getByTestId("send-to-computer")).toBeVisible();
  await expect(sheet.getByTestId("detail-tab-rooms")).toBeHidden();
  await sheet.getByTestId("layout-sheet-toggle").tap();
  await expect(sheet.getByTestId("detail-tab-rooms")).toBeVisible();
  await sheet.getByTestId("layout-sheet-toggle").tap();
  await board.getByTestId("concept-Plan B").tap();
  await expect(sheet).toContainText("Layout B");

  await page.screenshot({ path: "test-results/visual/screens/phone-layouts.png" });

  // Refine is read-only: the plan alone, and nothing changes it.
  await sheet.getByTestId("open-concept-Plan B").tap();
  await expect(page.getByTestId("read-only-note")).toBeVisible();
  await expect(page.getByTestId("tool-wall")).toBeHidden();
  await expect(page.getByTestId("undo")).toHaveCount(0);
  const before = JSON.stringify(await getDoc(page));
  const canvas = (await page.getByTestId("plan-canvas").boundingBox())!;
  const centre = { x: canvas.x + canvas.width / 2, y: canvas.y + canvas.height / 2 };
  await page.mouse.move(centre.x, centre.y);
  await page.mouse.down();
  await page.mouse.move(centre.x + 60, centre.y + 40, { steps: 6 });
  await page.mouse.up();
  await page.keyboard.press("Delete");
  await page.keyboard.press("ControlOrMeta+z");
  await page.keyboard.press("w");
  expect(JSON.stringify(await getDoc(page))).toBe(before);
  expect(await page.evaluate(() => (window.__floorPlanEditor!.getSession() as { tool: string }).tool)).toBe("select");
  await page.screenshot({ path: "test-results/visual/screens/phone-refine.png" });

  // Send to my computer: the link opens exactly this layout in Refine on a desktop.
  await page.getByTestId("read-only-note").getByTestId("send-to-computer").tap();
  const url = await shared(page);
  expect(url).toMatch(/\/start#[A-Za-z0-9_-]+$/);
  const phonePlan = await getDoc(page);

  const desktop = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const computer = await desktop.newPage();
  computer.on("pageerror", (e) => errors.push(e.message));
  // This check is about the layout arriving editable; Simple mode has no wall tool.
  await computer.addInitScript(() => localStorage.setItem("homedesign.refine.mode", "advanced"));
  await computer.goto(url);
  await expect(computer.getByTestId("step-refine")).toHaveAttribute("aria-current", "step");
  expect(computer.url()).not.toContain("/start");
  expect(JSON.stringify((await getDoc(computer)).levels)).toBe(JSON.stringify(phonePlan.levels));
  await expect(computer.getByTestId("tool-wall")).toBeVisible();
  const opened = computer.url();

  // Opening the same link again reopens that project rather than making a copy.
  await computer.goto(url);
  await expect(computer.getByTestId("step-refine")).toHaveAttribute("aria-current", "step");
  expect(computer.url()).toBe(opened);
  await computer.goto("/projects");
  await expect(computer.getByTestId("project-card")).toHaveCount(1);
  await desktop.close();
  expect(errors).toEqual([]);
});

test("turns a damaged link away kindly", async ({ page }) => {
  await page.goto("/start#not-a-real-layout");
  await expect(page.getByTestId("start-failed")).toBeVisible();
  await expect(page.getByTestId("start-rooms")).toBeVisible();
});
