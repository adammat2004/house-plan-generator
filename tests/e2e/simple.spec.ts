import { expect, test, type Page } from "@playwright/test";
import type { PlanDocument } from "@/domain/plan/types";
import { getDoc, historySize } from "./support";

const levelOf = (doc: unknown) => (doc as PlanDocument).levels[0];

/** Home → layouts → Refine, in Simple mode (the default for new people). */
async function openSimpleRefine(page: Page) {
  await page.goto("/");
  await page.evaluate(
    () =>
      new Promise<void>((resolve) => {
        localStorage.clear();
        const req = indexedDB.deleteDatabase("floor-plan-editor");
        req.onsuccess = req.onerror = req.onblocked = () => resolve();
      }),
  );
  await page.reload();
  await page.getByTestId("start-rooms").click();
  await page.getByTestId("generate-layouts").click();
  await expect(
    page.getByTestId("concept-board").locator(".layout-card:not(.is-loading)"),
  ).toHaveCount(5);
  await page
    .getByTestId(/^open-concept-/)
    .first()
    .click();
  await expect(page.getByTestId("step-refine")).toHaveAttribute(
    "aria-current",
    "step",
  );
}

/** Clicks a bedroom on the plan, trying a few spots in case furniture sits on the first. */
async function pickBedroom(page: Page) {
  const level = levelOf(await getDoc(page));
  const room =
    Object.values(level.rooms).find((r) => r.type === "bedroom") ??
    Object.values(level.rooms)[0];
  for (const [dx, dy] of [
    [0, 0],
    [0.6, 0.6],
    [-0.6, 0.6],
    [0.6, -0.6],
    [-0.6, -0.6],
  ]) {
    const c = await page.evaluate(
      (id) => window.__floorPlanEditor!.roomCentre(id),
      room.id,
    );
    const box = (await page.getByTestId("plan-canvas").boundingBox())!;
    await page.mouse.click(box.x + c!.x + dx * 40, box.y + c!.y + dy * 40);
    await page.waitForTimeout(100);
    if (await page.getByTestId("simple-room-name").isVisible()) return room.id;
  }
  throw new Error("Could not select a room");
}

test("Refine starts in Simple mode with big, friendly room actions, all undoable", async ({
  page,
}) => {
  await openSimpleRefine(page);
  await expect(page.getByTestId("mode-simple")).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await expect(page.getByTestId("simple-panel")).toContainText("Click a room");
  // The drawing tools stay out of the way.
  await expect(page.getByTestId("tool-more")).toHaveCount(0);

  const roomId = await pickBedroom(page);
  const rooms = () =>
    page.evaluate(
      async () =>
        (
          window.__floorPlanEditor!.getDocument() as {
            levels: Array<{
              rooms: Record<string, { name: string; type: string }>;
            }>;
          }
        ).levels[0].rooms,
    );

  const before = (await historySize(page)).past;
  await page.getByTestId("simple-room-name").fill("Guest room");
  await page.getByTestId("simple-room-name").press("Enter");
  await expect
    .poll(async () => (await rooms())[roomId].name)
    .toBe("Guest room");

  await page.getByTestId("simple-room-type").selectOption("dining");
  await expect.poll(async () => (await rooms())[roomId].type).toBe("dining");

  const openings = async () =>
    Object.keys(levelOf(await getDoc(page)).openings).length;
  const doors = await openings();
  await page.getByTestId("simple-add-window").click();
  await expect.poll(openings).toBe(doors + 1);
  await page.getByTestId("simple-remove-window").click();
  await expect.poll(openings).toBe(doors);

  await page.getByTestId("simple-bigger").click();
  expect((await historySize(page)).past).toBeGreaterThan(before);

  await page.getByTestId("simple-swap").click();
  await page.getByRole("menuitem").first().click();

  await page.keyboard.press(
    process.platform === "darwin" ? "Meta+z" : "Control+z",
  );
  await page.waitForTimeout(100);
  await page.mouse.move(0, 0);
  await page.screenshot({ path: "test-results/visual/refine-simple.png" });
});

test("Advanced brings back the full editor, and the choice is remembered", async ({
  page,
}) => {
  await openSimpleRefine(page);
  await page.getByTestId("mode-advanced").click();
  await expect(page.getByTestId("simple-panel")).toHaveCount(0);
  await expect(page.getByTestId("tool-more")).toBeVisible();
  await page.screenshot({ path: "test-results/visual/refine-advanced.png" });
  await page.reload();
  expect(
    await page.evaluate(() => localStorage.getItem("homedesign.refine.mode")),
  ).toBe("advanced");
  await page.getByTestId("step-refine").click();
  await expect(page.getByTestId("mode-advanced")).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await page.getByTestId("mode-simple").click();
  await expect(page.getByTestId("simple-panel")).toBeVisible();
});
