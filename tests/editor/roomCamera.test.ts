import { describe, expect, it } from "vitest";
import { DEFAULT_BRIEF } from "@/domain/brief/schema";
import { roomAtPoint } from "@/domain/design/analysis";
import { planLayouts } from "@/domain/design/stripPlanner";
import { backDirection, furnitureRect } from "@/domain/furniture/geometry";
import { exteriorCameraPose, roomCameraPose } from "@/editor/rendering/scene/roomCamera";
import { level, newHouse } from "../helpers";

const plans = () =>
  planLayouts({ intent: { action: "generate_layouts", brief: { ...DEFAULT_BRIEF, bedrooms: 3 }, count: 3, footprint: "auto" }, source: newHouse(), brief: DEFAULT_BRIEF, idPrefix: "c" }).candidates.map(
    (c) => level(c.document),
  );

describe("room cameras", () => {
  it("stands inside each room, clear of furniture, at about eye height", () => {
    for (const lvl of plans()) {
      for (const room of Object.values(lvl.rooms)) {
        const pose = roomCameraPose(lvl, room.id, 4 / 3);
        expect(pose).not.toBeNull();
        expect(roomAtPoint(lvl, pose!.eye)).toBe(room.id);
        expect(pose!.eye.z).toBeCloseTo(1.45);
        expect(pose!.vfov).toBeGreaterThan(30);
        expect(pose!.vfov).toBeLessThan(90);
        if (room.type === "hall") continue;
        for (const item of Object.values(lvl.furniture)) {
          const r = furnitureRect(item);
          const inItem = pose!.eye.x > r.minX && pose!.eye.x < r.maxX && pose!.eye.y > r.minY && pose!.eye.y < r.maxY;
          expect(inItem).toBe(false);
        }
      }
    }
  });

  it("looks at the bed head in a bedroom", () => {
    const lvl = plans()[0];
    const bedroom = Object.values(lvl.rooms).find((r) => r.type === "primary_bedroom")!;
    const bed = Object.values(lvl.furniture).find((f) => f.kind.startsWith("bed_") && roomAtPoint(lvl, f.position) === bedroom.id)!;
    const pose = roomCameraPose(lvl, bedroom.id, 4 / 3)!;
    const view = { x: pose.target.x - pose.eye.x, y: pose.target.y - pose.eye.y };
    const back = backDirection(bed.rotation);
    // The camera looks the way the bed's back faces: at its headboard wall.
    expect(view.x * back.x + view.y * back.y).toBeGreaterThan(0);
  });

  it("frames the house from the garden side", () => {
    const lvl = plans()[0];
    const pose = exteriorCameraPose(lvl, 16 / 9);
    expect(pose.eye.y).toBeGreaterThan(pose.target.y);
    expect(roomCameraPose(lvl, "missing", 1)).toBeNull();
  });
});
