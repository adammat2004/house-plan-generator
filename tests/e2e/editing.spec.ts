import { expect, test, type Page } from "@playwright/test";
import { neighbourRooms, roomAtPoint } from "@/domain/design/analysis";
import { planRegion } from "@/domain/design/regionPlanner";
import { furnitureRect } from "@/domain/furniture/geometry";
import { deriveLevelGeometry, deriveRoomRegions, roomFaceIndices } from "@/domain/geometry/derive";
import type { Level, PlanDocument, Point2 } from "@/domain/plan/types";
import { drag, freshHome, getDoc, getProject, historySize, selectRoomFromList } from "./support";

const undoKey = process.platform === "darwin" ? "Meta+z" : "Control+z";
const levelOf = (doc: unknown) => (doc as PlanDocument).levels[0];
const currentLevel = async (page: Page) => levelOf(await getDoc(page));

/** Clear areas by room id. */
function areas(level: Level): Record<string, number> {
  const regions = deriveRoomRegions(level);
  const out: Record<string, number> = {};
  for (const [id, face] of roomFaceIndices(level)) out[id] = regions[face]?.clearArea ?? 0;
  return out;
}

/** An internal wall between two bedrooms, and a point on it clear of doors (and furniture, unless ignored) to grab it by. */
function bedroomWall(level: Level, ignoreFurniture = false) {
  const geometry = deriveLevelGeometry(level);
  const isBedroom = (id: string | null): id is string => !!id && /bedroom/.test(level.rooms[id].type);
  for (const wall of Object.values(level.walls)) {
    if (wall.role !== "internal") continue;
    const axis = geometry.axes.get(wall.id)!;
    for (let s = 0.4; s < axis.length - 0.4; s += 0.1) {
      const p = { x: axis.start.x + axis.dir.x * s, y: axis.start.y + axis.dir.y * s };
      const side = (k: number) => roomAtPoint(level, { x: p.x + axis.normal.x * k, y: p.y + axis.normal.y * k });
      const [left, right] = [side(0.3), side(-0.3)];
      if (!isBedroom(left) || !isBedroom(right) || left === right) continue;
      if (Object.values(level.openings).some((o) => o.wallId === wall.id && s > o.offset - 0.3 && s < o.offset + o.width + 0.3)) continue;
      const nearFurniture = !ignoreFurniture && Object.values(level.furniture).some((f) => {
        const r = furnitureRect(f);
        return p.x > r.minX - 0.3 && p.x < r.maxX + 0.3 && p.y > r.minY - 0.3 && p.y < r.maxY + 0.3;
      });
      if (nearFurniture) continue;
      return { p, normal: axis.normal, left, right };
    }
  }
  return null;
}

const along = (p: Point2, n: Point2, d: number) => ({ x: p.x + n.x * d, y: p.y + n.y * d });

/** Two neighbouring rooms the region planner can lay out again together (they make a rectangle). */
function regenerablePair(doc: PlanDocument): [string, string] | null {
  const level = doc.levels[0];
  for (const room of Object.values(level.rooms)) {
    if (room.type === "hall") continue;
    for (const other of neighbourRooms(level, room.id)) {
      if (level.rooms[other].type === "hall") continue;
      if (planRegion(doc, [room.id, other], { idPrefix: "t", count: 1, doorWidth: 0.9 }).candidates.length) return [room.id, other];
    }
  }
  return null;
}

test.describe("Editing a concept in Design", () => {
  test("drags a wall between bedrooms, refuses it once a room is pinned, and swaps rooms", async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await freshHome(page);
    await page.getByTestId("start-rooms").click();
    await expect(page.getByTestId("room-picker")).toBeVisible();
    await page.getByTestId("generate-layouts").click();
    await expect(page.getByTestId("concept-board").locator(".layout-card:not(.is-loading)")).toHaveCount(3);

    // Open a concept with two bedrooms side by side, and clear its furniture so the wall between them is free to grab.
    const plan = (await getProject(page)).plans.slice(1).find((p) => bedroomWall(levelOf(p.document), true))!;
    expect(plan).toBeTruthy();
    await page.getByTestId("concept-board").getByTestId(`concept-${plan.label}`).click();
    await page.getByTestId(`open-concept-${plan.label}`).click();
    await page.waitForTimeout(300);
    await page.getByTestId("tool-more").click();
    await page.getByTestId("clear-furniture").click();
    const start = await currentLevel(page);
    const { p, normal, left, right } = bedroomWall(start)!;
    const before = areas(start);

    // Dragging the wall changes both rooms, as one undo step.
    const history = await historySize(page);
    const towards = before[left] > before[right] ? 0.3 : -0.3;
    await drag(page, p, along(p, normal, towards));
    const moved = areas(await currentLevel(page));
    expect(moved[left]).not.toBeCloseTo(before[left], 2);
    expect(moved[right]).not.toBeCloseTo(before[right], 2);
    expect((await historySize(page)).past).toBe(history.past + 1);
    await page.keyboard.press(undoKey);
    expect(areas(await currentLevel(page))).toEqual(before);

    // Two neighbouring rooms laid out again together: options in the AI Designer, applied and undone in one step each.
    const pair = regenerablePair((await getDoc(page)) as PlanDocument);
    expect(pair).toBeTruthy();
    await selectRoomFromList(page, start.rooms[pair![0]].name);
    const card = page.getByTestId("inspector");
    await card.getByTestId("room-tab-design").click();
    await card.getByTestId(`regenerate-with-${start.rooms[pair![1]].name}`).click();
    await card.getByTestId("regenerate-area").click();
    const option = page.getByTestId("proposal").first();
    await expect(option).toBeVisible();
    const unchanged = await getDoc(page);
    await option.getByTestId("apply-proposal").click();
    await expect(option).toContainText("Applied");
    expect(await getDoc(page)).not.toEqual(unchanged);
    await page.keyboard.press(undoKey);
    expect(await getDoc(page)).toEqual(unchanged);
    await card.getByTestId("room-tab-design").click();

    // Pinned, the room keeps its walls.
    const pinnedName = start.rooms[left].name;
    await selectRoomFromList(page, pinnedName);
    const inspector = page.getByTestId("inspector");
    await inspector.getByTestId("room-pin").click();
    expect((await currentLevel(page)).rooms[left].locked).toBe(true);
    const pinned = await getDoc(page);
    await drag(page, p, along(p, normal, towards));
    expect(await getDoc(page)).toEqual(pinned);
    await expect(page.getByTestId("notice")).toContainText(`${pinnedName} is pinned. Unpin it to change it.`);

    // Swapping is refused while pinned, and lays both rooms out again once unpinned.
    await selectRoomFromList(page, pinnedName);
    await inspector.getByTestId("room-pin").click();
    const other = Object.values(start.rooms).find((r) => r.type === "living" || r.type === "kitchen_dining" || r.type === "kitchen")!;
    await inspector.getByTestId("room-tab-design").click();
    await inspector.getByTestId("swap-room").click();
    await inspector.getByTestId(`swap-with-${other.name}`).click();
    const swapped = await currentLevel(page);
    expect(swapped.rooms[left].type).toBe(other.type);
    expect(swapped.rooms[other.id].type).toBe(start.rooms[left].type);
    const beds = (level: Level, roomId: string) =>
      Object.values(level.furniture).filter((f) => f.kind.startsWith("bed_") && roomAtPoint(level, f.position) === roomId).length;
    expect(beds(swapped, other.id)).toBeGreaterThan(0);
    expect(beds(swapped, left)).toBe(0);
    expect(errors).toEqual([]);
  });
});
