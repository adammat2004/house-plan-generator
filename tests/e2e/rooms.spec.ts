import { readFileSync } from "node:fs";
import { expect, test, type Page } from "@playwright/test";
import { freshHome, getProject, level } from "./support";

/** Home → Pick your rooms → the editor's Rooms step. */
async function startFromRooms(page: Page) {
  await freshHome(page);
  await page.getByTestId("start-rooms").click();
  await expect(page.getByTestId("rooms-fields")).toBeVisible();
  await page.getByTestId("new-project-submit").click();
  await expect(page.getByTestId("room-picker")).toBeVisible();
  await expect(page.getByTestId("workspace-brief")).toHaveAttribute("aria-checked", "true");
}

test.describe("Pick your rooms", () => {
  test("picks rooms beside a live 3D preview, then generates layouts sized from them", async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await startFromRooms(page);

    // A typical family home is picked to start with, and previewed in 3D.
    await expect(page.getByTestId("pick-master_bedroom-count")).toHaveText("1");
    await expect(page.getByTestId("pick-double_bedroom-count")).toHaveText("2");
    await expect(page.getByTestId("rooms-3d")).toBeVisible();
    await expect(page.getByTestId("rooms-preview-facts")).toContainText("3 bed");

    // Picking rooms updates the preview.
    await page.getByTestId("pick-single_bedroom-inc").click();
    await page.getByTestId("pick-office-check").check({ force: true });
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
    await page.getByTestId("rooms-view-split").click();
    await expect(page.getByTestId("rooms-preview").locator("svg").first()).toBeVisible();
    await page.waitForTimeout(800);
    await page.screenshot({ path: "test-results/visual/rooms-step.png" });

    // Next generates layouts and opens them in Design.
    await page.getByTestId("next-step").click();
    const board = page.getByTestId("concept-board");
    await expect(board).toBeVisible();
    await expect(board.locator(".concept-card")).toHaveCount(3);
    const project = await getProject(page);
    expect((project as unknown as { sizing: unknown }).sizing).toEqual({ footprint: "auto" });
    expect((project.brief as unknown as { rooms: Record<string, number> }).rooms).toMatchObject({ master_bedroom: 1, double_bedroom: 2, single_bedroom: 1, office: 1, open_plan: 1 });
    for (const plan of project.plans.slice(1)) {
      const rooms = Object.values(level(plan.document).rooms);
      expect(rooms.filter((r) => r.type === "bedroom" || r.type === "primary_bedroom")).toHaveLength(4);
      expect(rooms.filter((r) => r.type === "office")).toHaveLength(1);
    }
    await expect(board.locator(".card-photo img").first()).toBeVisible({ timeout: 15000 });

    // The concept's rooms as pictures; photo renders need a key, which tests never have.
    await page.getByTestId("detail-tab-rooms").click();
    const gallery = page.getByTestId("room-gallery");
    await expect(gallery.getByTestId("render-setup")).toBeVisible();
    await expect(gallery.getByTestId("render-rooms")).toBeDisabled();
    await expect(gallery.locator("img[data-kind=still]").first()).toBeVisible({ timeout: 15000 });
    await gallery.locator(".photo-tile").nth(1).click();
    await expect(page.getByTestId("lightbox")).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.getByTestId("lightbox")).toBeHidden();

    // Generate more stays sized from the rooms.
    await page.getByTestId("generate-more").click();
    await expect(page.getByTestId("notice")).toContainText("more layout");
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
    await page.getByTestId("rooms-render-photo").click();
    await expect(page.getByTestId("rooms-photo")).toBeVisible();
    expect(posts).toBe(1);
    await page.getByTestId("rooms-photo-back").click();
    await expect(page.getByTestId("rooms-3d")).toBeVisible();

    await page.getByTestId("generate-layouts").click();
    await expect(page.getByTestId("concept-board")).toBeVisible();
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
    await page.keyboard.press("3");
    // After a reload the board opens on the recommended concept; the photos belong to Plan A.
    await page.getByTestId("concept-board").getByTestId("concept-Plan A").click();
    await page.getByTestId("detail-tab-rooms").click();
    await expect(page.getByTestId("room-gallery").locator("img[data-kind=photo]")).toHaveCount(tiles, { timeout: 10000 });

    // A new interior style makes the room photos out of date, not the exterior.
    await page.getByTestId("interior-style").selectOption("coastal");
    await expect(page.getByTestId("room-gallery").getByTestId("photo-stale")).toHaveCount(tiles - 1);
    await expect(page.getByTestId("room-gallery").getByTestId("render-rooms")).toHaveText(new RegExp(`Render ${tiles - 1} more`));
  });
});
