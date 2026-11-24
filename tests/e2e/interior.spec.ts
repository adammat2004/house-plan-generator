import { expect, test } from "@playwright/test";
import { freshHome, getDoc, getProject, historySize, level, openRoomPicker, selectRoomFromList } from "./support";

test.describe("Interior finishes and furnishing", () => {
  test("paints a room, furnishes it in a style, and undoes in one step", async ({ page }) => {
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
    await page.screenshot({ path: "test-results/interior/1-before.png" });

    await inspector.getByTestId("paint-sage").click();
    await inspector.getByTestId("finish-boards").click();
    const painted = level(await getDoc(page)).rooms[id] as { wallColour?: string };
    expect(painted.wallColour).toBe("sage");
    await page.waitForTimeout(300);
    await page.screenshot({ path: "test-results/interior/2-painted.png" });

    await inspector.getByTestId("room-tab-furniture").click();
    const before = await historySize(page);
    await inspector.getByTestId("furnish-room-in-style").click();
    await expect(page.getByTestId("furnish-style-dialog")).toBeVisible();
    await page.getByTestId("furnish-style-scandinavian").click();
    await page.screenshot({ path: "test-results/interior/3-dialog.png" });
    await page.getByTestId("furnish-style-confirm").click();
    await expect(page.getByTestId("room-furniture").locator("li")).not.toHaveCount(0);
    expect((await historySize(page)).past).toBe(before.past + 1);
    await page.waitForTimeout(300);
    await page.screenshot({ path: "test-results/interior/4-furnished.png" });

    await page.getByTestId("undo").click();
    expect(Object.keys(level(await getDoc(page)).furniture)).toHaveLength(0);
    expect(errors).toEqual([]);
  });
});
