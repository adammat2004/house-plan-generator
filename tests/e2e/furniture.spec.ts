import { expect, test } from "@playwright/test";
import { AXIS, clickAt, createHouse, drag, drawWall, freshEditor, getDoc, historySize, level } from "./support";

const furniture = async (page: Parameters<typeof getDoc>[0]) => Object.values(level(await getDoc(page)).furniture);

test.describe("Furniture", () => {
  test.beforeEach(async ({ page }) => {
    await freshEditor(page);
  });

  test("places, turns, drags and lays out furniture in Designs, and shows it in 3D", async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await createHouse(page);
    await drawWall(page, { x: 4, y: AXIS.south }, { x: 4, y: AXIS.north });

    // The Furniture tool works in Refine, showing the furnished view, with the catalog beside the plan.
    await page.keyboard.press("4");
    await page.keyboard.press("u");
    await expect(page.getByTestId("tool-furniture")).toHaveAttribute("aria-pressed", "true");
    const catalog = page.getByTestId("furniture-catalog");
    await expect(catalog).toBeVisible();
    await catalog.getByTestId("catalog-bedroom").click();
    await catalog.getByTestId("catalog-item-bed_double").click();

    // Near the north wall the bed turns its head to the wall and sits flush, centred.
    // (Clicked within the 0.4 m wall reach, which holds at any zoom.)
    await clickAt(page, { x: 2.1, y: 8.9 });
    let items = await furniture(page);
    expect(items).toHaveLength(1);
    const bed = items[0];
    expect(bed).toMatchObject({ kind: "bed_double", rotation: 0 });
    expect(bed.position.y).toBeCloseTo(9.7 - 2.05 / 2, 3);
    expect(bed.position.x).toBeCloseTo((0.3 + 3.95) / 2, 3);
    const inspector = page.getByTestId("inspector");
    await expect(inspector.getByRole("heading", { name: "Double bed" })).toBeVisible();

    // Shift+R turns it; undo turns it back.
    await page.keyboard.press("Shift+R");
    expect((await furniture(page))[0].rotation).toBe(270);
    await page.getByTestId("undo").click();
    expect((await furniture(page))[0].rotation).toBe(0);

    // Dragging is one history entry.
    await page.getByTestId("tool-select").click();
    const before = await historySize(page);
    await drag(page, bed.position, { x: bed.position.x, y: 5 });
    items = await furniture(page);
    expect(items[0].position.y).toBeLessThan(bed.position.y - 2);
    expect((await historySize(page)).past).toBe(before.past + 1);

    // The room's own layout: make it a bedroom and furnish it.
    await page.keyboard.press("Escape");
    await clickAt(page, { x: 1, y: 1 });
    await inspector.getByTestId("room-type").selectOption("bedroom");
    await inspector.getByTestId("room-tab-furniture").click();
    await inspector.getByTestId("furnish-room").click();
    items = await furniture(page);
    expect(items.filter((f) => f.kind.startsWith("bed_"))).toHaveLength(1);
    expect(items.map((f) => f.kind)).toContain("wardrobe");
    await expect(inspector.getByTestId("room-furniture")).toContainText("Wardrobe");
    await page.screenshot({ path: "test-results/visual/furniture-room.png" });

    // Delete removes the selected piece.
    await inspector.getByTestId("room-furniture").getByRole("button", { name: /Wardrobe/ }).click();
    await page.keyboard.press("Delete");
    expect((await furniture(page)).map((f) => f.kind)).not.toContain("wardrobe");

    // In 3D, furniture shows by default and can be hidden.
    await page.keyboard.press("Shift+Digit2");
    await expect(page.getByTestId("three-view").locator("canvas")).toBeVisible();
    const shown = () => page.evaluate(() => (window.__floorPlanEditor!.getSession() as { view3d: { display: { furniture: boolean } } }).view3d.display.furniture);
    expect(await shown()).toBe(true);
    await page.getByTestId("present-tab-show").click();
    await page.getByTestId("display-furniture").click();
    expect(await shown()).toBe(false);

    // Furniture is saved with the plan.
    const count = (await furniture(page)).length;
    await expect(page.getByTestId("save-status")).toContainText("Saved", { timeout: 5000 });
    await page.reload();
    await expect(page.getByTestId("plan-canvas")).toBeVisible();
    expect(await furniture(page)).toHaveLength(count);
    expect(errors).toEqual([]);
  });

  test("generated concepts arrive furnished and draw cleanly in 2D and 3D", async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));
    page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
    await createHouse(page, { width: "10", depth: "12" });
    await page.getByTestId("tool-select").click();
    await clickAt(page, { x: 5, y: 11.85 });
    await page.getByTestId("mark-rear").click();
    await page.keyboard.press("Escape");
    await page.keyboard.press("2");
    await page.getByTestId("generate-layouts").click();
    await expect(page.getByTestId("concept-board").getByTestId("concept-Plan A")).toBeVisible();
    await page.waitForTimeout(300);
    await page.screenshot({ path: "test-results/visual/furniture-concepts.png" });
    await page.getByTestId("concept-board").getByTestId("concept-Plan A").click();
    await page.getByTestId("open-concept-Plan A").click();
    await page.waitForTimeout(300);
    expect((await furniture(page)).length).toBeGreaterThan(10);
    // Pieces in the asset library are drawn from their pictures seen from above.
    await expect.poll(() => page.evaluate(() => window.__floorPlanEditor!.planSprites())).toBeGreaterThan(0);
    await page.screenshot({ path: "test-results/visual/furniture-concept-plan.png" });
    // The 2D plan view leaves the furniture out.
    await page.getByTestId("view-plan").click();
    await page.waitForTimeout(200);
    await page.screenshot({ path: "test-results/visual/furniture-plan-view.png" });
    await page.keyboard.press("Shift+Digit2");
    await expect(page.getByTestId("three-view").locator("canvas")).toBeVisible();
    await page.getByTestId("present-tab-show").click();
    // Pieces in the asset library are drawn from their 3D models, cut off in the cutaway like the walls.
    const stats = await page.evaluate(() => window.__floorPlanEditor!.furniture3d());
    expect(stats!.models).toBeGreaterThan(0);
    await page.getByTestId("display-cutaway").click();
    await page.waitForTimeout(1500);
    await page.screenshot({ path: "test-results/visual/furniture-3d.png" });
    expect(errors).toEqual([]);
  });
});
