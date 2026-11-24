# ADR 0017 — Halls by kind, the program graph, and what an arrangement means

- Status: accepted. Implemented 2026-10-19 (steps 8–10 of the Drafted gap plan: roadmap M1, M2 and the first part of M3).
- Date: 2026-10-19
- Builds on: [ADR 0013](0013-generation-benchmark-and-picking-ideas.md), [ADR 0015](0015-split-bedroom-layouts.md)

## Context

The 10-14 review's medium-term steps were these:

- **M1:** a vocabulary for circulation.
- **M2:** one graph of the program's relationships.
- **M3:** a concept layer, so the planners stop testing arrangement strings.

As written, M1 split halls into separate entry, corridor and landing rooms. Every room has walls round it, so that would add walls and doors until doorless openings exist (X2). The user chose M1 as labels.

## Decisions

### M1: halls by kind (`design/circulation.ts`)

- **Data.** `Room.circulation` is optional: `entry`, `corridor`, `landing` or `hub`. There is no version bump; an older file simply has none.
- **Classifying.** `circulationOf` decides each hall's kind from the plan:
  - a hall upstairs is a landing;
  - a hall the front door opens into is an entry;
  - a compact hall that four or more rooms open off is a hub;
  - anything else is a corridor.
- **Labelling.** `labelCirculation` marks every generated plan in `planLayouts`. Names stay as the planners give them: a long hall with the front door in it is still "Hall" to the people who live there.
- **Where it shows.** The inspector's subtitle says the kind. The benchmark reports each kind's share of the floor (`hallByKind`).

### M2: the program graph (`design/concept/programGraph.ts`)

- **Access costs.** One graph answers what each room may open off and what that costs, downstairs and up. Before, the zone planner's `edgeCost` and the bands' `DOWN`/`UP` held the same table twice.
- **Placement weights.** It also holds what the brief's placements are worth: the master on the quiet side, living spaces at the garden end, the kitchen at the garden end when asked, the garage at the street.
- **Who reads it.** The day row, the bands (`downRules`/`upRules`), the two-storey cross ground and `quietCost` all read the graph. Without preferences the costs are as before, and the goldens are unchanged.
- **The utility preference.** `utility_near_kitchen` now counts in every planner: a utility reached other than through the kitchen costs 2 more, and zone layouts keep it out of the bedroom zone. Before, only the strip planner read it.

### M3, first part: what an arrangement means (`design/concept/descriptor.ts`)

- **`conceptOf(id)`** says which strategy drew a layout (zones, split, wings, storeys, strip), its family for variety and "Show similar", whether it's direct entry, and its card title.
- **Callers.** `arrangementTitle` and "Show similar" (`likeBase`) read it instead of testing strings.
- **Guard.** `tests/design/ids.test.ts` snapshots every layout id the planners give (benchmark scenarios, drawn shapes, more and similar). Ids are kept in project files, so a change to how planning is organised must leave them as they are.

## Not done

- **The rest of M3.** That means strategies as adapters behind one generation path, and porting the strip planner to `frontBack` on the layout IR. Without them nothing changes on screen, and they carry the most risk. The id snapshot is in place for when they're done.
- **Retiring the strip planner** is still to decide (TODOS P3).
- **The region planner's own access table** (`regionPlanner.ts`, re-laying a band of rooms) stays separate: its costs differ on purpose.
- **Real hall splitting.** It needs doorless openings first (X2).
