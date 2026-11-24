import { readFileSync } from "node:fs";
import { expect, test, type Page } from "@playwright/test";
import { freshHome, getProject, level, openRoomPicker } from "./support";

/** Home → Start designing → the editor's Rooms step. */
async function startFromRooms(page: Page) {
  await freshHome(page);
  await page.getByTestId("start-rooms").click();
  await openRoomPicker(page);
  await expect(page.getByTestId("step-requirements")).toHaveAttribute("aria-current", "step");
  // Nothing to refine or see in 3D until there are layouts.
  await expect(page.getByTestId("step-refine")).toHaveAttribute("aria-disabled", "true");
}

test.describe("Placing rooms on the plan", () => {
  test("drags a room onto the preview, generates layouts that put it there, and clears it", async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await startFromRooms(page);
    const plan = page.getByTestId("rooms-drop").locator("svg").first();
    await expect(plan).toBeVisible();
    // Drop the master into the back-right corner (the garden is at the top of the drawing).
    const box = (await plan.boundingBox())!;
    await page.getByTestId("pick-drag-master_bedroom").dragTo(plan, { targetPosition: { x: box.width * 0.8, y: box.height * 0.2 } });
    const marker = page.getByTestId("placement-master_bedroom#1");
    await expect(marker).toBeVisible();
    await expect(page.getByTestId("rooms-placed")).toContainText("1 room placed");
    const placed = (await getProject(page)).brief as { placements?: Record<string, { u: number; v: number }> };
    expect(placed.placements?.["master_bedroom#1"].u).toBeGreaterThan(0.6);
    expect(placed.placements?.["master_bedroom#1"].v).toBeGreaterThan(0.6);
    // The preview re-plans to honour it.
    await expect(marker).toHaveAttribute("data-honoured", "true");
    await page.waitForTimeout(400);
    await page.screenshot({ path: "test-results/visual/rooms-placed.png" });

    await page.getByTestId("generate-layouts").click();
    await expect(page.getByTestId("concept-board").locator(".layout-card")).not.toHaveCount(0);
    // The recommended layout puts the master where it was placed: no note on its card, and the detail says so.
    const first = page.getByTestId("concept-board").locator(".layout-card").first();
    await expect(first.locator(".layout-miss")).toHaveCount(0);
    await expect(page.getByTestId("placed-list")).toContainText("as placed");

    // Back to the rooms: clearing the placement takes the marker off.
    await page.getByTestId("shell-edit-brief").click();
    await page.getByTestId("clear-placements").click();
    await expect(marker).toHaveCount(0);
    expect(((await getProject(page)).brief as { placements?: unknown }).placements).toBeUndefined();
    expect(errors).toEqual([]);
  });

  test("places a room from the keyboard, and says on the card when a layout can't put it there", async ({ page }) => {
    await startFromRooms(page);
    // The master with its ensuite never goes at the front in these layouts: a placement no layout can keep.
    await page.getByTestId("place-menu-master_bedroom").focus();
    await page.keyboard.press("Enter");
    await page.getByTestId("place-master_bedroom-front-left").click();
    await expect(page.getByTestId("placement-master_bedroom#1")).toBeVisible();
    await page.getByTestId("place-menu-double_bedroom").click();
    await page.getByTestId("place-double_bedroom-back-right").click();
    await expect(page.getByTestId("rooms-placed")).toContainText("2 rooms placed");

    await page.getByTestId("generate-layouts").click();
    await expect(page.getByTestId("concept-board").locator(".layout-card")).not.toHaveCount(0);
    await expect(page.getByTestId("concept-board").locator(".layout-miss").first()).toContainText("where you placed it");
    await page.waitForTimeout(400);
    await page.screenshot({ path: "test-results/visual/layouts-missed.png" });
  });
});

test.describe("Pick your rooms", () => {
  test("picks rooms beside a live 3D preview, then generates layouts sized from them", async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await startFromRooms(page);

    // A typical family home is picked to start with, and previewed as a plan (3D is one click away).
    await expect(page.getByTestId("pick-master_bedroom-count")).toHaveText("1");
    await expect(page.getByTestId("pick-double_bedroom-count")).toHaveText("2");
    await expect(page.getByTestId("rooms-view-2d")).toHaveAttribute("aria-checked", "true");
    await expect(page.getByTestId("rooms-preview-facts")).toContainText("3 bed");

    // Picking rooms updates the preview.
    await page.getByTestId("pick-single_bedroom-inc").click();
    await page.getByTestId("pick-office-inc").click();
    await expect(page.getByTestId("rooms-preview-facts")).toContainText("4 bed");
    // An ensuite needs a master bedroom.
    await page.getByTestId("pick-master_bedroom-dec").click();
    await expect(page.getByTestId("pick-ensuite-count")).toHaveText("0");
    await expect(page.getByTestId("pick-ensuite-inc")).toBeDisabled();
    await page.getByTestId("pick-master_bedroom-inc").click();
    await page.getByTestId("pick-ensuite-inc").click();

    // Presets and inspiration fill in the rooms in one go.
    await page.getByTestId("rooms-tab-presets").click();
    await page.getByTestId("preset-family-4").click();
    await expect(page.getByTestId("room-picker")).toBeVisible();
    await expect(page.getByTestId("pick-office-count")).toHaveText("1");
    await page.getByTestId("rooms-view-3d").click();
    await expect(page.getByTestId("rooms-3d")).toBeVisible();
    await page.getByTestId("rooms-view-2d").click();
    await expect(page.getByTestId("rooms-preview").locator("svg").first()).toBeVisible();
    await page.waitForTimeout(800);
    await page.screenshot({ path: "test-results/visual/rooms-step.png" });

    // Generate opens Layouts straight away and fills it with five named layouts.
    await page.getByTestId("generate-layouts").click();
    const board = page.getByTestId("concept-board");
    await expect(board).toBeVisible();
    const cards = board.locator(".layout-card:not(.is-loading)");
    await expect(cards).toHaveCount(5);
    await expect(page.getByTestId("step-refine")).not.toHaveAttribute("aria-disabled", "true");
    const project = await getProject(page);
    expect((project as unknown as { sizing: unknown }).sizing).toEqual({ footprint: "auto" });
    expect((project.brief as unknown as { rooms: Record<string, number> }).rooms).toMatchObject({ master_bedroom: 1, double_bedroom: 2, single_bedroom: 1, office: 1, open_plan: 1 });
    for (const plan of project.plans.slice(1)) {
      const rooms = Object.values(level(plan.document).rooms);
      expect(rooms.filter((r) => r.type === "bedroom" || r.type === "primary_bedroom")).toHaveLength(4);
      expect(rooms.filter((r) => r.type === "office")).toHaveLength(1);
    }

    // The concept's rooms as pictures. Photo renders need a key, which tests never have, so this
    // production build shows the 3D views alone, with no setup notes.
    await page.getByTestId("detail-tab-rooms").click();
    const gallery = page.getByTestId("room-gallery");
    await expect(gallery.getByTestId("render-rooms")).toHaveCount(0);
    await expect(gallery.getByTestId("render-setup")).toHaveCount(0);
    await expect(gallery).not.toContainText(/Gemini|API_KEY|\.env|paid/);
    await expect(gallery.locator("img[data-kind=still]").first()).toBeVisible({ timeout: 15000 });
    await gallery.locator(".photo-tile").nth(1).click();
    await expect(page.getByTestId("lightbox")).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.getByTestId("lightbox")).toBeHidden();

    // Generate more stays sized from the rooms.
    await page.getByTestId("generate-more").click();
    await expect(cards).toHaveCount(10);
    expect((await getProject(page)).plans.length).toBeGreaterThan(project.plans.length);
    expect(errors).toEqual([]);
  });

  test("renders photos through the image service, keeps them, and marks them out of date", async ({ page }) => {
    // A stand-in for the Gemini route: tests never make paid calls.
    const photo = readFileSync("tests/fixtures/room-render.jpg").toString("base64");
    let posts = 0;
    await page.route("**/api/design/render", (route) =>
      route.request().method() === "GET"
        ? route.fulfill({ json: { available: true, model: "test-model" } })
        : (posts++, route.fulfill({ json: { image: photo, mimeType: "image/jpeg", model: "test-model" } })),
    );
    await startFromRooms(page);

    // The preview can be turned into a photo.
    await page.getByTestId("rooms-view-3d").click();
    await page.getByTestId("rooms-render-photo").click();
    await expect(page.getByTestId("rooms-photo")).toBeVisible({ timeout: 20000 });
    expect(posts).toBe(1);
    await page.getByTestId("rooms-photo-back").click();
    await expect(page.getByTestId("rooms-3d")).toBeVisible();

    await page.getByTestId("generate-layouts").click();
    await page.getByTestId("concept-board").getByTestId("concept-Plan A").click();
    await page.getByTestId("detail-tab-rooms").click();
    const gallery = page.getByTestId("room-gallery");
    await expect(gallery.getByTestId("render-rooms")).toBeEnabled();
    await gallery.getByTestId("render-rooms").click();
    await expect(gallery.locator("img[data-kind=photo]").first()).toBeVisible({ timeout: 20000 });
    await expect(gallery.getByTestId("render-progress")).toBeHidden({ timeout: 20000 });
    const tiles = await gallery.locator(".photo-tile").count();
    expect(posts).toBe(1 + tiles);
    await expect(gallery.locator("img[data-kind=photo]")).toHaveCount(tiles);
    await expect(gallery.getByTestId("render-rooms")).toHaveText(/Render again/);

    // Photos are kept with the project.
    await expect(page.getByTestId("save-status")).toContainText("Saved", { timeout: 5000 });
    await page.reload();
    await expect(page.getByTestId("plan-canvas")).toBeVisible();
    // A project with layouts reopens on Layouts, showing the recommended one; the photos belong to Plan A.
    await expect(page.getByTestId("step-explore")).toHaveAttribute("aria-current", "step");
    await page.getByTestId("concept-board").getByTestId("concept-Plan A").click();
    await page.getByTestId("detail-tab-rooms").click();
    await expect(page.getByTestId("room-gallery").locator("img[data-kind=photo]")).toHaveCount(tiles, { timeout: 10000 });

    // A new interior style makes the room photos out of date, not the exterior.
    await page.getByTestId("interior-style").selectOption("coastal");
    await expect(page.getByTestId("room-gallery").getByTestId("photo-stale")).toHaveCount(tiles - 1);
    await expect(page.getByTestId("room-gallery").getByTestId("render-rooms")).toHaveText(new RegExp(`Render ${tiles - 1} more`));
  });
});

test("says when the rooms don't fit the plot, and opens the plot fields to fix it", async ({ page }) => {
  await startFromRooms(page);
  // The plot is set in Map.
  await page.getByTestId("step-map").click();
  await page.getByTestId("site-mode-dream").click();
  await page.getByTestId("rooms-plot-width").fill("6");
  await page.getByTestId("rooms-plot-depth").fill("6");
  await page.getByTestId("map-continue").click();
  await page.getByTestId("generate-layouts").click();
  await expect(page.getByTestId("nofit-bigger-plot")).toBeVisible();
  await page.getByTestId("nofit-bigger-plot").click();
  await expect(page.getByTestId("step-map")).toHaveAttribute("aria-current", "step");
  await expect(page.getByTestId("rooms-plot-width")).toBeFocused();
  await page.getByTestId("rooms-plot-width").fill("");
  await page.getByTestId("rooms-plot-depth").fill("");
  await page.getByTestId("map-continue").click();
  await page.getByTestId("generate-layouts").click();
  await expect(page.getByTestId("concept-board").locator(".layout-card")).toHaveCount(5);
});

test("compares two layouts side by side, zoomed together, and works on the one picked", async ({ page }) => {
  await startFromRooms(page);
  await page.getByTestId("generate-layouts").click();
  await expect(page.getByTestId("concept-board").locator(".layout-card:not(.is-loading)")).toHaveCount(5);
  await page.getByTestId(/^open-concept-/).first().click();
  const first = (await page.getByTestId("current-concept").textContent())!;

  await page.getByTestId("plan-menu").click();
  await expect(page.getByRole("group", { name: "Layouts" })).toBeVisible();
  await page.getByTestId("compare-plans").click();
  const compare = page.getByTestId("plan-compare");
  await expect(compare).toBeVisible();
  await expect(page.getByTestId("compare-metrics")).toContainText("Floor area");
  await expect(page.getByTestId("compare-use-left")).toContainText("Keep working on this one");
  await expect(page.getByTestId("step-refine")).toHaveAttribute("aria-current", "step");
  await page.waitForTimeout(300);
  await page.screenshot({ path: "test-results/visual/plan-compare.png" });

  // Zooming one drawing zooms both.
  const box = (await page.getByTestId("compare-media-left").boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.keyboard.down("Control");
  await page.mouse.wheel(0, -200);
  await page.keyboard.up("Control");
  const transforms = await page.locator(".plan-compare-stage").evaluateAll((els) => els.map((e) => (e as HTMLElement).style.transform));
  expect(transforms).toHaveLength(2);
  expect(transforms[0]).toBe(transforms[1]);
  expect(transforms[0]).not.toContain("scale(1)");

  // Escape goes back to the plan, unchanged.
  await page.keyboard.press("Escape");
  await expect(compare).toBeHidden();
  await expect(page.getByTestId("current-concept")).toHaveText(first);

  // Taking the other one on opens it in Refine.
  await page.getByTestId("plan-menu").click();
  await page.getByTestId("compare-plans").click();
  const other = (await page.getByTestId("compare-pick-right").locator("option:checked").textContent())!;
  expect(other).not.toBe(first);
  await page.getByTestId("compare-use-right").click();
  await expect(compare).toBeHidden();
  await expect(page.getByTestId("current-concept")).toHaveText(other);
});

test.describe("The Studio", () => {
  test("shows a tile per room, sizes and places one, takes it out, and undoes it", async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await freshHome(page);
    await page.getByTestId("start-rooms").click();
    const tiles = page.getByTestId("studio-tiles");
    await expect(tiles).toBeVisible();
    await expect(page.getByTestId("tile-double_bedroom-2")).toBeVisible();
    await expect(page.getByTestId("mix-bar")).toContainText("0% placed by you");
    await expect(page.getByTestId("rooms-preview-facts")).toContainText("Total");

    // Dragging a tile places that very room.
    const plan = page.getByTestId("rooms-drop").locator("svg").first();
    const box = (await plan.boundingBox())!;
    await page.getByTestId("tile-double_bedroom-2").dragTo(plan, { targetPosition: { x: box.width * 0.2, y: box.height * 0.8 } });
    await expect(page.getByTestId("placement-double_bedroom#2")).toBeVisible();
    await expect(page.getByTestId("mix-bar")).not.toContainText("0% placed by you");

    // Its editor sizes every bedroom.
    await page.getByTestId("tile-menu-double_bedroom-1").click();
    await page.getByTestId("tile-size-double_bedroom-1-L").click();
    await expect(page.getByTestId("tile-size-double_bedroom-1-L")).toHaveAttribute("aria-checked", "true");
    expect(((await getProject(page)).brief as { roomSizes?: Record<string, string> }).roomSizes).toEqual({ bedrooms: "generous" });

    // Removing the first double moves the second's placement up to it.
    await page.getByTestId("tile-remove-double_bedroom-1").click();
    await expect(page.getByTestId("tile-double_bedroom-2")).toHaveCount(0);
    const brief = (await getProject(page)).brief as unknown as { rooms: Record<string, number>; placements?: Record<string, unknown> };
    expect(brief.rooms.double_bedroom).toBe(1);
    expect(Object.keys(brief.placements ?? {})).toEqual(["double_bedroom#1"]);

    // Undo brings the room back.
    await page.getByTestId("studio-undo").click();
    await expect(page.getByTestId("tile-double_bedroom-2")).toBeVisible();
    await page.getByTestId("studio-redo").click();
    await expect(page.getByTestId("tile-double_bedroom-2")).toHaveCount(0);

    // The 3D card opens the 3D preview.
    await page.getByTestId("studio-three-card").click();
    await expect(page.getByTestId("rooms-view-3d")).toHaveAttribute("aria-checked", "true");
    expect(errors).toEqual([]);
  });
});


test("reads a picture into the rooms, and changes nothing until it's used", async ({ page }) => {
  // The picture route is answered here: tests never call Claude.
  const rooms = { master_bedroom: 1, double_bedroom: 3, single_bedroom: 0, ensuite: 1, family_bathroom: 2, wc: 0, open_plan: 1, kitchen: 0, kitchen_dining: 0, living_room: 1, dining_room: 0, office: 1, utility: 1, garage: 0 };
  let sent: { kind?: string; mediaType?: string; image?: string } = {};
  await page.route("**/api/design/picture", async (route) => {
    sent = route.request().postDataJSON();
    await route.fulfill({ json: { reply: { reply: "A four-bed L-shaped house.", rooms, houseShape: "L", storeys: 2, notes: ["Timber cladding"] }, model: "test" } });
  });
  await freshHome(page);
  await page.getByTestId("start-rooms").click();
  await page.getByTestId("picture-kind-floor_plan").click();
  await page.getByTestId("picture-input").setInputFiles("public/rooms/master_bedroom.jpg");
  await expect(page.getByTestId("picture-result")).toContainText("A four-bed L-shaped house.");
  await expect(page.getByTestId("picture-result")).toContainText("4 bed, 3 bath");
  expect(sent.kind).toBe("floor_plan");
  expect(sent.mediaType).toBe("image/jpeg");
  expect(sent.image?.length).toBeGreaterThan(1000);
  // Nothing has changed yet.
  expect(((await getProject(page)).brief as unknown as { bedrooms: number }).bedrooms).toBe(3);
  await page.getByTestId("picture-use").click();
  const brief = (await getProject(page)).brief as unknown as { bedrooms: number; houseShape: string; storeys: number; additionalInstructions: string };
  expect(brief).toMatchObject({ bedrooms: 4, houseShape: "L", storeys: 2 });
  expect(brief.additionalInstructions).toContain("Timber cladding");
  await expect(page.getByTestId("tile-double_bedroom-3")).toBeVisible();
});
