# ADR 0019 — Exterior style presets, palettes and roof pitch

- Status: accepted. Implemented 2026-11-24.
- Builds on: [ADR 0014](0014-pitched-roofs.md)

## Context

The exterior had four wall finishes, three frame finishes and a roof shape, each set one by one, and a style dropdown that only changed the AI photo prompt. A consumer wants to pick "Modern farmhouse" and see the house change.

## Decisions

- **Presets** (`domain/project/exterior.ts`): Modern, Modern farmhouse, Scandinavian, Traditional brick, Coastal, Mediterranean. Each is one bundle: wall finish and colour, frames, front door colour, roof shape, finish and pitch, and the photo style. The Look panel shows them as cards drawn from the same palette as the 3D scene. A card is marked chosen while the look still matches its bundle exactly; no preset id is stored.
- **Palettes.** New wall finishes `painted_brick` and `stone`; frames `grey` and `bronze`; curated `wallColour` (render and painted brick only) and `doorColour` lists. No free colour picker. Colours live in `rendering/three/exteriorPalette.ts`, shared by the scene and the panel.
- **Roof pitch.** `appearance.roofPitch` in degrees, clamped per form (`ROOF_PITCH_RANGE`: hipped 20-45, gabled 20-50), default 35. It drives the 3D roof, the stills and the elevations. Flat roofs have none.
- **Front door.** Doors in outside walls take `doorColour`; inside doors stay off-white. `HouseModel.externalWallIds` carries which walls are outside.
- **Photos.** The prompt names the wall colour, front door, frame colour, pitch ("shallow", "steep") and style. `renderKey` adds colours and pitch only once chosen, and ignores a colour the finish can't take, so photos of looks saved before this stay current.

## Data

All new `appearance` fields are optional, so there is no schema version bump and saved projects load unchanged. The catalogue still cycles the original six styles.

## Domain API for callers (UI, later AI tools)

Pure functions over `Appearance`, all returning a new, consistent look (roof finish suits the shape, pitch in range, colour only where it applies):

- `applyExteriorPreset(appearance, id)`: the preset's whole bundle; the interior style is kept.
- `setExteriorAppearance(appearance, change)`: one validated edit (`exterior`, `wallColour`, `frames`, `doorColour`, `roofForm`, `roofPitch`, `roof`, `exteriorStyle`).
- `matchingPreset(appearance)`, `effectiveRoofPitch`, `clampRoofPitch`, `takesWallColour`, `EXTERIOR_PRESETS`.

In the editor: `editor.applyExteriorPreset(id)` and `editor.setExterior(change)` each record one step; `editor.undoLook()` takes the last one back.

## Not done

- Look changes have their own undo (`undoLook`, shown as a button), not the plan's Undo, because appearance lives outside the plan's history.
- Per-wing pitch; the style presets do not yet add porches, chimneys or dormers.
