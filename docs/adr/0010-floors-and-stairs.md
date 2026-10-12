# ADR 0010 — Floors and stairs

- Status: accepted. Implemented 2026-10-11.
- Date: 2026-10-11
- Builds on: [ADR 0001](0001-plan-document-and-geometry.md), [ADR 0007](0007-orthogonal-outlines.md), [ADR 0008](0008-zone-layouts-and-plan-sense.md)

## Context

Every house was single-storey. `PlanDocument.levels` was already an array, but:
- validation refused more than one floor;
- `applyCommand` and about 120 other reads used `levels[0]`;
- 3D built every wall from z = 0;
- the Claude prompt and the Gemini photo request both said "single-storey".

The user wants two-storey houses in the editor, in 3D and from the generator.

The user's choices:
- **Upper floor outline.** An upper floor starts as a copy of the floor below. It can be pulled in, for example to leave a single-storey rear extension, but it never overhangs. Lower roofs left exposed are flat.
- **How many floors.** The code works for any number of floors, and the editor allows three. The generator makes one or two.
- **Not in scope:** basements.

## Decisions

### The document (schema v5)

- **New fields.** `Level.floorThickness?` (default 0.3 m) and `PlanDocument.staircases?`. Both are optional, so single-storey files serialise exactly as before and the golden fingerprints don't change. The 4→5 migration only bumps the version.
- **Elevation is stored but never free.** It breaks the rule "derived data is never stored" (ADR 0001) because files and 3D read it directly.
  - Each floor's elevation is the elevation of the floor below, plus that floor's wall height, plus this floor's thickness.
  - `restack` sets it on every commit, and `validateStack` refuses a document where it disagrees.
- **Ids are unique across the whole document,** floors and stairs included. `IdSource` collects every id in the document, because ids made without a prefix (`wall-1`) would otherwise clash between floors.
- `plan/levels.ts` holds the floor helpers: `groundLevel`, `levelOf(doc, entityId)`, `storeyName`, `floorToFloor`, `restack`, `levelView` and `spliceLevel`.

### Commands

- **Which floor a command applies to.** `CommandBase.levelId?` resolves in this order:
  1. the `levelId` given;
  2. the floor holding the entity the command names;
  3. the ground floor.

  Existing callers are unchanged. The editor adds `levelId` only to commands that create something without naming an entity: `addWall`, `addFurniture`, `createOutline`, and `replaceFurniture` with nothing removed.
- **New commands:** `addLevel`, `removeLevel`, `updateLevel`, `addStairs`, `updateStairs` and `deleteStairs`.
  - `addLevel` copies the top floor's outline with fresh ids and nothing inside.
  - `removeLevel` refuses the ground floor and pinned rooms, and trims staircases.
  - `updateLevel` sets the floor's name, ceiling height and floor thickness, moving the floors above.
- **Outline edits carry up** (`commands/stack.ts`, `carryUp`):
  - Pulling an outline wall in pulls in the walls lying on it on the floors above, which would otherwise overhang.
  - Pushing an outline wall out changes only that floor. That is how a single-storey extension is made, and it refines the plan's first idea that every move carries up.
  - Resizing the house resizes each floor that sits flush with the side that moved.
  - Giving a floor a new outline rebuilds the floors above as copies of it. Redrawing an upper floor's outline changes only that floor, which is how a setback is made.
  - `setRearWall` keeps every floor's garden side the same.
- **Checks.** `validateDocument` validates each floor, then runs `validateStack`:
  - between one and three floors;
  - unique ids;
  - elevations;
  - each outline inside the one below (polygon difference);
  - the stairs.

  Messages about another floor start with its name ("On the first floor: …").

### Stairs (`geometry/stairs.ts`, `handlers/stairs.ts`)

- **One record per staircase** at document level: `fromLevelId`→`toLevelId`, with one footprint. The flights stack by construction, and the opening in each floor above is derived, never stored.
- **Shapes:** straight, L and U.
- **Starting sizes** come from the floor-to-floor height: rise at most 0.22 m, going 0.25 m, width 0.9 m, and 0.8 m kept clear at each end. These are starting values, not building regulations.
- **Rotation** follows the furniture convention: 0 means the stairs climb north.
- **Checks.** Stairs must sit inside every floor they serve. No wall may cross them, and both ends must land on floor. Staircases may not overlap, and may not run into a pinned room. A wall edit that would cross stairs is refused.
- **Landings** are rooms of type `hall` named "Landing". There is no new room type.
- **Furniture** keeps off the stairs and their ends through `KeepOut` (`levelKeepOut`), which `roomContext`, furnishing and `furnitureIssues` take. A piece in the way is reported as "It's in the way of the stairs."

### Judging a whole house

- `assessHouse(doc)` sums `assessPlan` over the floors.
- `assessHouseSense(doc)` runs plan sense on each floor, with these differences:
  - the front-door rule applies only to the ground floor;
  - rooms count as reachable through the stairs;
  - a `stairs` rule checks that every upper floor has stairs up to it, and that they leave from and arrive in a hall or landing;
  - two new metrics, `wetStacked` and `groundWc`.

  `STOREY_SENSE_RULES` is kept apart from the plan-sense rules, so the scoreboard snapshot is unchanged.
- Both functions give exactly the single-floor result for a house of one floor.

### Planners on an upper floor

- Room-level planners run unchanged on `levelView(doc, id)`, a one-floor document of that floor. The result is put back with `spliceLevel` and validated.
- Edits made in a view need their own id prefix, because the view can't see the other floors' ids.
- This avoids rewriting about 60 planner reads of `levels[0]`.

### 3D (`editor/rendering/three/buildingModel.ts`)

- **Heights are baked in.** Each floor's elevation goes into box `z0` and floor `z`, not into group transforms, because `exportGlb` clones meshes without their parents' transforms.
- A single-floor document gets exactly `buildHouseModel(levels[0])`.
- **Slabs and roofs.** Floor slabs have stair openings. Each floor gets a roof and parapet only where nothing stands on it.
- **What's shown.** Cutaway applies to the highest floor shown. The Floors control (Ground / First / All) sets `view3d.upTo`.
- **Cameras.** Room cameras stand at the floor's height. Framing covers the full height, and the still of the house from the garden steps back until a tall house fits. Walk stays on the ground floor.
- **Photo renders.** The Gemini request takes `storeys` 1–3, and single-storey photo keys are unchanged.

### The editor

- **Which floor is on show.** `session.activeLevelId` is session state, not history. Undo and redo switch to the floor they changed and say so ("Undone on the first floor.").
- **Floor switcher** in the canvas dock, with PageUp and PageDown. The floor below shows faded under the plan, and the outline of the floor above shows dashed.
- **Stairs tool (S)**, shown once there are two floors. It snaps to a wall face; Shift+R turns the stairs and Delete removes them. The Stairs inspector shows "14 steps of 193 mm".
- **The house inspector** has a Floors section: name, ceiling height, floor thickness, add a floor, remove this floor.
- **Exports.** A PNG of the floor on show, named after it; a GLB of the floors shown in 3D.
- **Whole-house panels.** The AI Designer's summary and suggestions cover the whole house, whichever floor is on show.

### The generator (`design/storeyPlanner.ts`, `design/storeyLayouts.ts`)

- **The brief.** `brief.storeys?: 1 | 2`; when it's absent the house has one storey. `normaliseBrief` drops 1, so existing briefs serialise unchanged.
- **Splitting the rooms** (`storeyPrograms`):
  - Downstairs: the day rooms, utility, garage and a WC. If no WC was picked, one is added, with a note.
  - Upstairs: bedrooms, ensuites and bathrooms.
  - The office goes up as a "Study" when the ground floor would be much larger than the upper one.
- **Two arrangements,** both with the stairs in a straight flight in the same place on both floors:
  - **Spine:** a side hall below and the landing above, with the stairs running along it.
  - **Cross:** the stairs cross a middle band, with rooms in front and behind on both floors.
- **The emitter** takes `upper` (no front or garden door) and `doorAvoid` (keeps doors clear of the flight). Single-storey output is unchanged.
- **Building a candidate.** Emit the ground floor, `addLevel`, emit the upper floor into a `levelView` and splice it back, `addStairs`, then validate, judge with `assessHouseSense` and furnish.
- **Houses sized from the rooms** try up to 12 sizes until three houses fit. Variant ids look like `storeys-l.…@2s:7.5x10`, so Generate more and Generate similar work.
- **Shapes.** A drawn rectangle is stacked to two floors. Other shapes followed in [ADR 0011](0011-shaped-two-storey-houses.md): a core stacked with single-storey wings, or the whole outline.
- **AI.** The interpreter reads `storeys` ("two-storey", "upstairs", "bungalow"). Three storeys goes to unclear, because three-storey layouts aren't generated yet.

## Consequences

- Single-storey behaviour, files, golden fingerprints and the plan-sense scoreboard are unchanged.
- Generating three two-storey layouts takes about 10–130 ms in tests, for houses of two to five bedrooms.
- **A third storey** costs little in the domain, editor and 3D, which already handle it. Generating three-storey houses is the expensive part: a room split for townhouses, stairs lined up through every floor, middle-floor landings and fire escape. That is why the generator stops at two.
- **Known gaps,** recorded in TODOS.md:
  - wider houses than the cross bands cover;
  - regenerating one floor;
  - Walk climbing the stairs;
  - pitched roofs over upper floors;
  - inserting a floor between two others;
  - basements.
