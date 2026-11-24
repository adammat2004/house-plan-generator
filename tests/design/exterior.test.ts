import { describe, expect, it } from "vitest";
import { renderKey, renderPrompt, renderRequestSchema, renderViewFor } from "@/domain/design/renderRequest";
import {
  applyExteriorPreset,
  clampRoofPitch,
  effectiveRoofPitch,
  EXTERIOR_PRESET_IDS,
  EXTERIOR_PRESETS,
  matchingPreset,
  setExteriorAppearance,
} from "@/domain/project/exterior";
import { appearanceSchema, DEFAULT_APPEARANCE, loadProjectDocument, NEW_PROJECT_APPEARANCE, projectFromPlan, ROOF_FINISHES_FOR } from "@/domain/project/schema";
import { buildElevations } from "@/editor/rendering/drawing/elevations";
import { buildBuildingModel } from "@/editor/rendering/three/buildingModel";
import { roofTop } from "@/editor/rendering/three/roofModel";
import { createEditorActions, createEditorStores } from "@/editor/state/stores";
import { newHouse } from "../helpers";

const NOW = "2026-11-24T00:00:00Z";

describe("exterior presets", () => {
  it("applies a coherent bundle for every preset", () => {
    for (const id of EXTERIOR_PRESET_IDS) {
      const look = applyExteriorPreset(NEW_PROJECT_APPEARANCE, id);
      expect(appearanceSchema.safeParse(look).success).toBe(true);
      expect(ROOF_FINISHES_FOR[look.roofForm ?? "flat"]).toContain(look.roof);
      expect(look.exteriorStyle).toBe(EXTERIOR_PRESETS[id].style);
      expect(look.doorColour).toBe(EXTERIOR_PRESETS[id].look.doorColour);
      expect(matchingPreset(look)).toBe(id);
    }
  });

  it("keeps the interior style and replaces the old colours", () => {
    const before = { ...NEW_PROJECT_APPEARANCE, interiorStyle: "coastal" as const, wallColour: "sage" as const };
    const look = applyExteriorPreset(before, "traditional_brick");
    expect(look.interiorStyle).toBe("coastal");
    expect(look.wallColour).toBeUndefined();
    expect(look).toMatchObject({ exterior: "brick", roofForm: "hipped", roof: "slate" });
  });

  it("makes each preset a different house", () => {
    const looks = new Set(EXTERIOR_PRESET_IDS.map((id) => JSON.stringify(applyExteriorPreset(undefined, id))));
    expect(looks.size).toBe(EXTERIOR_PRESET_IDS.length);
  });
});

describe("setExteriorAppearance", () => {
  it("keeps the roof finish and pitch valid for the shape", () => {
    const hipped = setExteriorAppearance(NEW_PROJECT_APPEARANCE, { roofPitch: 80 });
    expect(hipped.roofPitch).toBe(45);
    expect(setExteriorAppearance(hipped, { roofPitch: 1 }).roofPitch).toBe(20);
    const flat = setExteriorAppearance(hipped, { roofForm: "flat" });
    expect(flat.roof).toBe("membrane");
    expect(flat.roofPitch).toBeUndefined();
    expect(setExteriorAppearance(flat, { roofForm: "gabled" }).roof).toBe("slate");
  });

  it("drops a wall colour the finish cannot take", () => {
    const painted = setExteriorAppearance(DEFAULT_APPEARANCE, { exterior: "painted_brick", wallColour: "sage" });
    expect(painted.wallColour).toBe("sage");
    expect(setExteriorAppearance(painted, { exterior: "stone" }).wallColour).toBeUndefined();
  });

  it("clamps pitch per roof form and defaults it", () => {
    expect(clampRoofPitch("gabled", 60)).toBe(50);
    expect(clampRoofPitch("flat", 30)).toBeUndefined();
    expect(effectiveRoofPitch(NEW_PROJECT_APPEARANCE)).toBe(35);
    expect(effectiveRoofPitch(DEFAULT_APPEARANCE)).toBeUndefined();
  });

  it("is pure", () => {
    const frozen = Object.freeze({ ...NEW_PROJECT_APPEARANCE });
    expect(() => setExteriorAppearance(frozen, { frames: "bronze" })).not.toThrow();
    expect(frozen.frames).toBe("black");
  });
});

describe("saved projects", () => {
  it("loads a project saved before presets, palettes and pitch, unchanged", () => {
    const legacy = { ...projectFromPlan(newHouse(), { now: NOW }), appearance: { exterior: "brick", frames: "oak", roof: "slate", roofForm: "hipped", exteriorStyle: "craftsman" } };
    const loaded = loadProjectDocument(JSON.parse(JSON.stringify(legacy)), NOW);
    expect(loaded.ok && loaded.project.appearance).toEqual(legacy.appearance);
    expect(loaded.ok && loaded.project.schemaVersion).toBe(1);
  });
});

describe("render keys and prompts", () => {
  const level = newHouse().levels[0];
  const exterior = { kind: "exterior" as const };
  const key = (a: typeof DEFAULT_APPEARANCE) => renderKey(level, exterior, a, "modern");

  it("changes only when the look changes", () => {
    expect(key(NEW_PROJECT_APPEARANCE)).toBe(key({ ...NEW_PROJECT_APPEARANCE }));
    // Choosing nothing new keeps the key of a look saved before colours and pitch.
    expect(key(NEW_PROJECT_APPEARANCE)).toBe(key({ ...NEW_PROJECT_APPEARANCE, wallColour: undefined, roofPitch: undefined }));
    // A colour the finish ignores is not a change.
    expect(key({ ...NEW_PROJECT_APPEARANCE, exterior: "brick", wallColour: "sage" })).toBe(key({ ...NEW_PROJECT_APPEARANCE, exterior: "brick" }));
    const base = key({ ...NEW_PROJECT_APPEARANCE, exterior: "painted_brick" });
    expect(key({ ...NEW_PROJECT_APPEARANCE, exterior: "painted_brick", wallColour: "sage" })).not.toBe(base);
    expect(key({ ...NEW_PROJECT_APPEARANCE, doorColour: "red" })).not.toBe(key(NEW_PROJECT_APPEARANCE));
    expect(key({ ...NEW_PROJECT_APPEARANCE, roofPitch: 25 })).not.toBe(key(NEW_PROJECT_APPEARANCE));
    for (const id of EXTERIOR_PRESET_IDS) expect(key(applyExteriorPreset(NEW_PROJECT_APPEARANCE, id))).not.toBe(key(NEW_PROJECT_APPEARANCE));
  });

  it("does not change with the interior style or other looks outside the exterior", () => {
    expect(key({ ...NEW_PROJECT_APPEARANCE, interiorStyle: "coastal" })).toBe(key(NEW_PROJECT_APPEARANCE));
  });

  it("puts the preset's look in the photo prompt", () => {
    const look = applyExteriorPreset(NEW_PROJECT_APPEARANCE, "coastal");
    const view = renderViewFor(level, exterior, look)!;
    expect(renderRequestSchema.shape.view.safeParse(view).success).toBe(true);
    const prompt = renderPrompt(view, "modern");
    expect(prompt).toMatch(/coastal style/);
    expect(prompt).toMatch(/painted brick walls in pale sky blue/);
    expect(prompt).toMatch(/yellow front door/);
    expect(prompt).toMatch(/grey window frames/);
    expect(prompt).toMatch(/pitched natural slate roof/);
    expect(renderPrompt(renderViewFor(level, exterior, applyExteriorPreset(undefined, "modern"))!, "modern")).toMatch(/dark flat roof/);
  });
});

describe("roof pitch in 3D and elevations", () => {
  const plan = newHouse();
  const top = (pitch?: number) => roofTop(buildBuildingModel(plan, { cutaway: false, roof: true, dimensions: false, landscape: false, furniture: false, roofForm: "hipped", roofPitch: pitch }).roofs ?? []);

  it("raises the roof with the pitch", () => {
    expect(top(45)).toBeGreaterThan(top(35));
    expect(top(20)).toBeLessThan(top(35));
    expect(top(undefined)).toBeCloseTo(top(35), 6);
  });

  it("shows in the elevations", () => {
    expect(JSON.stringify(buildElevations(plan, "gabled", 45))).not.toBe(JSON.stringify(buildElevations(plan, "gabled", 25)));
  });

  it("marks doors in outside walls, for the front door colour", () => {
    const model = buildBuildingModel(plan, { cutaway: false, roof: false, dimensions: false, landscape: false, furniture: false });
    const doors = model.boxes.filter((b) => b.kind === "door");
    expect(model.externalWallIds?.size).toBeGreaterThan(0);
  });
});

describe("applying a preset in the editor", () => {
  it("is one step that undoLook takes back", () => {
    const stores = createEditorStores(projectFromPlan(newHouse(), { now: NOW }));
    const actions = createEditorActions(stores);
    const before = stores.project.getState().appearance;
    expect(stores.session.getState().view3d.lookUndoDepth).toBe(0);
    actions.applyExteriorPreset("farmhouse");
    expect(stores.project.getState().appearance).toMatchObject({ exterior: "white_render", roofForm: "gabled", exteriorStyle: "farmhouse" });
    expect(stores.session.getState().view3d.lookUndoDepth).toBe(1);
    expect(actions.undoLook()).toBe(true);
    expect(stores.project.getState().appearance).toEqual(before ?? DEFAULT_APPEARANCE);
    expect(actions.undoLook()).toBe(false);
  });

  it("ignores a change that changes nothing", () => {
    const stores = createEditorStores(projectFromPlan(newHouse(), { now: NOW }));
    const actions = createEditorActions(stores);
    actions.applyExteriorPreset("modern");
    actions.applyExteriorPreset("modern");
    expect(stores.session.getState().view3d.lookUndoDepth).toBe(1);
  });
});
