import { expect, test } from "@playwright/test";
import { freshHome, getDoc, getProject, level, openRoomPicker, selectRoomFromList } from "./support";

test("a room furnished in its own style shows in 2D with a floor tint, and in 3D", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await freshHome(page);
  await page.getByTestId("start-rooms").click();
  await openRoomPicker(page);
  await page.getByTestId("generate-layouts").click();
  await expect(page.getByTestId("concept-board").locator(".layout-card:not(.is-loading)")).toHaveCount(5);
  const plan = (await getProject(page)).plans[1];
  await page.getByTestId("concept-board").getByTestId(`concept-${plan.label}`).click();
  await page.getByTestId(`open-concept-${plan.label}`).click();
  await page.waitForTimeout(300);
  await page.getByTestId("tool-more").click();
  await page.getByTestId("clear-furniture").click();

  const rooms = Object.entries(level(await getDoc(page)).rooms) as [string, { name: string; type: string }][];
  const [id, room] = rooms.find(([, r]) => r.type === "living") ?? rooms[0];
  await selectRoomFromList(page, room.name);
  const inspector = page.getByTestId("inspector");
  await inspector.getByTestId("finish-tile").click();
  await inspector.getByTestId("room-tab-furniture").click();
  await inspector.getByTestId("furnish-room-in-style").click();
  await page.getByTestId("furnish-style-coastal").click();
  await page.getByTestId("furnish-style-confirm").click();
  await expect(page.getByTestId("room-furniture").locator("li")).not.toHaveCount(0);
  const own = level(await getDoc(page)).rooms[id] as { interiorStyle?: string; floorMaterial?: string };
  expect(own).toMatchObject({ interiorStyle: "coastal", floorMaterial: "tile" });

  await page.getByTestId("view-furnished").click();
  await expect.poll(() => page.evaluate(() => window.__floorPlanEditor!.planSprites())).toBeGreaterThan(0);
  await page.waitForTimeout(400);
  await page.screenshot({ path: "test-results/interior/5-room-style-2d.png" });

  await page.keyboard.press("Shift+Digit2");
  await expect(page.getByTestId("three-view").locator("canvas")).toBeVisible();
  await page.getByTestId("present-tab-show").click();
  const stats = await page.evaluate(() => window.__floorPlanEditor!.furniture3d());
  expect(stats!.models).toBeGreaterThan(0);
  await page.getByTestId("display-cutaway").click();
  await page.waitForTimeout(1500);
  await page.screenshot({ path: "test-results/interior/6-room-style-3d.png" });
  expect(errors).toEqual([]);
});
