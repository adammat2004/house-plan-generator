import { expect, test, type Page } from "@playwright/test";
import { AXIS, clickAt, createHouse, drawWall, freshEditor, freshHome, getDoc, getProject, type DocShape } from "./support";

type Plan = DocShape & { levels: Array<DocShape["levels"][number] & { id: string; name: string; elevation: number }>; staircases?: Record<string, { id: string; fromLevelId: string; toLevelId: string }> };

const plan = async (page: Page) => (await getDoc(page)) as Plan;
const internal = (doc: Plan, i: number) => Object.values(doc.levels[i].walls).filter((w) => w.role === "internal");

test.describe("Houses of more than one floor", () => {
  test.beforeEach(async ({ page }) => {
    await freshEditor(page);
  });

  test("adds a floor, draws on it, puts in stairs and shows two storeys in 3D", async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));
    page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
    await createHouse(page);
    // No stairs tool until there's a floor to go up to.
    await expect(page.getByTestId("tool-stairs")).toHaveCount(0);

    await page.getByTestId("add-floor").click();
    let doc = await plan(page);
    expect(doc.levels).toHaveLength(2);
    expect(doc.levels[1].elevation).toBeCloseTo(2.7, 6);
    await expect(page.getByTestId(`floor-${doc.levels[1].id}`)).toHaveAttribute("aria-checked", "true");

    // Walls drawn now go upstairs.
    await drawWall(page, { x: 4, y: AXIS.south }, { x: 4, y: AXIS.north });
    doc = await plan(page);
    expect(internal(doc, 1)).toHaveLength(1);
    expect(internal(doc, 0)).toHaveLength(0);

    // Back downstairs, stairs up against the west wall.
    await page.getByTestId(`floor-${doc.levels[0].id}`).click();
    await page.getByTestId("tool-stairs").click();
    await clickAt(page, { x: 0.9, y: 3 });
    doc = await plan(page);
    const stairs = Object.values(doc.staircases ?? {});
    expect(stairs).toHaveLength(1);
    expect(stairs[0]).toMatchObject({ fromLevelId: doc.levels[0].id, toLevelId: doc.levels[1].id });
    await expect(page.getByTestId("stairs-steps")).toHaveText(/13 of 208 mm/);

    // A wall can't run through them.
    await drawWall(page, { x: 1.1, y: AXIS.south }, { x: 1.1, y: AXIS.north });
    expect(internal(await plan(page), 0)).toHaveLength(0);

    await page.keyboard.press("Shift+Digit2");
    await expect(page.getByTestId("three-view").locator("canvas")).toBeVisible();
    await expect(page.getByTestId("three-view")).toHaveAttribute("aria-label", /^A two-storey house/);
    await page.getByTestId("present-tab-show").click();
    await page.getByTestId(`show-floors-${doc.levels[0].id}`).click();
    await page.getByTestId("display-roof").click();
    await page.getByTestId("show-floors-all").click();
    await page.waitForTimeout(400);
    expect(errors).toEqual([]);
  });

  test("names the plan picture after the floor, and takes a floor out again", async ({ page }) => {
    await createHouse(page, { name: "Semi" });
    await page.getByTestId("add-floor").click();
    const download = page.waitForEvent("download");
    await page.getByTestId("export-menu").click();
    await page.getByTestId("export-png").click();
    expect((await download).suggestedFilename()).toBe("semi-first-floor.png");

    await page.getByTestId("file-menu").click();
    await page.getByTestId("house-settings").click();
    await expect(page.getByTestId("floor-level")).toContainText("2.70 m above the ground floor");
    await page.getByTestId("remove-floor").click();
    expect((await plan(page)).levels).toHaveLength(1);
    await expect(page.getByTestId("add-floor")).toBeVisible();
  });

  test("generates two-storey houses from the rooms, shown floor by floor", async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));
    page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
    await freshHome(page);
    await page.getByTestId("start-rooms").click();
    await expect(page.getByTestId("room-picker")).toBeVisible();
    await expect(page.getByTestId("brief-shape-rectangle")).toBeVisible();

    await page.getByTestId("brief-storeys-2").click();
    await expect(page.getByTestId("brief-storeys-2")).toHaveAttribute("aria-checked", "true");
    // Two-storey houses are rectangular for now, so there's no shape to choose.
    await expect(page.getByTestId("brief-shape-rectangle")).toHaveCount(0);
    // The live preview draws both floors.
    await expect(page.getByTestId("rooms-preview").getByText("First floor")).toBeVisible();
    await page.getByTestId("rooms-view-3d").click();
    await expect(page.getByTestId("rooms-3d")).toBeVisible();

    await page.getByTestId("generate-layouts").click();
    const cards = page.getByTestId("concept-board").locator(".layout-card:not(.is-loading)");
    await expect(cards).toHaveCount(3);
    await expect(cards.first().getByTestId("house-floors")).toBeVisible();
    await expect(cards.first()).toContainText("· 2 storeys");
    const project = await getProject(page);
    for (const p of project.plans.slice(1)) {
      const doc = p.document as Plan;
      expect(doc.levels).toHaveLength(2);
      expect(Object.keys(doc.staircases ?? {})).toHaveLength(1);
    }

    // Refine opens on the ground floor; the first floor is a click away.
    await cards.first().dblclick();
    const doc = await plan(page);
    await expect(page.getByTestId(`floor-${doc.levels[0].id}`)).toHaveAttribute("aria-checked", "true");
    await page.getByTestId(`floor-${doc.levels[1].id}`).click();
    await expect(page.getByTestId(`floor-${doc.levels[1].id}`)).toHaveAttribute("aria-checked", "true");
    await page.keyboard.press("Shift+Digit2");
    await expect(page.getByTestId("three-view")).toHaveAttribute("aria-label", /^A two-storey house/);
    expect(errors).toEqual([]);
  });
});
