import { expect, test } from "@playwright/test";
import { createHouse, freshHome, getDoc, getProject, level } from "./support";

test.describe("Home screen and project library", () => {
  test.beforeEach(async ({ page }) => {
    await freshHome(page);
  });

  test("starts from a template, lists it as a recent project and reopens it", async ({ page }) => {
    await page.getByTestId("template-card").first().click();
    await expect(page.getByTestId("plan-canvas")).toBeVisible();
    await expect(page).toHaveURL(/\/editor\?project=/);
    const project = await getProject(page);
    expect(project.name).toBe("3 Bed Bungalow");
    expect(project.brief.bedrooms).toBe(3);
    const rooms = Object.values(level(await getDoc(page)).rooms);
    expect(rooms.filter((r) => r.type.includes("bedroom"))).toHaveLength(3);

    await page.getByTestId("home-link").click();
    const card = page.getByTestId("project-card");
    await expect(card).toHaveCount(1);
    await expect(card).toContainText("3 Bed Bungalow");
    await card.getByRole("link").click();
    await expect(page.getByTestId("plan-canvas")).toBeVisible();
    expect((await getProject(page)).name).toBe("3 Bed Bungalow");
  });

  test("keeps several projects apart, newest edited first, and searches them", async ({ page }) => {
    await page.getByTestId("start-dimensions").click();
    await createHouse(page, { name: "Cottage", width: "7" });
    await page.getByTestId("home-link").click();

    await page.getByTestId("start-dimensions").click();
    // The form starts fresh rather than showing the last project's values.
    await expect(page.getByTestId("new-project-name")).toHaveValue("My House");
    await createHouse(page, { name: "Farmhouse", width: "12" });
    expect(level(await getDoc(page)).envelope.wallIds).toHaveLength(4);
    await page.getByTestId("home-link").click();

    const cards = page.getByTestId("project-card");
    await expect(cards).toHaveCount(2);
    await expect(cards.nth(0)).toContainText("Farmhouse");
    await expect(cards.nth(1)).toContainText("Cottage");

    await page.getByTestId("project-search").fill("cott");
    await expect(cards).toHaveCount(1);
    await expect(cards).toContainText("Cottage");
    await page.getByTestId("project-search").fill("nothing like this");
    await expect(page.getByTestId("no-results")).toBeVisible();
    await page.getByTestId("project-search").fill("");

    // Each project reopens with its own plan.
    await cards.filter({ hasText: "Cottage" }).getByRole("link").click();
    await expect(page.getByTestId("plan-canvas")).toBeVisible();
    expect((await getProject(page)).name).toBe("Cottage");
  });

  test("renames, duplicates and deletes projects from the card menu", async ({ page }) => {
    await page.getByTestId("start-scratch").click();
    await expect(page.getByTestId("method-scratch")).toHaveAttribute("aria-checked", "true");
    await page.getByTestId("new-project-submit").click();
    await expect(page.getByTestId("plan-canvas")).toBeVisible();
    await expect(page.getByTestId("tool-wall")).toHaveAttribute("aria-pressed", "true");
    await page.getByTestId("home-link").click();

    const cards = page.getByTestId("project-card");
    await expect(cards.first()).toContainText("My House");
    await cards.first().getByLabel(/Actions for/).click();
    await page.getByRole("menuitem", { name: "Rename…" }).click();
    await page.getByRole("dialog").getByLabel("Project name").fill("Studio");
    await page.getByRole("button", { name: "Rename", exact: true }).click();
    await expect(cards.first()).toContainText("Studio");

    await cards.first().getByLabel(/Actions for/).click();
    await page.getByRole("menuitem", { name: "Duplicate" }).click();
    await expect(cards).toHaveCount(2);
    await expect(page.getByText("Studio copy")).toBeVisible();

    await cards.filter({ hasText: "Studio copy" }).getByLabel(/Actions for/).click();
    await page.getByRole("menuitem", { name: "Delete…" }).click();
    await page.getByTestId("confirm-delete").click();
    await expect(cards).toHaveCount(1);
    await expect(cards).toContainText("Studio");

    // The library survives a reload.
    await page.reload();
    await expect(cards).toHaveCount(1);
  });

  test("records project details and previews the outline before creating", async ({ page }) => {
    await page.getByTestId("new-project").click();
    await expect(page.getByTestId("new-project-page")).toBeVisible();
    await page.getByTestId("method-dimensions").click();
    await page.getByTestId("new-width").fill("12");
    await page.getByTestId("new-depth").fill("9");
    const preview = page.getByTestId("new-project-preview");
    await expect(preview).toContainText("12.00 × 9.00 m outside");
    await page.getByTestId("new-width").fill("-1");
    await expect(preview).toContainText("Width must be a positive number");
    await page.getByTestId("new-width").fill("12");

    // Location and project type are folded under More details.
    await page.getByTestId("new-more").locator("summary").click();
    await page.getByTestId("new-project-location").selectOption("ireland");
    await page.getByRole("checkbox", { name: /Extension/ }).click();
    await expect(page.getByTestId("new-more")).toContainText("Ireland · Extension");
    await createHouse(page, { name: "Kitchen extension" });
    const project = (await getProject(page)) as unknown as { name: string; details: unknown };
    expect(project.name).toBe("Kitchen extension");
    expect(project.details).toEqual({ location: "ireland", type: "extension" });
  });

  test("imports a project file as a new project and reports bad files", async ({ page }) => {
    await page.getByTestId("template-card").nth(3).click();
    await expect(page.getByTestId("plan-canvas")).toBeVisible();
    await page.getByTestId("export-menu").click();
    const downloadPromise = page.waitForEvent("download");
    await page.getByTestId("export-json").click();
    const path = await (await downloadPromise).path();
    await page.getByTestId("home-link").click();

    await page.getByTestId("start-import").click();
    const input = page.getByTestId("new-import-input");
    await input.setInputFiles({ name: "broken.json", mimeType: "application/json", buffer: Buffer.from("{ nope") });
    await expect(page.getByTestId("new-project-form")).toContainText("not valid JSON");
    await page.getByTestId("new-project-submit").click();
    await expect(page.getByTestId("new-project-form").getByRole("alert")).toContainText("Choose a project file");

    await input.setInputFiles(path!);
    await expect(page.getByTestId("new-project-name")).toHaveValue("1 Bed Annexe");
    await expect(page.getByTestId("new-project-preview")).toContainText("m outside");
    await page.getByTestId("new-project-submit").click();
    await expect(page.getByTestId("plan-canvas")).toBeVisible();
    await page.getByTestId("home-link").click();
    await expect(page.getByTestId("project-card")).toHaveCount(2);
  });

  test("explains a missing project instead of opening an empty editor", async ({ page }) => {
    await page.goto("/editor?project=does-not-exist");
    await expect(page.getByTestId("project-unavailable")).toContainText("doesn't exist");
    await page.getByRole("link", { name: "Back to projects" }).click();
    await expect(page.getByTestId("no-projects")).toBeVisible();
  });
});
