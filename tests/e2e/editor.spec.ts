import { expect, test } from "@playwright/test";
import {
  AXIS,
  clickAt,
  createHouse,
  drag,
  drawWall,
  freshEditor,
  getDoc,
  getProject,
  historySize,
  hover,
  internalWalls,
  level,
  openHouse,
  openLayers,
  toScreen,
  vertexOf,
} from "./support";

test.describe("Milestone 1 editing workflow", () => {
  test.beforeEach(async ({ page }) => {
    await freshEditor(page);
  });

  test("creates a house with correct outside dimensions and clear area", async ({ page }) => {
    await createHouse(page, { width: "9", depth: "11" });
    // Nothing is selected, so no inspector is shown until asked for.
    await expect(page.getByTestId("inspector")).toBeHidden();
    await openHouse(page);
    await expect(page.getByTestId("house-width")).toHaveValue("9.000");
    await expect(page.getByTestId("house-depth")).toHaveValue("11.000");
    // Clear area: (9 − 0.6) × (11 − 0.6) = 87.36 m².
    await expect(await openLayers(page)).toContainText("87.36 m²");
  });

  test("partitions the house, then undoes and redoes every geometry edit", async ({ page }) => {
    await createHouse(page);
    await drawWall(page, { x: 4, y: AXIS.south }, { x: 4, y: AXIS.north });
    await drawWall(page, { x: AXIS.west, y: 5 }, { x: 4, y: 5 });
    let doc = await getDoc(page);
    expect(internalWalls(doc)).toHaveLength(2);
    expect(Object.keys(level(doc).rooms)).toHaveLength(3);
    const nav = await openLayers(page);
    await expect(nav).toContainText("34.31 m²");
    await expect(nav).toContainText("16.97 m²");

    await page.keyboard.press(process.platform === "darwin" ? "Meta+z" : "Control+z");
    doc = await getDoc(page);
    expect(Object.keys(level(doc).rooms)).toHaveLength(2);
    await page.getByTestId("undo").click();
    doc = await getDoc(page);
    expect(Object.keys(level(doc).rooms)).toHaveLength(1);
    await page.getByTestId("redo").click();
    await page.getByTestId("redo").click();
    doc = await getDoc(page);
    expect(Object.keys(level(doc).rooms)).toHaveLength(3);
  });

  test("drags a connected wall as one history entry and Escape cancels a drag", async ({ page }) => {
    await createHouse(page);
    await drawWall(page, { x: 4, y: AXIS.south }, { x: 4, y: AXIS.north });
    await drawWall(page, { x: AXIS.west, y: 5 }, { x: 4, y: 5 });
    await page.getByTestId("tool-select").click();
    const doc0 = await getDoc(page);
    const vId = internalWalls(doc0).find((w) => vertexOf(doc0, w.id, "start").x === vertexOf(doc0, w.id, "end").x)!.id;
    const before = await historySize(page);

    await drag(page, { x: 4, y: 7.5 }, { x: 5.2, y: 7.5 });
    let doc = await getDoc(page);
    expect(vertexOf(doc, vId, "start").x).toBeCloseTo(5.2, 6);
    expect((await historySize(page)).past).toBe(before.past + 1);
    // The attached horizontal wall stretched to follow.
    const hId = internalWalls(doc).find((w) => w.id !== vId)!.id;
    expect(vertexOf(doc, hId, "end").x).toBeCloseTo(5.2, 6);

    const a = await toScreen(page, { x: 5.2, y: 7.5 });
    const b = await toScreen(page, { x: 6.5, y: 7.5 });
    await page.mouse.move(a.x, a.y);
    await page.mouse.down();
    await page.mouse.move(b.x, b.y, { steps: 8 });
    await page.keyboard.press("Escape");
    await page.mouse.up();
    doc = await getDoc(page);
    expect(vertexOf(doc, vId, "start").x).toBeCloseTo(5.2, 6);
    expect((await historySize(page)).past).toBe(before.past + 1);
  });

  test("explains invalid edits and keeps the last valid document", async ({ page }) => {
    await createHouse(page);
    await drawWall(page, { x: 6, y: AXIS.south }, { x: 6, y: AXIS.north });
    const before = await getDoc(page);
    await openHouse(page);
    await page.getByTestId("house-width").fill("6");
    await page.getByTestId("house-width").press("Enter");
    await expect(page.getByTestId("notice")).toContainText("can't be reduced below 6.350 m");
    expect(await getDoc(page)).toEqual(before);
    await expect(page.getByTestId("house-width")).toHaveValue("8.000");
  });

  test("names rooms, places openings, marks the rear wall and survives reload", async ({ page }) => {
    await createHouse(page);
    await drawWall(page, { x: 4, y: AXIS.south }, { x: 4, y: AXIS.north });

    await page.getByTestId("tool-room").click();
    await clickAt(page, { x: 2, y: 5 });
    const name = page.getByTestId("room-name");
    await expect(name).toBeFocused();
    await name.fill("Kitchen");
    // Typing tool shortcuts into a text field must not switch tools.
    await name.press("End");
    await name.pressSequentially(" w");
    await expect(page.getByTestId("tool-room")).toHaveAttribute("aria-pressed", "true");
    await name.press("Enter");
    await page.getByTestId("room-type").selectOption("kitchen");

    await page.getByTestId("tool-door").click();
    await hover(page, { x: 4, y: 3 });
    await clickAt(page, { x: 4, y: 3 });
    await page.getByTestId("tool-window").click();
    await clickAt(page, { x: 2, y: AXIS.north });
    await page.getByTestId("opening-width").fill("1.5");
    await page.getByTestId("opening-width").press("Enter");

    await page.getByTestId("tool-select").click();
    await clickAt(page, { x: 6, y: AXIS.north });
    await page.getByTestId("mark-rear").click();
    const north = level(await getDoc(page)).envelope.wallIds[2];

    const doc = await getDoc(page);
    expect(Object.values(level(doc).rooms).map((r) => r.name)).toContain("Kitchen w");
    expect(Object.values(level(doc).openings).map((o) => o.kind).sort()).toEqual(["door", "window"]);
    expect(Object.values(level(doc).openings).find((o) => o.kind === "window")!.width).toBe(1.5);
    expect(level(doc).rearWallId).toBe(north);

    await expect(page.getByTestId("save-status")).toContainText("Saved", { timeout: 5000 });
    await page.reload();
    await expect(page.getByTestId("create-house-dialog")).toBeHidden();
    await page.waitForTimeout(300);
    expect(await getDoc(page)).toEqual(doc);
  });

  test("keeps openings hosted when the house is resized", async ({ page }) => {
    await createHouse(page);
    await page.getByTestId("tool-window").click();
    await clickAt(page, { x: 6, y: AXIS.north });
    const before = await getDoc(page);
    const win = Object.values(level(before).openings)[0];
    const startX = 7.85 - win.offset;
    await openHouse(page);
    await page.getByTestId("house-width").fill("10");
    await page.getByTestId("house-width").press("Enter");
    const after = await getDoc(page);
    const moved = level(after).openings[win.id];
    expect(moved.wallId).toBe(win.wallId);
    expect(9.85 - moved.offset).toBeCloseTo(startX, 6);
  });

  test("exports and re-imports a project file; bad files leave the plan untouched", async ({ page }) => {
    await createHouse(page);
    await drawWall(page, { x: 4, y: AXIS.south }, { x: 4, y: AXIS.north });
    const original = await getDoc(page);

    await page.getByTestId("export-menu").click();
    const downloadPromise = page.waitForEvent("download");
    await page.getByTestId("export-json").click();
    const download = await downloadPromise;
    const path = await download.path();
    const fs = await import("node:fs/promises");
    const text = await fs.readFile(path!, "utf8");
    const exported = JSON.parse(text);
    expect(exported.format).toBe("floor-plan-project");
    expect(exported.plans).toHaveLength(1);
    expect(exported.plans[0].document).toEqual(original);

    const input = page.getByTestId("import-file-input");
    await input.setInputFiles({ name: "broken.json", mimeType: "application/json", buffer: Buffer.from("{ nope") });
    await expect(page.getByTestId("notice")).toContainText("not valid JSON");
    await input.setInputFiles({
      name: "future.json",
      mimeType: "application/json",
      buffer: Buffer.from(JSON.stringify({ ...original, schemaVersion: 9 })),
    });
    await expect(page.getByTestId("notice")).toContainText("newer than this editor supports");
    expect(await getDoc(page)).toEqual(original);

    await page.getByTestId("undo").click();
    expect(internalWalls(await getDoc(page))).toHaveLength(0);
    // A project file replaces the open project.
    await input.setInputFiles({ name: "project.json", mimeType: "application/json", buffer: Buffer.from(text) });
    await expect(page.getByTestId("notice")).toContainText("Opened");
    expect(await getDoc(page)).toEqual(original);

    // Opening a project starts fresh history.
    await expect(page.getByTestId("undo")).toBeDisabled();

    // A single-plan file (the pre-project format) opens into the current plan as one undoable step.
    await page.getByTestId("tool-select").click();
    await clickAt(page, { x: 4, y: 5 });
    await page.keyboard.press("Delete");
    expect(internalWalls(await getDoc(page))).toHaveLength(0);
    await input.setInputFiles({ name: "plan.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(original)) });
    await expect(page.getByTestId("notice")).toContainText("Undo restores");
    expect(await getDoc(page)).toEqual(original);
    await page.getByTestId("undo").click();
    expect(internalWalls(await getDoc(page))).toHaveLength(0);
  });

  test("snaps consistently across zoom levels; pan and zoom stay out of history", async ({ page }) => {
    await createHouse(page);
    await drawWall(page, { x: 4, y: AXIS.south }, { x: 4, y: AXIS.north });
    await page.getByTestId("tool-wall").click();
    const before = await historySize(page);
    for (const zoomSteps of [0, 3, -2]) {
      const canvas = (await page.getByTestId("plan-canvas").boundingBox())!;
      await page.mouse.move(canvas.x + canvas.width / 2, canvas.y + canvas.height / 2);
      for (let i = 0; i < Math.abs(zoomSteps); i++) await page.mouse.wheel(0, zoomSteps > 0 ? -200 : 200);
      await page.waitForTimeout(80);
      const target = await toScreen(page, { x: 4, y: 5 });
      await page.mouse.move(target.x + 6, target.y - 4, { steps: 2 });
      await page.waitForTimeout(80);
      await expect(page.getByTestId("snap-kind")).toHaveText("Snap: On wall");
      const far = await toScreen(page, { x: 4, y: 5 });
      await page.mouse.move(far.x + 14, far.y, { steps: 2 });
      await page.waitForTimeout(80);
      await expect(page.getByTestId("snap-kind")).not.toHaveText("Snap: On wall");
    }
    // Space-drag pan.
    const c = (await page.getByTestId("plan-canvas").boundingBox())!;
    await page.mouse.move(c.x + 300, c.y + 300);
    await page.keyboard.down(" ");
    await page.mouse.down();
    await page.mouse.move(c.x + 380, c.y + 340, { steps: 5 });
    await page.mouse.up();
    await page.keyboard.up(" ");
    await page.getByTestId("tool-select").click();
    await clickAt(page, { x: 2, y: 2 });
    expect(await historySize(page)).toEqual(before);
  });

  test("selects from the plan contents list and deletes with the keyboard", async ({ page }) => {
    await createHouse(page);
    await drawWall(page, { x: 4, y: AXIS.south }, { x: 4, y: AXIS.north });
    await page.getByTestId("tool-door").click();
    await clickAt(page, { x: 4, y: 3 });
    await page.getByTestId("tool-select").click();
    await page.keyboard.press("l");
    const nav = await openLayers(page);
    await nav.getByText("Walls").click();
    await nav.getByRole("button", { name: /Internal wall 1/ }).click();
    await expect(page.getByTestId("inspector").getByRole("heading", { name: "Internal wall 1" })).toBeVisible();
    await page.getByTestId("plan-canvas").focus();
    await page.keyboard.press("Delete");
    let doc = await getDoc(page);
    expect(internalWalls(doc)).toHaveLength(0);
    expect(Object.keys(level(doc).openings)).toHaveLength(0);
    await page.keyboard.press(process.platform === "darwin" ? "Meta+z" : "Control+z");
    doc = await getDoc(page);
    expect(internalWalls(doc)).toHaveLength(1);
    expect(Object.keys(level(doc).openings)).toHaveLength(1);
  });

  test("extends a wall by dragging its end handle onto another wall", async ({ page }) => {
    await createHouse(page);
    await drawWall(page, { x: AXIS.west, y: 5 }, { x: 3, y: 5 });
    expect(Object.keys(level(await getDoc(page)).rooms)).toHaveLength(1);
    await page.getByTestId("tool-select").click();
    await clickAt(page, { x: 2, y: 5 });
    await drag(page, { x: 3, y: 5 }, { x: AXIS.east + 0.03, y: 5.02 });
    const doc = await getDoc(page);
    const wall = internalWalls(doc)[0];
    expect(vertexOf(doc, wall.id, "end")).toEqual({ x: AXIS.east, y: 5 });
    expect(Object.keys(level(doc).rooms)).toHaveLength(2);
  });

  test("shows a contextual inspector that collapses, and switches workspaces", async ({ page }) => {
    await createHouse(page);
    await drawWall(page, { x: 4, y: AXIS.south }, { x: 4, y: AXIS.north });
    await page.getByTestId("tool-select").click();
    await page.keyboard.press("Escape");
    await expect(page.getByTestId("inspector")).toBeHidden();

    await clickAt(page, { x: 4, y: 6 });
    const inspector = page.getByTestId("inspector");
    await expect(inspector).toBeVisible();
    await expect(inspector.getByTestId("wall-length")).toBeVisible();
    await inspector.getByTestId("inspector-menu").click();
    await inspector.getByTestId("inspector-collapse").click();
    await expect(inspector.getByTestId("wall-length")).toBeHidden();
    await expect(inspector.getByRole("heading", { name: "Internal wall 1" })).toBeVisible();
    await inspector.getByTestId("inspector-menu").click();
    await inspector.getByTestId("inspector-collapse").click();
    await page.keyboard.press("Escape");
    await expect(inspector).toBeHidden();

    // Designs opens on the concept board; with none yet, the starting plan can be opened to refine.
    await page.getByTestId("workspace-design").click();
    await expect(page.getByTestId("workspace-design")).toHaveAttribute("aria-checked", "true");
    await expect(page.getByTestId("board-go-brief")).toBeVisible();
    await page.getByTestId("shell-refine").click();
    await expect(page.getByTestId("back-to-concepts")).toBeVisible();
    // Refining offers room, wall and door tools but not the shell's windows; clicks pick rooms.
    await expect(page.getByTestId("tool-wall")).toBeVisible();
    await expect(page.getByTestId("tool-window")).toHaveCount(0);
    await page.keyboard.press("n");
    await expect(page.getByTestId("tool-select")).toHaveAttribute("aria-pressed", "true");
    await clickAt(page, { x: 2, y: 6 });
    const selection = await page.evaluate(() => (window.__floorPlanEditor!.getSession() as { selection: { kind: string } | null }).selection);
    expect(selection?.kind).toBe("room");
    await expect(inspector.getByTestId("room-name")).toBeVisible();

    await page.getByTestId("workspace-3d").click();
    await expect(page.getByTestId("workspace-3d")).toHaveAttribute("aria-checked", "true");
    await expect(page.getByTestId("present-panel")).toBeVisible();
    await page.keyboard.press("1");
    await expect(page.getByTestId("workspace-structure")).toHaveAttribute("aria-checked", "true");
    await expect(page.getByTestId("tool-wall")).toBeVisible();

    // The brief shows the plan for reference only: no tools, and clicks don't select.
    await page.keyboard.press("2");
    await expect(page.getByTestId("workspace-brief")).toHaveAttribute("aria-checked", "true");
    await expect(page.getByTestId("brief-panel")).toBeVisible();
    await expect(page.getByTestId("tool-select")).toHaveCount(0);
    await clickAt(page, { x: 2, y: 6 });
    expect(await page.evaluate(() => (window.__floorPlanEditor!.getSession() as { selection: unknown }).selection)).toBeNull();
    await expect(inspector).toBeHidden();
  });

  test("resizes a window by dragging its edge and shows clearances", async ({ page }) => {
    await createHouse(page);
    await page.getByTestId("tool-window").click();
    await clickAt(page, { x: 4, y: AXIS.north });
    const placed = Object.values(level(await getDoc(page)).openings)[0];
    const before = await historySize(page);
    await page.getByTestId("tool-select").click();
    await clickAt(page, { x: 4, y: AXIS.north });
    // North wall runs east → west, so the offset edge is the east (higher-x) edge.
    const edgeX = AXIS.east - placed.offset;
    await drag(page, { x: edgeX, y: AXIS.north }, { x: edgeX + 0.4, y: AXIS.north });
    const resized = level(await getDoc(page)).openings[placed.id];
    expect(resized.width).toBeCloseTo(placed.width + 0.4, 6);
    expect(AXIS.east - resized.offset - resized.width).toBeCloseTo(AXIS.east - placed.offset - placed.width, 6);
    expect((await historySize(page)).past).toBe(before.past + 1);
    await expect(page.getByTestId("opening-size")).toHaveText(`${Math.round(resized.width * 1000)} × 1200 mm`);
  });

  test("gives rooms a type, renaming generated names, and a target area", async ({ page }) => {
    await createHouse(page);
    await drawWall(page, { x: 4, y: AXIS.south }, { x: 4, y: AXIS.north });
    await page.getByTestId("tool-select").click();
    await clickAt(page, { x: 2, y: 5 });
    const inspector = page.getByTestId("inspector");
    await inspector.getByTestId("room-type").selectOption("primary_bedroom");
    await expect(inspector.getByRole("heading", { name: "Primary Bedroom" })).toBeVisible();
    await inspector.getByTestId("set-target-area").click();
    await inspector.getByTestId("room-target-area").fill("30");
    await inspector.getByTestId("room-target-area").press("Enter");
    // The room is 34.31 m² clear.
    await expect(inspector.getByTestId("room-target-readout")).toContainText("4.31 m² over target");
    const room = Object.values(level(await getDoc(page)).rooms).find((r) => r.type === "primary_bedroom")!;
    expect(room).toMatchObject({ name: "Primary Bedroom", targetArea: 30 });
    // A name the user chose is kept when the type changes.
    await inspector.getByTestId("room-name").fill("Den");
    await inspector.getByTestId("room-name").press("Enter");
    await inspector.getByTestId("room-type").selectOption("office");
    expect(level(await getDoc(page)).rooms[room.id]).toMatchObject({ name: "Den", type: "office" });
  });

  test("generates layouts from the brief as new plans, without touching the original", async ({ page }) => {
    await createHouse(page);
    await page.getByTestId("tool-select").click();
    await clickAt(page, { x: 4, y: AXIS.north });
    await page.getByTestId("mark-rear").click();
    await page.keyboard.press("Escape");
    const original = await getDoc(page);
    await expect(page.getByTestId("variation-tray")).toBeHidden();

    await page.getByTestId("workspace-brief").click();
    const panel = page.getByTestId("brief-panel");
    await expect(panel.getByRole("heading", { name: "What does this house need?" })).toBeVisible();
    await expect(panel.getByTestId("brief-shell")).toContainText("Garden side North");
    await panel.getByTestId("brief-bedrooms-dec").click();
    await expect(panel.getByTestId("brief-bedrooms")).toHaveText("2");
    await panel.getByTestId("brief-pref-kitchen_faces_garden").click();
    // The rear wall is set, so there's no prompt to mark it.
    await expect(panel.getByTestId("brief-rear-note")).toBeHidden();
    await panel.getByTestId("brief-size-bedrooms-generous").click();
    await panel.getByTestId("brief-instructions").fill("A boot room would be nice");
    await panel.getByTestId("brief-instructions").blur();
    await panel.getByTestId("generate-layouts").click();
    // Layouts open in Designs.
    await expect(page.getByTestId("workspace-design")).toHaveAttribute("aria-checked", "true");
    await expect(page.getByTestId("notice")).toContainText("3 layouts generated");

    // Designs shows the concepts side by side, one recommended, with the starting plan in reach.
    const board = page.getByTestId("concept-board");
    await expect(board).toBeVisible();
    await expect(board.locator(".concept-card")).toHaveCount(3);
    await expect(board.getByTestId("recommended")).toHaveCount(1);
    await expect(board.getByTestId("shell-My plan")).toBeVisible();
    await expect(page.getByTestId("concept-detail")).toBeVisible();
    let project = await getProject(page);
    expect(project.brief).toMatchObject({ bedrooms: 2, preferences: ["kitchen_faces_garden"], roomSizes: { bedrooms: "generous" } });
    const generated = project.plans.slice(1);
    expect(generated.every((p) => p.origin.kind === "generated" && p.parentId === project.plans[0].id)).toBe(true);

    // Concept B in detail, then opened to refine.
    await board.getByTestId("concept-Plan B").click();
    await expect(page.getByTestId("concept-detail")).toContainText("B.");
    await page.getByTestId("detail-tab-rooms").click();
    await expect(page.getByTestId("concept-detail")).toContainText("Primary Bedroom");
    await page.getByTestId("use-design").click();
    await expect(page.getByTestId("current-concept")).toContainText("B.");
    expect((await getProject(page)).activePlanId).toBe(generated[1].id);
    expect(Object.values(level(await getDoc(page)).rooms).map((r) => r.type)).toContain("primary_bedroom");

    // Back to the board: more concepts come in new arrangements; duplicating adds one too.
    await page.getByTestId("back-to-concepts").click();
    await page.getByTestId("generate-more").click();
    await expect(page.getByTestId("notice")).toContainText("3 more layouts");
    await expect(board.locator(".concept-card")).toHaveCount(6);
    await board.getByTestId("concept-menu-Plan A").click();
    await board.getByTestId("concept-duplicate-Plan A").click();
    await expect(board.locator(".concept-card")).toHaveCount(7);
    await board.getByTestId("concept-menu-Plan G").click();
    await board.getByTestId("concept-delete-Plan G").click();
    await board.getByTestId("concept-delete-confirm-Plan G").click();
    await expect(board.locator(".concept-card")).toHaveCount(6);

    // The original plan is untouched.
    await page.getByTestId("workspace-structure").click();
    const tray = page.getByTestId("variation-tray");
    await tray.getByTestId("plan-My plan").click();
    expect(await getDoc(page)).toEqual(original);
    await tray.getByTestId("add-variation").click();
    await expect(tray.getByRole("radio")).toHaveCount(8);

    // Plans and the brief survive a reload.
    await expect(page.getByTestId("save-status")).toContainText("Saved", { timeout: 5000 });
    await page.reload();
    await expect(page.getByTestId("variation-tray").getByRole("radio")).toHaveCount(8);
    project = await getProject(page);
    expect(project.plans.map((p) => p.label)).toEqual(["My plan", "Plan A", "Plan B", "Plan C", "Plan D", "Plan E", "Plan F", "Plan G"]);
    expect(project.brief.bedrooms).toBe(2);

    // Delete asks for confirmation.
    await page.getByTestId("variation-tray").getByTestId("plan-Plan G").hover();
    await page.getByTestId("delete-plan-Plan G").click();
    await page.getByTestId("delete-plan-confirm-Plan G").click();
    await expect(page.getByTestId("variation-tray").getByRole("radio")).toHaveCount(7);
  });

  test("refines a concept: room options are offered, applied as one undoable edit, and the AI Designer takes requests", async ({ page }) => {
    await createHouse(page);
    await page.getByTestId("tool-select").click();
    await clickAt(page, { x: 4, y: AXIS.north });
    await page.getByTestId("mark-rear").click();
    await page.keyboard.press("Escape");
    await page.keyboard.press("2");
    await page.getByTestId("generate-layouts").click();
    await page.getByTestId("open-concept-Plan A").click();
    await expect(page.getByTestId("ai-panel")).toBeVisible();

    const doc = await getDoc(page);
    const bedroom = Object.values(level(doc).rooms).find((r) => r.type === "primary_bedroom")!;
    const seed = (bedroom as unknown as { seed: { x: number; y: number } }).seed;
    await clickAt(page, seed);
    const inspector = page.getByTestId("inspector");
    await expect(inspector.getByRole("heading", { name: "Primary Bedroom" })).toBeVisible();
    await expect(inspector.getByTestId("room-connections")).toContainText("Door to");
    await expect(page.getByTestId("room-quickbar")).toBeVisible();

    // Suggestions come back as options in the AI Designer; the plan only changes when one is applied.
    const before = await historySize(page);
    await inspector.getByTestId("room-tab-ai").click();
    await inspector.getByTestId("suggest-make_larger").click();
    const proposal = page.getByTestId("proposal").first();
    await expect(proposal).toBeVisible();
    expect(await historySize(page)).toEqual(before);
    await proposal.getByTestId("apply-proposal").click();
    await expect(proposal).toContainText("Applied");
    expect((await historySize(page)).past).toBe(before.past + 1);
    await page.getByTestId("undo").click();
    expect(await getDoc(page)).toEqual(doc);

    // Typed requests: a room change and a new space for the brief.
    await page.getByTestId("ai-input").fill("Make the kitchen larger and add a utility room");
    await page.getByTestId("ai-send").click();
    await expect(page.getByTestId("ai-generate")).toBeVisible();
    expect((await getProject(page)).brief.requiredSpaces).toContain("utility");

    // Swapping rooms is one undoable step.
    await inspector.getByTestId("room-tab-details").click();
    await inspector.getByTestId("swap-room").click();
    await inspector.getByTestId("swap-with-Bedroom 2").click();
    await expect(inspector.getByRole("heading", { name: "Bedroom 2" })).toBeVisible();
    await page.getByTestId("undo").click();
    expect(level(await getDoc(page)).rooms[bedroom.id].name).toBe("Primary Bedroom");
  });

  test("compares a room's variations side by side and applies one to the main plan", async ({ page }) => {
    await createHouse(page);
    await page.getByTestId("tool-select").click();
    await clickAt(page, { x: 4, y: AXIS.north });
    await page.getByTestId("mark-rear").click();
    await page.keyboard.press("Escape");
    await page.keyboard.press("2");
    await page.getByTestId("generate-layouts").click();
    await page.getByTestId("open-concept-Plan A").click();
    const doc = await getDoc(page);
    const kitchen = Object.values(level(doc).rooms).find((r) => r.type === "kitchen" || r.type === "kitchen_dining")!;
    await clickAt(page, (kitchen as unknown as { seed: { x: number; y: number } }).seed);
    await page.getByTestId("inspector").getByTestId("room-variations").click();

    // The canvas turns into the room beside its alternatives.
    const board = page.getByTestId("room-variations-board");
    await expect(board).toBeVisible();
    await expect(board.getByTestId("variation-current")).toBeVisible();
    await expect(board.locator(".variation-card")).toHaveCount(4);
    await board.getByTestId("variation-Variation 2").click();
    await expect(page.getByTestId("variation-detail")).toContainText("Variation 2");

    // Compare two side by side.
    await board.getByTestId("variation-menu-Variation 1").click();
    await board.getByTestId("compare-Variation 1-Variation 2").click();
    await expect(page.getByTestId("variation-compare")).toContainText("Comparing variation 1 and variation 2");
    await page.getByTestId("end-compare").click();

    // More options, none repeated.
    await page.getByTestId("more-variations").click();
    await expect.poll(() => board.locator(".variation-card").count()).toBeGreaterThan(4);
    const before = await historySize(page);
    expect(await getDoc(page)).toEqual(doc);

    // Applying returns to the plan as one undoable edit.
    await board.getByTestId("variation-Variation 1").click();
    await page.getByTestId("apply-variation").click();
    await expect(page.getByTestId("back-to-concepts")).toBeVisible();
    expect((await historySize(page)).past).toBe(before.past + 1);
    await page.getByTestId("undo").click();
    expect(await getDoc(page)).toEqual(doc);
  });

  test("shows the house in 3D beside the plan, in step with it", async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));
    page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
    await createHouse(page);
    await drawWall(page, { x: 4, y: AXIS.south }, { x: 4, y: AXIS.north });
    await page.keyboard.press("4");
    await expect(page.getByTestId("workspace-3d")).toHaveAttribute("aria-checked", "true");
    await expect(page.getByTestId("three-view").locator("canvas")).toBeVisible();
    await expect(page.getByTestId("three-unavailable")).toHaveCount(0);
    const session = () => page.evaluate(() => window.__floorPlanEditor!.getSession() as { selection: { kind: string; id: string } | null; view3d: { mode: string; camera: string; lighting: string; display: { roof: boolean } } });

    // Split: the plan on the left picks rooms for both views.
    await page.getByTestId("view-split").click();
    await expect(page.getByTestId("plan-canvas")).toBeVisible();
    expect((await session()).view3d.mode).toBe("split");
    await page.waitForTimeout(200);
    await clickAt(page, { x: 2, y: 5 });
    expect((await session()).selection?.kind).toBe("room");

    // Cameras, display and light.
    await page.getByTestId("camera-interior").click();
    expect((await session()).view3d.camera).toBe("interior");
    await page.getByTestId("dock-walk").click();
    expect((await session()).view3d.camera).toBe("walk");
    await page.getByTestId("display-roof").click();
    expect((await session()).view3d.display.roof).toBe(true);
    await page.getByTestId("lighting-menu").click();
    await page.getByTestId("lighting-option-night").click();
    expect((await session()).view3d.lighting).toBe("night");

    // The exterior finish is saved with the project; wall height is one undoable edit.
    await page.getByTestId("present-tab-materials").click();
    await page.getByTestId("exterior-brick").click();
    expect((await getProject(page)).appearance).toMatchObject({ exterior: "brick" });
    const before = await historySize(page);
    await page.getByTestId("wall-height-all").fill("2.7");
    await page.getByTestId("wall-height-all").press("Enter");
    const heights = () => getDoc(page).then((d) => Object.values(level(d).walls).map((w) => (w as unknown as { height: number }).height));
    expect(new Set(await heights())).toEqual(new Set([2.7]));
    expect((await historySize(page)).past).toBe(before.past + 1);
    await page.getByTestId("undo").click();
    expect(new Set(await heights())).toEqual(new Set([2.4]));

    // Export the model.
    await page.getByTestId("export-menu").click();
    const download = page.waitForEvent("download");
    await page.getByTestId("export-glb").click();
    expect((await download).suggestedFilename()).toMatch(/\.glb$/);
    expect(errors).toEqual([]);
  });
});
