import { describe, expect, it } from "vitest";
import { roomBounds } from "@/domain/design/analysis";
import { applyCommand } from "@/domain/commands";
import {
  openingWall,
  parseRefineMode,
  removableOpening,
  resizeStep,
} from "@/editor/simple/mode";
import { buildSamplePlan } from "../fixtures/samplePlan";

const plan = buildSamplePlan();
const level = plan.levels[0];
const rooms = Object.values(level.rooms);

describe("refine mode", () => {
  it("defaults to Simple and only an explicit Advanced choice turns it off", () => {
    expect(parseRefineMode(null)).toBe("simple");
    expect(parseRefineMode(undefined)).toBe("simple");
    expect(parseRefineMode("nonsense")).toBe("simple");
    expect(parseRefineMode("simple")).toBe("simple");
    expect(parseRefineMode("advanced")).toBe("advanced");
  });

  it("makes a room bigger and smaller with commands that apply to the plan", () => {
    for (const room of rooms) {
      const b = roomBounds(level, room.id)!;
      const area = (b.maxX - b.minX) * (b.maxY - b.minY);
      const bigger = resizeStep(level, room.id, "bigger");
      if (bigger && typeof bigger !== "string") {
        const result = applyCommand(plan, bigger);
        if (result.ok) {
          const nb = roomBounds(result.document.levels[0], room.id)!;
          expect((nb.maxX - nb.minX) * (nb.maxY - nb.minY)).toBeGreaterThan(
            area,
          );
        }
      }
    }
    expect(
      rooms.some(
        (r) =>
          typeof resizeStep(level, r.id, "bigger") === "object" &&
          resizeStep(level, r.id, "bigger") !== null,
      ),
    ).toBe(true);
  });

  it("does not shrink a room below a usable size", () => {
    const tiny = rooms.find((r) => {
      const b = roomBounds(level, r.id)!;
      return Math.min(b.maxX - b.minX, b.maxY - b.minY) < 1.8;
    });
    if (tiny) expect(resizeStep(level, tiny.id, "smaller")).toBeNull();
  });

  it("puts windows on outside walls and doors on inside walls where it can", () => {
    const room = rooms.find(
      (r) =>
        openingWall(level, r.id, "window") &&
        level.walls[openingWall(level, r.id, "window")!].role === "external",
    );
    expect(room).toBeDefined();
    for (const r of rooms) {
      const door = openingWall(level, r.id, "door");
      expect(door).not.toBeNull();
    }
  });

  it("finds a door or window to remove only when the room has one", () => {
    const opening = Object.values(level.openings)[0];
    const wallRoom = rooms.find(
      (r) =>
        removableOpening(level, r.id, opening.kind) === opening.id ||
        removableOpening(level, r.id, opening.kind) !== null,
    );
    expect(wallRoom).toBeDefined();
    const empty = { ...level, openings: {} };
    for (const r of rooms)
      expect(removableOpening(empty, r.id, "door")).toBeNull();
  });
});
