import { expect, test } from "@playwright/test";
import { AXIS, clickAt, createHouse, drag, drawWall, freshEditor, getDoc, getProject, historySize, level } from "./support";

test.describe("House shapes", () => {
  test.beforeEach(async ({ page }) => {
    await freshEditor(page);
  });

  test("starts an L-shaped house from the new-project page and shows it in 3D", async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));
    page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
    await page.getByTestId("shape-L").click();
    await expect(page.getByTestId("shape-L")).toHaveAttribute("aria-checked", "true");
    await expect(page.getByTestId("new-width")).toHaveValue("12");
    await page.getByTestId("new-wing").fill("0.8");
    await expect(page.getByTestId("new-project-preview")).toContainText(/wide inside/);
    await page.getByTestId("new-wing").fill("5");
    await expect(page.getByTestId("new-project-preview")).toContainText("L-shaped · 12.00 × 11.00 m outside");
    await createHouse(page, { name: "Corner house" });

    const lvl = level(await getDoc(page));
    expect(lvl.envelope.wallIds).toHaveLength(6);
    expect(Object.values(lvl.walls).every((w) => w.role === "external")).toBe(true);
    expect((await getProject(page)).name).toBe("Corner house");

    await page.keyboard.press("4");
    await expect(page.getByTestId("three-view").locator("canvas")).toBeVisible();
    await page.getByTestId("display-roof").click();
    await page.waitForTimeout(500);
    expect(errors).toEqual([]);
  });

  test("changes the house's shape from the house card, as one undoable step", async ({ page }) => {
    await createHouse(page);
    const before = await getDoc(page);
    const past = (await historySize(page)).past;
    await page.getByTestId("file-menu").click();
    await page.getByTestId("house-settings").click();
    await expect(page.getByTestId("house-shape")).toContainText("Rectangle");
    await page.getByTestId("change-shape").click();
    const dialog = page.getByTestId("create-house-dialog");
    await dialog.getByTestId("shape-U").click();
    await expect(dialog.getByTestId("create-width")).toHaveValue("14");
    await dialog.getByTestId("create-house-submit").click();
    await expect(dialog).toHaveCount(0);

    expect(level(await getDoc(page)).envelope.wallIds).toHaveLength(8);
    expect((await historySize(page)).past).toBe(past + 1);
    await page.getByTestId("undo").click();
    expect(await getDoc(page)).toEqual(before);
  });

  test("generates layouts inside an L-shaped house, keeping its shape", async ({ page }) => {
    await page.getByTestId("shape-L").click();
    await createHouse(page);
    await page.getByTestId("workspace-brief").click();
    await page.getByTestId("generate-layouts").click();
    await expect(page.getByTestId("notice")).toContainText("3 layouts generated");
    const board = page.getByTestId("concept-board");
    await expect(board.locator(".concept-card")).toHaveCount(3);
    await expect(page.getByTestId("shell-My plan")).toContainText("L-shaped");
    const project = await getProject(page);
    for (const plan of project.plans.slice(1)) {
      const lvl = level(plan.document);
      expect(lvl.envelope.wallIds).toHaveLength(6);
      expect(Object.values(lvl.rooms).filter((r) => r.type === "hall")).toHaveLength(1);
    }
  });

  test("lets the planner shape the house when starting from rooms", async ({ page }) => {
    await page.goto("/new?method=rooms");
    await expect(page.getByTestId("rooms-shape-any")).toHaveAttribute("aria-checked", "true");
    await page.getByTestId("rooms-shape-L").click();
    await page.getByTestId("new-project-submit").click();
    await expect(page.getByTestId("room-picker")).toBeVisible();
    await expect(page.getByTestId("brief-shape-L")).toHaveAttribute("aria-checked", "true");
    await page.getByTestId("next-step").click();
    const board = page.getByTestId("concept-board");
    await expect(board.locator(".concept-card")).toHaveCount(3);
    const project = await getProject(page);
    expect((project.brief as unknown as { houseShape?: string }).houseShape).toBe("L");
    for (const plan of project.plans.slice(1)) expect(level(plan.document).envelope.wallIds).toHaveLength(6);
  });

  test("reshapes the house by dragging its walls and corners, each as one undoable step", async ({ page }) => {
    await createHouse(page);
    await page.getByTestId("tool-select").click();
    const start = await getDoc(page);
    const past = (await historySize(page)).past;
    // Drag the east wall out by a metre.
    await drag(page, { x: AXIS.east, y: 5 }, { x: AXIS.east + 1, y: 5 });
    let lvl = level(await getDoc(page));
    expect(lvl.vertices[lvl.walls[lvl.envelope.wallIds[1]].startVertexId].x).toBeCloseTo(AXIS.east + 1, 6);
    expect((await historySize(page)).past).toBe(past + 1);
    await page.getByTestId("undo").click();
    expect(await getDoc(page)).toEqual(start);

    // With an outside wall selected, its corners can be dragged in to cut a notch.
    await clickAt(page, { x: 4, y: AXIS.north });
    await expect(page.getByTestId("status-message")).toContainText("drag a corner square to cut a notch");
    await drag(page, { x: AXIS.east, y: AXIS.north }, { x: AXIS.east - 3, y: AXIS.north - 2 });
    lvl = level(await getDoc(page));
    expect(lvl.envelope.wallIds).toHaveLength(6);

    // Alt-drag pushes out a bay.
    await page.keyboard.down("Alt");
    await drag(page, { x: AXIS.west, y: 3 }, { x: AXIS.west - 1, y: 3 });
    await page.keyboard.up("Alt");
    expect(level(await getDoc(page)).envelope.wallIds).toHaveLength(10);
  });

  test("draws a new outline, asking first when it would replace the rooms", async ({ page }) => {
    await createHouse(page);
    await page.keyboard.press("o");
    await expect(page.getByTestId("tool-outline")).toHaveAttribute("aria-pressed", "true");
    const corners = [
      { x: 0, y: 0 },
      { x: 9, y: 0 },
      { x: 9, y: 4 },
      { x: 5, y: 4 },
      { x: 5, y: 9 },
    ];
    for (const p of corners) await clickAt(page, p);
    // Enter closes the outline back to the first corner.
    await page.keyboard.press("Enter");
    let lvl = level(await getDoc(page));
    expect(lvl.envelope.wallIds).toHaveLength(6);
    await expect(page.getByTestId("tool-select")).toHaveAttribute("aria-pressed", "true");

    // With a wall inside, drawing again asks before replacing the house.
    await drawWall(page, { x: 2.5, y: 0.15 }, { x: 2.5, y: 8.85 });
    const withWall = await getDoc(page);
    await page.getByTestId("tool-outline").click();
    for (const p of [{ x: 0, y: 0 }, { x: 8, y: 0 }, { x: 8, y: 8 }, { x: 0, y: 8 }]) await clickAt(page, p);
    await clickAt(page, { x: 0, y: 0 });
    await expect(page.getByTestId("outline-confirm")).toBeVisible();
    await page.getByTestId("outline-confirm-keep").click();
    expect(await getDoc(page)).toEqual(withWall);
    for (const p of [{ x: 0, y: 0 }, { x: 8, y: 0 }, { x: 8, y: 8 }, { x: 0, y: 8 }]) await clickAt(page, p);
    await page.keyboard.press("Enter");
    await page.getByTestId("outline-confirm-replace").click();
    lvl = level(await getDoc(page));
    expect(lvl.envelope.wallIds).toHaveLength(4);
    expect(Object.values(lvl.walls).filter((w) => w.role === "internal")).toHaveLength(0);
    await page.getByTestId("undo").click();
    expect(await getDoc(page)).toEqual(withWall);
  });
});
