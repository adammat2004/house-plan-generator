# ADR 0008 — Zone layouts and plan sense

- Status: accepted. Implemented 2026-10-09.
- Date: 2026-10-09
- Builds on: [ADR 0002](0002-project-variants-and-design-intent.md), [ADR 0005](0005-rooms-first-and-photo-renders.md), [ADR 0007](0007-orthogonal-outlines.md)

## Context

The user judged that generated plans didn't make sense. An engineering review (2026-10-09) traced the cause to one skeleton shared by both planners:

- a hall strip runs the length of the house or wing;
- every room hangs off it by one door.

Rendering every preset showed what that skeleton produces:

- Kitchen, dining and living rooms that don't connect to each other.
- A front door on a side wall at the end of the corridor, and no garden door in front/back layouts.
- Doors in the middle of walls.
- Bowling-alley rooms, such as a 1.7 × 4.8 m bathroom or a 13.7 × 3 m open plan.
- An L-shaped master that is smaller than the other bedrooms.

Nothing checked whether a plan made sense; `validateDocument` only checks that the geometry holds together.

The user chose to:
- add a checker first, reporting before it gates;
- build one planner with real zones, reached through an access graph;
- keep the strip planner until the new one beats it.

## Decisions

### One table of room rules (`design/roomRules.ts`)

- **What a room of each type needs:**
  - its zone;
  - its window size;
  - whether it needs daylight;
  - its minimum clear width;
  - its maximum proportion (long side over short);
  - its minimum area.
- **Room kinds the program can ask for.** Each has a target area and a narrowest slot.
- **Shared helpers.** `clearMin` and `proportionOk` judge a slot by its clear size once the walls are taken off.
- **Who reads it.** The program, the planners and the checker all use this table. A test makes sure no slot can undercut its type's minimum.
- **One program path.** Counts-only briefs are read as the picks they imply (`picksFromCounts`) and go through the same program as picked briefs. The primary bedroom is "Master Bedroom" whichever way the brief was made.

### Plan sense (`design/sense.ts`)

`assessSense(level)` reads a plan, generated or hand-edited, and returns findings, metrics and a score.

- **Hard rules** (findings):
  - every room is reachable from the front door;
  - the front door is on the street side and opens into a hall or a living space;
  - habitable rooms have an outside window;
  - the kitchen connects to dining or living;
  - no bathroom opens onto a living space;
  - every room is within its type's width, proportion and area;
  - the master is the largest bedroom.
- **Soft score** (0–100):
  - the hall's share of the floor;
  - how far rooms miss their target areas;
  - doors within 0.6 m of a corner;
  - a garden door from a living space;
  - rooms other than the hall that aren't rectangles;
  - the utility off the kitchen;
  - a private master.
- **Where it's used:**
  - the planner ranks candidates by it (`bySense`: fewest findings, then score);
  - the recommended concept weighs it alongside the brief;
  - concept cards say how many things to check, and the detail panel lists them;
  - swapping rooms reports what the swap made worse;
  - `npm run plans:render` prints it;
  - the scoreboard test records how many generated plans break each rule.
- **Not yet a filter.** The rules aren't filters in the planner; instead, variety never brings in a plan with more findings than the best one. A rule can become a filter once every preset and shape passes it.

### The access graph (`wingLayout.ts` `LabeledRoom`, `layoutEmitter.ts`)

A labelled room may say:

- `via`: the room its door opens into (by default the hall, or an ensuite's bedroom);
- `links`: rooms it also has a door into;
- `gardenDoor`: whether it wants garden doors.

A plan may say:

- `entrance`: the room the front door opens into;
- `cornerDoors`: doors go near the end of their wall closer to the way in.

The emitter places all of these. Everything is opt-in, so wing layouts emit exactly as before. Placing a single opening is shared as `fitOpening`.

### Zone layouts (`design/zonePlanner.ts`, `design/zoneLayouts.ts`)

A house is a **day zone** and a **night zone** side by side, each running from the street back towards the garden.

- **Night zone.** A hall from the front door at the street end. It comes in two forms:
  - **single-loaded:** bedrooms on the outside wall, the hall along the day zone;
  - **double-loaded:** bathrooms, the utility and a coat cupboard on the inner side, where they need no window, and an entrance hall at the street end that reaches the day zone.

  The hall stops just past the last room it serves, and a linen store fills the rest of its strip. The ensuite has its own slot beside the master, so the master stays a rectangle. A bedroom can take the garden end of the inner side.
- **Day zone.** One row of rooms, in the order that suits them best. It's a cheapest tree of doors over permutations:
  - one living space opens off the hall;
  - the others open onto each other;
  - the utility opens off the kitchen;
  - the room at the garden end gets garden doors.
- **Flexible rooms.** A study and a utility may go in either zone.
- **Rectangles.** Every night-zone width that leaves a 3.1–6.4 m day zone is tried.
- **Ls.** An L whose legs run back from the street is two columns of different depths (`planZoneColumns`). One leg takes each zone, and the hall reaches the living spaces where the legs touch.
- **Sizing from the rooms.** `zoneFootprints` sizes rectangles so each zone is as long as its rooms need. With "any shape" or "L", it also sizes Ls where the two zones differ by 3 m or more, so the shape follows from the rooms.
- **How candidates are chosen.**
  - Zone layouts compete with the strip and wing planners' layouts in `planLayouts`. All are judged by plan sense, the best first.
  - They're spread across house sizes, then layout families, without trading away correctness.
  - Zone layouts are furnished only once picked, which keeps a one-plan preview within its 60 ms budget (13–55 ms measured).
  - Templates take the most sensible plan.

### Reviewing planner changes

- Golden snapshots store each plan as text from `describePlan`: the house, its doors out, and every room's size, doors and windows. A planner change reads as a diff of rooms.
- `npm run plans:render` draws every preset and shape to SVG with an HTML contact sheet. `PLANS_OUT` sets the folder, for before/after comparisons.

## Consequences

- **Scoreboard over every preset and shape (27 plans):**

  | Measure | Before | After |
  |---|---|---|
  | Mean score | 46 | 77 |
  | Front door on the wrong side | 18 | 3 |
  | Rooms out of proportion | 25 | 8 |
  | Master not the largest bedroom | 11 | 2 |
  | Kitchen not connected | 6 | 3 |

- Every preset sized from the rooms, rectangle or L, now leads with a zone layout that has nothing wrong with it.
- **Still open:**
  - U and T houses use the wing planner, and its hall-strip skeleton.
  - A small drawn house that can't hold a day zone beside a night zone (8 × 10 m for three bedrooms) still gets strip layouts.
  - The strip planner stays as that fallback until zones cover those cases.
  - Furniture still treats a wall with a door anywhere along it as taken.
