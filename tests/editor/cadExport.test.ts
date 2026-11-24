import { describe, expect, it } from "vitest";
import { createPlanDocument } from "@/domain/commands";
import { DEFAULT_BRIEF } from "@/domain/brief/schema";
import { planLayouts } from "@/domain/design/stripPlanner";
import { planToDxf } from "@/editor/rendering/drawing/dxf";
import { ifcGuid, planToIfc } from "@/editor/rendering/drawing/ifc";

const generated = () => {
  const source = createPlanDocument({ id: "x", width: 12, depth: 10 });
  return planLayouts({ intent: { action: "generate_layouts", brief: DEFAULT_BRIEF, count: 1, footprint: "auto" }, source, brief: DEFAULT_BRIEF, idPrefix: "c" }).candidates[0].document;
};

describe("DXF export", () => {
  it("writes an R12 drawing with walls, doors, windows, rooms and labels on their layers", () => {
    const plan = generated();
    const dxf = planToDxf(plan);
    const lines = dxf.split("\n");
    expect(lines.slice(0, 4)).toEqual(["0", "SECTION", "2", "HEADER"]);
    expect(dxf).toContain("AC1009");
    expect(dxf.trimEnd().endsWith("0\nEOF")).toBe(true);
    // Group codes and values alternate: an even number of lines before the final newline.
    expect((lines.length - 1) % 2).toBe(0);
    for (const layer of ["A-WALL", "A-DOOR", "A-GLAZ", "A-AREA", "A-ANNO"]) expect(dxf).toContain(`8\n${layer}\n`);
    // Every room is named, ASCII only.
    for (const room of Object.values(plan.levels[0].rooms)) expect(dxf).toContain(`1\n${room.name}\n`);
    expect(/[^\x00-\x7f]/.test(dxf)).toBe(false);
  });
});

describe("IFC export", () => {
  it("makes stable 22-character GlobalIds", () => {
    expect(ifcGuid("a")).toHaveLength(22);
    expect(ifcGuid("a")).toBe(ifcGuid("a"));
    expect(ifcGuid("a")).not.toBe(ifcGuid("b"));
    expect(ifcGuid("anything")).toMatch(/^[0-3][0-9A-Za-z_$]{21}$/);
  });

  it("writes a storey, a wall per wall with its openings cut and filled, and a space per room", () => {
    const plan = generated();
    const level = plan.levels[0];
    const ifc = planToIfc(plan, { name: "Our house", now: "2026-10-25T00:00:00" });
    expect(ifc.startsWith("ISO-10303-21;")).toBe(true);
    expect(ifc).toContain("FILE_SCHEMA(('IFC4'));");
    const count = (type: string) => (ifc.match(new RegExp(`=${type}\\(`, "g")) ?? []).length;
    const openings = Object.values(level.openings);
    expect(count("IFCBUILDINGSTOREY")).toBe(1);
    expect(count("IFCWALL")).toBe(Object.keys(level.walls).length);
    expect(count("IFCOPENINGELEMENT")).toBe(openings.length);
    expect(count("IFCDOOR")).toBe(openings.filter((o) => o.kind === "door").length);
    expect(count("IFCWINDOW")).toBe(openings.filter((o) => o.kind === "window").length);
    expect(count("IFCRELVOIDSELEMENT")).toBe(openings.length);
    expect(count("IFCSPACE")).toBe(Object.keys(level.rooms).length);
    expect(count("IFCSLAB")).toBe(1);
    // Every reference points at an entity that exists, and ids are unique.
    const defined = new Set([...ifc.matchAll(/^(#\d+)=/gm)].map((m) => m[1]));
    const used = new Set([...ifc.matchAll(/(#\d+)(?!=)/g)].map((m) => m[1]));
    for (const ref of used) expect(defined.has(ref)).toBe(true);
    const guids = [...ifc.matchAll(/\((\'[0-9A-Za-z_$]{22}\')/g)].map((m) => m[1]);
    expect(new Set(guids).size).toBe(guids.length);
    // The same plan writes the same file.
    expect(planToIfc(plan, { name: "Our house", now: "2026-10-25T00:00:00" })).toBe(ifc);
  });
});
