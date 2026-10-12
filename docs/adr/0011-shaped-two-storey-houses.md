# ADR 0011 — Two-storey houses of any shape

- Status: accepted. Implemented 2026-10-12.
- Date: 2026-10-12
- Builds on: [ADR 0007](0007-orthogonal-outlines.md), [ADR 0010](0010-floors-and-stairs.md)

## Context

The two-storey generator (ADR 0010) only worked in rectangles:
- `planStoreys` frames a single `W × V` rectangle;
- `candidatesIn` refused other outlines with "two-storey layouts work in rectangular houses for now";
- houses sized from the rooms were rectangles only;
- the Rooms step hid the house-shape chips when Two storeys was picked.

The domain model already handled more: each floor has its own outline, `validateStack` keeps an upper floor inside the one below, the stairs are checked against each floor's own outline, and 3D puts a flat roof over any part with nothing above it.

The user's choices:
- **Every outline the editor can draw:** L, T, U, Z, stepped, bays and cut corners. Angled walls and courtyards stay out of scope (ADR 0007).
- **Two kinds of upper floor.**
  - **Setback:** the upper floor covers only the main part, and the wings stay single-storey under flat roofs.
  - **Full:** the upper floor covers the whole outline.

  Concepts offer both.
- **Sized from the rooms too.** The shape chips show for two storeys, and L, T, U or any shape gives two-storey houses of that shape.

## Decisions

### A core with wings (`design/stackPlanner.ts`, `design/annexPlanner.ts`)

The outline is split into rectangles with `partitionOutline`, using up to 8 partitions. One rectangle is the **core**: it takes the stairs and the floor above, and is planned by the existing `planStoreys`, unchanged. The others are **wings**, filled with ground-floor rooms that open off the core's rooms where they meet it (the junction).

Reusing `planWings` with a fixed hall was rejected: its hall choices and wing tree can't pin the stair rectangle, nor the floor you step onto at the top, on both floors.

- **Choosing the core** (`stackCores`).
  - The core must meet the street for at least 1.2 m: a front bay up to 2.4 m deep counts.
  - A core wider than the rooms can fill is also tried in part. A stretch 6.5, 7.5, 8.5 or 9.5 m wide at either end along the street takes the floor above, and the rest becomes one more wing.
  - The cores are ordered with the preferred core first (the main part of a house sized from the rooms), then by size.
- **Splitting the ground floor** (`splitGround`).
  - The WC and at least one living space stay in the core.
  - Each wing gets rooms that roughly fill it (0.5–1.5 times its area), or none.
  - Splits are ranked by how well the core and the wings are filled, and putting every room in the core is always tried.
  - In shaped houses the office stays downstairs, because the wings have room for it (`storeyPrograms(…, { wings: true })`).
- **Filling a wing** (`annexLayouts`). It uses `bandOf`, which moved to `design/bands.ts`. Contacts there can now be placed rooms as well as the hall.
  - **Band mode:** rooms side by side along the junction, each with a door through it.
  - **Row mode:** rooms one after another, the first opening through the junction.
  - `doorwaysOn` keeps doors clear of the stairs, and living spaces in a wing get garden doors.
- **A wing with no rooms of its own** extends the living space that meets it across at least 2.4 m, if the wing adds no more than 1.2 times that room's target area. Each room extends once. Otherwise the wing is a snug, with a note.
- **Filters before a plan is built:**
  - the ground floor hall reaches the street;
  - every core room that wants a window keeps at least 1 m of outside wall.

### Stairs along the street wall (`storeyPlanner.ts`, cross arrangement)

The spine arrangement needs about 6.8 m on the wall centrelines from the street, and the cross arrangement about 7.7 m. Typical 5–6 m arms don't have that.

Where a core is too shallow for any band across its front, the cross arrangement runs with no front band:
- the hall and the stairs lie along the street wall, with a 0.9 m way past the flight;
- every room is in the band behind;
- the hall or landing runs on so that the room at its far end keeps its proportions;
- an ensuite at the far end has its bedroom at that end of the band.

Tags are `x0f` and `x0r`. Houses deep enough for a front band never get this arrangement, so rectangles that already planned are unchanged. Shallow rectangles, for example 12 × 6 m, now get two-storey layouts as well.

### The upper floor

- **Setback.** `StoreyPlan.upperAxis` is the core. `buildStoreys` runs `addLevel`, then `createOutline` on the upper floor (drawn over the floor below), then `setRearWall` on it. The rear wall must be set again because `outlineLevel` clears it.
- **Full.** The outline is copied upwards as before.
  - Fringe (bays, the strips beside notches) is labelled on both floors.
  - Each wing upstairs extends a bedroom that meets it across at least 2.4 m, the master first, within 1.2 times the bedroom's target area. Otherwise it is a study off the landing. If a wing can be neither, the plan is offered as a setback only.

### Sized from the rooms (`design/storeyShapes.ts`)

`storeyShapeFootprints` builds L, T and U outlines from the `presetOutline` presets:
- the main part is a two-storey rectangle as `storeyFootprints` sizes it;
- one or two wings, 4–5 m wide, run back from it;
- a wing is sized to hold the garage, utility or office if the brief has them, or else to extend the biggest living space;
- the main part keeps at least 3.5 m beside each wing (6.5 m for a T), so the house reads as its shape.

`planStoreyLayouts` routes by `brief.houseShape`, as single-storey planning does:
- rectangle or none: rectangles only;
- L, T or U: that shape only;
- any: rectangles and each shape in turn.

Variants are keyed `…@2s:L:WxD:front:wing`, and summaries begin "An L-shaped 9 × 13 m two-storey house."

### Ids, titles and words

- **Ids** gain a segment after the side: `storeys-<side>.<s|w><core>-<split><wings>[u<wings upstairs>].…`.
  - `s` is a setback and `w` a full stack. `stackOf(arrangement)` reads which.
  - `storeyFamily` already counts different stacks as different families.
- **Titles.** "Two storeys, part single-storey" for a setback; "Two storeys, bedrooms upstairs" otherwise.
- **Summaries** name what the wing or wings hold downstairs.
- **Refusals** name the size of the biggest part reaching the street.

### Elsewhere

- **AI.**
  - The system prompt says a two-storey house can be any shape, with single-storey wings. This invalidates the prompt cache once.
  - `userTurn` now sends `houseShape`.
  - The rule-based reader reads "an L-shaped two-storey house" as both.
- **Emitter.** "1 door or window didn't fit" no longer appears on every two-storey plan. It had two causes:
  - a door was counted as left out for each stretch of wall it tried before it fitted;
  - a large-window room tried a second window beside its own garden doors.

## Consequences

- Rectangles, single-storey or two-storey, are unchanged: the golden snapshots differ only by the removed false notes.
- Generating three two-storey layouts in a shaped house takes about 20–320 ms in tests.
- **Generous outlines with small briefs** get snugs and studies. A 13 m wide T with three bedrooms has more floor than the rooms need, and the planner says so in a note rather than inventing rooms silently.
- **Known gaps,** in TODOS.md:
  - a floor drawn upstairs isn't used as the core;
  - no bedroom downstairs when upstairs is short of room;
  - a wing upstairs beside a long landing could take a bedroom of its own.
