import { expect, test } from "@playwright/test";
import { freshHome } from "./support";

/** "Describe your dream home", with its server route mocked: the description comes back as a brief to adjust, then layouts are made from it. */
const brief = {
  bedrooms: 4,
  bathrooms: 2,
  requiredSpaces: ["kitchen", "living", "office"],
  preferences: ["open_plan", "home_office"],
  additionalInstructions: "",
  rooms: { master_bedroom: 1, double_bedroom: 3, ensuite: 1, family_bathroom: 1, open_plan: 1, office: 1 },
  houseShape: "any",
  targetArea: 200,
};

test("a description becomes an editable brief, then five layouts", async ({ page }) => {
  let sent: unknown = null;
  await page.route("**/api/design/brief", async (route) => {
    if (route.request().method() === "GET") return route.fulfill({ json: { available: true } });
    sent = route.request().postDataJSON();
    return route.fulfill({ json: { brief, reply: "A four-bedroom family home of about 200 m².", notes: ["Not in the brief: a swimming pool"], model: "test" } });
  });
  await freshHome(page);
  await page.goto("/start/describe");
  await page.getByTestId("describe-input").fill("4 bed family home, open-plan kitchen, home office, about 200 m², single storey");
  await page.getByTestId("describe-submit").click();
  await expect(page.getByTestId("describe-brief")).toBeVisible();
  expect(sent).toMatchObject({ text: expect.stringContaining("about 200 m²") });
  await expect(page.getByTestId("describe-notes")).toContainText("swimming pool");
  await expect(page.getByTestId("describe-bedrooms-count")).toHaveText("4");
  await expect(page.getByTestId("describe-area")).toHaveValue("200");

  // Editable: one bedroom fewer.
  await page.getByTestId("describe-bedrooms-dec").click();
  await expect(page.getByTestId("describe-bedrooms-count")).toHaveText("3");

  await page.getByTestId("describe-generate").click();
  await expect(page.getByTestId("concept-board").locator(".layout-card")).toHaveCount(5, { timeout: 90_000 });
});

test("a target the rooms can't reach is called out", async ({ page }) => {
  await page.route("**/api/design/brief", async (route) => {
    if (route.request().method() === "GET") return route.fulfill({ json: { available: true } });
    return route.fulfill({ json: { brief: { ...brief, targetArea: 600 }, reply: "A big house.", notes: [], model: "test" } });
  });
  await freshHome(page);
  await page.goto("/start/describe");
  await page.getByTestId("describe-input").fill("a 600 m² house");
  await page.getByTestId("describe-submit").click();
  await expect(page.getByTestId("describe-fit")).toContainText("can't be reached");
});

test("without an AI key the prompt is off and the room picker still works", async ({ page }) => {
  await page.route("**/api/design/brief", (route) => route.fulfill({ json: { available: false } }));
  await freshHome(page);
  await page.goto("/start/describe");
  await expect(page.getByTestId("describe-unavailable")).toBeVisible();
  await expect(page.getByTestId("describe-input")).toHaveCount(0);
  await page.getByTestId("describe-form-link").click();
  await expect(page).toHaveURL(/\/editor\?project=/);
  await expect(page.getByTestId("generate-layouts")).toBeVisible();
});
