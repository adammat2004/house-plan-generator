# ADR 0007 — Right-angle house outlines

- Status: accepted. Implemented 2026-10-08.
- Date: 2026-10-08
- Builds on: [ADR 0001](0001-plan-document-and-geometry.md), [ADR 0002](0002-project-variants-and-design-intent.md), [ADR 0005](0005-rooms-first-and-photo-renders.md), [ADR 0006](0006-rooms-step.md)
- Supersedes: ADR 0001's rule that the envelope is "exactly four external walls … a locked rectangle", and ADR 0005's note that auto footprints are rectangles only.

## Context

Every house was a rectangle: the envelope was a 4-tuple of walls, the strip planner filled a rectangle, and auto sizing proposed W × D. A real product needs L, T and U houses, wings and bump-outs, as drafted.ai offers: pick a shape or draw one, and get layouts that fill it.

The user chose, on 2026-10-08:
- right-angle outlines only (no 45° walls, no curves, no courtyards yet);
- four ways in: shape presets, dragging outline edges, drawing an outline, and the planner choosing a shape when it sizes the house;
- AI still never emits coordinates;
- single storey for now.

Most of the geometry core was already general. Rooms are faces of the wall graph, so L-shaped rooms already worked; wall footprints already joined cleanly at inward corners.

## Decisions

### The outline (plan schema v4)

- `Level.envelope` is `{ kind: "polygon", wallIds: Id[] }`, 4 to 64 external walls, counterclockwise, each wall's end vertex the next one's start.
- Whether a house is a rectangle, an L or anything else is derived (`EnvelopeInfo.family`), never stored.
- Migration 3 → 4 renames `kind: "rectangle"` to `"polygon"` and keeps the ids. Older editors refuse v4 files with the usual "newer version" message.
- The rules, checked by `checkOutlineRing` (`geometry/outline.ts`), shared by validation and the draw tool:
  - walls alternate horizontal and vertical; the ring runs counterclockwise;
  - the outline never touches or crosses itself;
  - a step is at least `LIMITS.minOutlineStep` (0.2 m) and at least as long as the walls either side are thick, so they don't collide;
  - walls facing each other across the house or across the garden keep `minHouseClearSpan` (0.5 m) clear between their faces;
  - any two walls that aren't neighbours, or neighbours of one step, keep the same clearance corner to corner.
- Messages say where the problem is ("near the north-east corner").
- New commands write the ring from a canonical corner: the start of the lowest south-facing wall, westmost first. A rectangle's order is therefore still south, east, north, west.
- Only creating an outline puts its bounding box at the origin. Later edits may leave coordinates negative, so the view doesn't jump.

### EnvelopeInfo

The rectangle-era fields keep their names and now mean the bounding box, so framing, cameras, site planting, thumbnails and overall dimensions work for any shape without change:

- `axisRect`, `outsideRect`, `width`, `depth`: bounding boxes.
- `sideOfWall`: which way every outline wall faces.
- `sides`: for each side, the longest wall facing it on the bounding box. `thickness`: that wall's thickness.

New fields: `externalThickness`, `axisRing`, `outsideRing`, `insideRing`, `edges` (facing, length on the axis and outside face, convex or reflex ends), `wallsFacing`, `isRectangle`, `family`, `reflexCount`, `grossArea`. The analysis is cached per level, because wall labels call it often.

### Commands

- `createOutline { outline, externalThickness, wallHeight, name? }` builds a fresh level from outside-face corners in any direction and from any corner. `createFootprint` shares its level builder and keeps its own corner arithmetic, so rectangles are byte-identical to before.
- `resizeFootprint` keeps its meaning: it moves every vertex on the easternmost or northernmost wall line. Outline walls block a shrink as internal walls do ("… without changing the house's shape").
- Internal walls must stay inside the outline: each stretch between the points where a wall meets the outline is tested against the polygon, not the bounding box.
- `moveWall` at an inward corner: a wall continuing an outline wall from the corner (the natural split between two wings) can be dragged. Its end leaves the corner on a new vertex, which must land on another wall; an end landing on a corner joins it. Collinear chains stop at outline walls.
- Labels: "North external wall 2" when several outline walls face north, numbered west to east (or south to north).
- "Garden" means every outline wall facing the same way as the rear wall (`gardenWallIds`), so a U's courtyard walls count.

### Shape presets

`geometry/outlinePresets.ts` makes rectangle, L, T, U and Z outlines from an overall width and depth and two wing sizes, with the street to the south. The new-project page ("Draw from scratch" and "Enter dimensions"), the New house dialog and the house card's "Change shape…" offer them. Changing shape replaces the house as one undoable step.

### The wing planner

Rectangles keep the strip planner, untouched. Any other outline goes to the wing planner, in three pure stages:

1. **Split** (`geometry/partition.ts`). Every inward corner is cut along one of its two walls; all 2^r ways are tried (r ≤ 10), pieces sharing a whole side are merged, and pieces at least 3 m thick are **cores** (wings). Thinner pieces are **fringe** (a bay, the strip beside a notch) and hang off the core they share most boundary with. The three best ways (fewest, thickest cores; least fringe) are kept.
2. **Plan** (`design/wingLayout.ts`). The wings form a tree from the biggest. Each wing gets a hall strip along its length: single-loaded beside one long side, double-loaded between two bands, or none for a small leaf wing that is one band of rooms opening off its parent's hall. Halls that miss each other at a junction get a short connector, so the hall is one space. Bands are cut into rooms in proportion to target areas; every room keeps a stretch of hall for its door, and rooms can't be more than three times deeper than wide (4.5 for bathrooms, WCs and stores). Four arrangements zone the rooms: living spaces on the garden side, bedrooms on the quiet side, a living wing, or a sleeping wing. Layouts are scored on how far rooms miss their targets, hall area (weighted heavily) and room proportions.
3. **Emit** (`design/layoutEmitter.ts`). The layout is a set of labelled rectangles. A grid through every corner labels each cell; fringe takes the label next to it towards its core. Walls go wherever two labels meet, as maximal straight runs, so they always join. Rooms are named from a point in their biggest cell. Doors go on the longest boundary with the hall (an ensuite's with its bedroom), windows on the longest outside run, the front door on the hall's street-side run if it has one (else a side, else the garden), and a garden door where the hall meets the garden.

Every layout is validated and furnished. Arrangement ids look like `wings-garden-living.p0.c3` (arrangement, split, hall choice), so Generate more and Generate similar work as for rectangles. "Does not fit" messages are area-based ("These rooms need about 135 m² inside; your L-shaped house has about 83 m²") or name the part that is too narrow.

`geometry/outlineDescription.ts` words an outline for people: a rectangle with a shallow bump-out is "rectangular with a bay", not T-shaped, and keeps the rectangle wording in photo prompts.

### Shapes chosen by the planner

- `HouseBrief.houseShape` is optional: absent means a rectangle, exactly as before; `"any"`, `"L"`, `"T"` or `"U"` let the planner shape houses it sizes from the rooms. It applies only in auto sizing; a drawn house keeps its shape and the layouts say so.
- `design/footprint.ts` `shapeFootprintsFor` sizes L, T and U outlines from the program's area (wings 5.5 or 6 m deep, and 8.5 m double-loaded wings for big programs), within the plot. Each outline is laid out by the wing planner, one layout per outline; "any" alternates rectangles with shaped houses. Variant keys add the outline, e.g. `wings-garden-living.p0.c17@U:13x11:5.5:4.5`.
- New "Pick your rooms" projects start with "Any shape"; the Rooms step shows shape chips when sizing from the rooms.
- Claude's reply has a `houseShape` brief change, and the rule-based reader understands "L-shaped", "a courtyard house" (U), "any shape" and "rectangular".
- Templates can carry an outline; an L-shaped bungalow joins the gallery.

### Editing the outline

- `moveOutlineEdge { wallId, outward, from?, to? }` (`commands/handlers/outline.ts`) pushes out (positive) or pulls in a stretch of an outline wall, measured along it like opening offsets:
  - the whole wall when `from`/`to` are left out, like a resize of that side;
  - a stretch from a corner cuts a notch (pulled in) or fills one (pushed out);
  - a stretch in the middle makes a bay or a recess, with a step wall either side.
- Internal walls tee'd onto the moving stretch stretch with it, and internal walls continuing its line move with it, as with `moveWall`. Parallel walls in the way, attached walls that would fold over, and doors or windows straddling a split are refused with messages; nothing is dropped.
- Doors and windows on the moved stretch go with it; those on neighbouring walls keep their place in plan. The longest piece of a split wall keeps its id, so the rear wall and references survive.
- `normalizeOutline` merges what an edit collapses: a wall shrunk to nothing is removed and the straight run either side merged (the longer piece keeps its id, the other's openings move onto it), then the ring restarts at its canonical corner. A notch pushed back out restores the original four walls and ids.
- An outline wall's length in the wall card moves the wall at its end (rectangles still resize).
- On the canvas, with Select in Structure: dragging an outline wall moves it, its outside face snapping to the grid and to other corners; Alt-dragging pushes out a 3 m bay or pulls in a recess around the grab point; with the house or an outline wall selected, square handles on every corner drag out notches. Each gesture previews live and commits as one undo step; Escape cancels.
- The Outline tool (O) draws a new outline by its outside corners: walls lock horizontal or vertical, snap to the grid and to earlier corners, show their length, and the closing line and any problem show live. Clicking the first corner or Enter finishes, adding the one corner needed to close; Backspace takes a corner back; a ring that doubles back is refused. On a house with walls, doors or furniture it asks before replacing the house (undoable); reshaping that keeps the rooms is what dragging is for.
- Stairs and Column ("coming soon") moved from the tool rail into its More menu to make room.

### Robustness

- Face tracing snaps the points it computes along walls to a nanometre. Float noise (11.85 − 12.7 = −0.8499999999999996) had left edges a hair off vertical, which made polygon-clipping throw during room reconciliation on some reshaped outlines.
- `normalizeRing` drops points in the middle of a straight wall but keeps a spike that doubles back, so the outline checks refuse it instead of it silently vanishing.

## Consequences

- Golden fingerprints (`tests/design/golden.test.ts`) pin every rectangle: plans, auto sizing, templates, room proposals, 3D model, dimensions and photo keys. They passed unchanged through all of this.
- `tests/design/wings.test.ts` checks every named shape with three briefs: valid, every room named and reachable from the one hall by doors, a front door, deterministic and distinct. About three quarters of random outlines get layouts; the rest get a reason. Outlines whose every part is under 4.2 m across (a hall and a row of rooms) can't be laid out yet.
- Wing layouts lean on corridors in narrow wings; the hall-area weighting keeps courtyard and open-wing layouts first where they fit.
- `tests/commands/outlineEdit.test.ts` walks 480 random pushes and pulls over four houses; every successful step leaves a valid plan with one room per region that round-trips through JSON.
- Still open: pitched or gabled roofs per wing (roofs are flat with parapets for every shape), courtyards (outlines with holes), reshaping by drawing that keeps the interior, an AI "reshape the house" step, and ensuites in bedrooms that aren't rectangles. More than one storey came with ADR 0010, and two storeys in these outlines with [ADR 0011](0011-shaped-two-storey-houses.md).
