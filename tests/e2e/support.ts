import { expect, type Page } from "@playwright/test";

export interface Pt {
  x: number;
  y: number;
}

/** Plan document as exposed by the editor's test hook (structure only). */
export interface DocShape {
  name: string;
  levels: Array<{
    vertices: Record<string, Pt>;
    walls: Record<string, { id: string; role: string; startVertexId: string; endVertexId: string; thickness: number }>;
    openings: Record<string, { id: string; wallId: string; kind: string; offset: number; width: number }>;
    rooms: Record<string, { id: string; name: string; type: string; targetArea?: number }>;
    furniture: Record<string, { id: string; kind: string; position: Pt; rotation: number; width: number; depth: number }>;
    envelope: { wallIds: string[] };
    rearWallId: string | null;
  }>;
}

export const AXIS = { west: 0.15, east: 7.85, south: 0.15, north: 9.85 } as const;

/** Clears browser storage and opens the new-project page with "Enter dimensions" chosen. */
export async function freshEditor(page: Page) {
  await freshHome(page);
  await page.getByTestId("start-dimensions").click();
  await expect(page.getByTestId("new-project-form")).toBeVisible();
}

/** Clears browser storage and loads the home screen. */
export async function freshHome(page: Page) {
  await page.goto("/");
  await page.evaluate(
    () =>
      new Promise<void>((resolve) => {
        const req = indexedDB.deleteDatabase("floor-plan-editor");
        req.onsuccess = req.onerror = req.onblocked = () => resolve();
      }),
  );
  await page.reload();
  await expect(page.getByTestId("no-projects")).toBeVisible();
}

/** Fills in the new-project page and waits for the editor to open the project. */
export async function createHouse(page: Page, values: Partial<Record<"width" | "depth" | "name", string>> = {}) {
  if (values.name) await page.getByTestId("new-project-name").fill(values.name);
  if (values.width) await page.getByTestId("new-width").fill(values.width);
  if (values.depth) await page.getByTestId("new-depth").fill(values.depth);
  await page.getByTestId("new-project-submit").click();
  await expect(page.getByTestId("plan-canvas")).toBeVisible();
  await page.waitForTimeout(150);
}

export const getDoc = (page: Page) => page.evaluate(() => window.__floorPlanEditor!.getDocument() as unknown) as Promise<DocShape>;
export interface ProjectShape {
  name: string;
  activePlanId: string;
  brief: { bedrooms: number; bathrooms: number; preferences: string[]; requiredSpaces: string[] };
  appearance?: { exterior: string; frames: string; roof: string };
  plans: Array<{ id: string; label: string; parentId: string | null; origin: { kind: string }; document: DocShape }>;
}

export const getProject = (page: Page) => page.evaluate(() => window.__floorPlanEditor!.getProject() as unknown) as Promise<ProjectShape>;
export const historySize = (page: Page) => page.evaluate(() => window.__floorPlanEditor!.historySize());

export async function toScreen(page: Page, p: Pt): Promise<Pt> {
  const box = (await page.getByTestId("plan-canvas").boundingBox())!;
  const s = await page.evaluate((w) => window.__floorPlanEditor!.worldToScreen(w), p);
  return { x: box.x + s.x, y: box.y + s.y };
}

export async function clickAt(page: Page, p: Pt) {
  const s = await toScreen(page, p);
  await page.mouse.move(s.x, s.y, { steps: 3 });
  await page.mouse.click(s.x, s.y);
  await page.waitForTimeout(60);
}

export async function hover(page: Page, p: Pt) {
  const s = await toScreen(page, p);
  await page.mouse.move(s.x, s.y, { steps: 3 });
  await page.waitForTimeout(60);
}

export async function drag(page: Page, from: Pt, to: Pt, steps = 12) {
  const a = await toScreen(page, from);
  const b = await toScreen(page, to);
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  await page.mouse.move(b.x, b.y, { steps });
  await page.waitForTimeout(60);
  await page.mouse.up();
  await page.waitForTimeout(60);
}

/** Draws one wall with the wall tool, then ends the chain. */
export async function drawWall(page: Page, from: Pt, to: Pt) {
  await page.getByTestId("tool-wall").click();
  await clickAt(page, from);
  await clickAt(page, to);
  await page.keyboard.press("Escape");
}

export const level = (doc: DocShape) => doc.levels[0];
export const internalWalls = (doc: DocShape) => Object.values(level(doc).walls).filter((w) => w.role === "internal");
export const vertexOf = (doc: DocShape, wallId: string, end: "start" | "end") => {
  const wall = level(doc).walls[wallId];
  return level(doc).vertices[end === "start" ? wall.startVertexId : wall.endVertexId];
};

/** Opens the house card (outside dimensions) from the project menu. */
export async function openHouse(page: Page) {
  await page.getByTestId("file-menu").click();
  await page.getByTestId("house-settings").click();
  await expect(page.getByTestId("house-width")).toBeVisible();
}

/** Opens the floating Layers panel (the "Plan contents" list). */
export async function openLayers(page: Page) {
  const nav = page.getByRole("navigation", { name: "Plan contents" });
  if (!(await nav.isVisible())) {
    await page.getByTestId("tool-more").click();
    await page.getByTestId("toggle-layers").click();
  }
  await expect(nav).toBeVisible();
  return nav;
}

/**
 * Selects a room from the Layers list, then closes it. Generated concepts
 * come furnished, so clicking a room's centre can land on its furniture.
 */
export async function selectRoomFromList(page: Page, name: string) {
  const layers = await openLayers(page);
  await layers.getByRole("button", { name: new RegExp(`^${name.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&")}`) }).click();
  await page.getByTestId("tool-more").click();
  await page.getByTestId("toggle-layers").click();
}
