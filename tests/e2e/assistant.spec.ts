import { expect, test, type Page } from "@playwright/test";
import { freshHome, getDoc, openRoomPicker } from "./support";

/**
 * The assistant in Refine, with its server route mocked: the plan it sends is
 * answered with the same plan and one room renamed, as the tool loop would.
 */
async function openRefine(page: Page) {
  await freshHome(page);
  await page.getByTestId("start-rooms").click();
  await openRoomPicker(page);
  await page.getByTestId("generate-layouts").click();
  await expect(page.getByTestId("concept-board").locator(".layout-card")).toHaveCount(5);
  await page.getByTestId(/^open-concept-/).click();
  await expect(page.getByTestId("step-refine")).toHaveAttribute("aria-current", "step");
}

const ndjson = (events: unknown[]) => events.map((e) => JSON.stringify(e)).join("\n") + "\n";

test("the assistant changes the plan, lists what it did, and undoes it", async ({ page }) => {
  await page.route("**/api/design/agent", async (route) => {
    if (route.request().method() === "GET") return route.fulfill({ json: { available: true } });
    const { document } = route.request().postDataJSON();
    const level = document.levels[0];
    const [id] = Object.keys(level.rooms);
    level.rooms[id].name = "Reading nook";
    const summary = `Renamed to "Reading nook".`;
    return route.fulfill({
      contentType: "application/x-ndjson",
      body: ndjson([
        { type: "thinking" },
        { type: "tool", name: "rename_room", ok: true, text: summary },
        {
          type: "result",
          result: {
            reply: "I've renamed that room.",
            document,
            changes: [{ tool: "rename_room", summary, roomIds: [id] }],
            failures: [],
            unsupported: [{ request: "paint it blue", reason: "I can't change colours yet." }],
            stopped: "done",
            iterations: 2,
          },
        },
      ]),
    });
  });
  await openRefine(page);
  await page.getByTestId("open-ai").click();
  await expect(page.getByTestId("ai-tab-assistant")).toHaveAttribute("aria-selected", "true");

  await page.getByTestId("assistant-input").fill("rename a room and paint it blue");
  await page.getByTestId("assistant-send").click();
  await expect(page.getByTestId("assistant-reply")).toHaveText("I've renamed that room.");
  await expect(page.getByTestId("assistant-changes")).toContainText("Reading nook");
  await expect(page.getByTestId("assistant-unsupported")).toContainText("paint it blue");
  const names = async () => (await getDoc(page)).levels[0] && Object.values((await getDoc(page)).levels[0].rooms).map((r) => r.name);
  expect(await names()).toContain("Reading nook");

  await page.getByTestId("assistant-undo").click();
  expect(await names()).not.toContain("Reading nook");
  await expect(page.getByTestId("assistant-redo")).toBeVisible();
  await page.getByTestId("assistant-redo").click();
  expect(await names()).toContain("Reading nook");
  await page.getByTestId("assistant-keep").click();
  await expect(page.getByTestId("assistant-keep")).toHaveCount(0);
});

test("a request that changes nothing says so", async ({ page }) => {
  await page.route("**/api/design/agent", async (route) => {
    if (route.request().method() === "GET") return route.fulfill({ json: { available: true } });
    const { document } = route.request().postDataJSON();
    return route.fulfill({
      contentType: "application/x-ndjson",
      body: ndjson([{ type: "result", result: { reply: "I can't do that yet.", document, changes: [], failures: [], unsupported: [], stopped: "done", iterations: 1 } }]),
    });
  });
  await openRefine(page);
  await page.getByTestId("open-ai").click();
  await page.getByTestId("assistant-input").fill("add a swimming pool");
  await page.getByTestId("assistant-input").press("Enter");
  await expect(page.getByTestId("assistant-no-changes")).toBeVisible();
  await expect(page.getByTestId("assistant-undo")).toHaveCount(0);
});

test("without an AI key the assistant says it's unavailable and the quick chat still works", async ({ page }) => {
  await page.route("**/api/design/agent", (route) => route.fulfill({ status: 503, json: { available: false } }));
  await openRefine(page);
  await page.getByTestId("open-ai").click();
  await expect(page.getByTestId("ai-tab-chat")).toHaveAttribute("aria-selected", "true");
  await page.getByTestId("ai-tab-assistant").click();
  await expect(page.getByTestId("assistant-unavailable")).toBeVisible();
  await expect(page.getByTestId("assistant-input")).toBeDisabled();
  await page.getByRole("button", { name: "Use the quick chat" }).click();
  await expect(page.getByTestId("ai-input")).toBeVisible();
});

test("the assistant is docked in every step and says where it can't edit yet", async ({ page }) => {
  await page.route("**/api/design/agent", (route) => route.fulfill({ json: { available: true } }));
  await openRefine(page);
  for (const step of ["step-explore", "step-requirements", "step-map", "step-review"]) {
    await page.getByTestId(step).click();
    const open = page.getByTestId("open-ai");
    if (await open.isVisible()) await open.click();
    await expect(page.getByTestId("ai-panel")).toBeVisible();
    await expect(page.getByTestId("assistant-step-note")).toContainText("can't make changes");
    await expect(page.getByTestId("assistant-input")).toBeDisabled();
  }
  await page.getByTestId("step-refine").click();
  await expect(page.getByTestId("assistant-step-note")).toHaveCount(0);
  await expect(page.getByTestId("assistant-input")).toBeEnabled();
});
