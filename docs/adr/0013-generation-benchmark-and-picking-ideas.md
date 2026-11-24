# ADR 0013 — Generation benchmark, hard rules first, picking different ideas

- Status: accepted. Implemented 2026-10-14 (roadmap steps Q0–Q5, the quick wins of the generation-quality review).
- Date: 2026-10-14
- Builds on: [ADR 0008](0008-zone-layouts-and-plan-sense.md), [ADR 0010](0010-floors-and-stairs.md), [ADR 0011](0011-shaped-two-storey-houses.md)

## Context

The user found the generated plans valid but repetitive, corridor-heavy, and not like an architect's work. A review on 2026-10-14 traced three causes in how candidates are judged and chosen. These sit apart from the planners' own limits, which come later in the roadmap.

- **Variety by size.**
  - `pickVaried` spread the shown layouts over house size first, then over a family string.
  - It then filled any spare places from the ranked list, which brought back mirror images.
  - A drawn 12 × 9 m house showed the same plan three times. The family-4 two-storey brief gave 15 of 15 pairs with the same doors.
- **Ranking by count.**
  - `bySense` ranked first by the number of findings, and every finding cost 5 points.
  - An unreachable room weighed the same as a master bedroom 0.3 m² too small.
  - The sense rules called "hard" were never enforced.
- **Nothing measured.**
  - Quality was judged by eye from `plans:render`.
  - The scoreboard covered 27 single-storey plans and recorded only findings.
  - Nothing measured circulation beyond the hall, the depth of rooms from the front door, or whether two plans were different ideas.

## Decisions

### A benchmark, before any planner change (`design/eval/`)

- **`metrics.ts`** measures any plan, generated or drawn. For each floor:
  - hall and circulation share;
  - hall area per door;
  - what the front door opens into;
  - door depth from the way in;
  - a privacy gradient (how much deeper the bedrooms lie than the living spaces);
  - bedrooms sharing a wall with a living space;
  - the least glazing ratio of any habitable room;
  - furniture the recipes couldn't place.
- **The plan's idea** is a `Descriptor` that ignores mirroring: entry, open-plan group, where the master and the kitchen are, which room opens to the garden, and the hall's shape.
- **`compareIdeas`** says whether two plans are:
  - *identical*: the same doors, rooms in the same places after mirroring, and the same floor area on every floor;
  - *the same idea*: for example the single- and double-loaded versions of one zone layout, or a resized house;
  - *a different idea*: two descriptor fields apart with the doors or room positions substantially changed (door-graph distance ≥ 0.25 or spatial ≥ 0.4), or one field apart with both (≥ 0.35 and ≥ 0.25).
- **`benchmark.ts` and `tests/fixtures/benchScenarios.ts`** cover 16 scenarios: the presets, L and U shapes, two storeys, and drawn houses that are wide, deep, L-shaped or a small two-storey.
- `tests/design/bench.test.ts` snapshots each scenario's summary. `npm run plans:bench` writes the per-plan table, with `BENCH_OUT` and `BENCH_COUNT`.
- Still missing, because the planners can't do them yet: a terrace with party walls, and an extension to an existing house.

### Hard rules first, then a weighted score (`sense.ts`)

- **`HARD_RULES`** are `reachable`, `front_door`, `daylight`, `wet_room_privacy` and `stairs`.
  - `bySense` ranks by how many hard rules a plan breaks, then by score.
  - A narrow room or a small master no longer outranks a better plan elsewhere by count alone.
- **Findings cost by severity** (`FINDING_COST`): reachable 15, front door 12, daylight 12, stairs 12, wet room 10, kitchen not connected 6, room shape 4, master not largest 3.
- **`circulationShare`** replaces `hallShare` in the score. It counts the hall plus stores that open only off it and weren't asked for, the cupboards planners cut from hall strips. Before, those cupboards *lowered* the hall share.
- `bySense` now also orders whole houses, so `storeyLayouts.ts` drops its own copy.
- Candidates are still not dropped for breaking a hard rule. They are only ranked below plans that don't break one, so a hard brief still gets layouts.

### Picking different ideas (`select/pick.ts`)

`pickIdeas` replaces `pickVaried` and the two-storey `pick`. It picks:
1. the best plan;
2. different ideas within `QUALITY_MARGIN` (20 points) of it;
3. variations of the same ideas, in another house size first;
4. only then plans that break more hard rules, to make up the number.

**A plan identical to one already picked is never shown.** If nothing else fits, fewer cards are shown.

The planners **build past repeats.** The zone, wing and two-storey builders skip a build identical to an earlier one and build the next, up to twice their usual number. The strip and wing planners build a couple of spares (`withSpares`) when asked for more than one. A single layout, the live preview, skips all of this, so its timing is unchanged.

### Front door into the living spaces (`zonePlanner.ts`, `layoutEmitter.ts`)

The first new circulation idea. Every plan used to be entered into a hall. A zone layout can now be entered **directly** instead:
- **The front door** opens into the day room at the street end: living or kitchen/dining, else dining, else a kitchen at a cost.
- **The street end of the night zone** goes to a study, the smallest bedroom, or a master without an ensuite. That room spans the zone's full width, but only if that keeps it within 1.6× its target area.
- **The bedroom hall** starts behind that front room and opens off the living space beside it that suits it best (living, dining, then kitchen/dining). When double-loaded, it opens through the lobby at the street end of the inner band.

How it's built:
- `directNights` wraps the single- and double-loaded night zones; their tags start `e` (`ebs32o0`).
- `dayRow(…, entryFirst)` roots the day zone's door tree at the front door.
- Cards are titled "Front door into the living space" (`isDirectZone`, `DIRECT_SUMMARY`).

Two fixes in the emitter:
- An entrance room with no `via` is the root, so it gets no door to a parent.
- The front door is placed **before** the rooms' windows. Otherwise a living room's street window could take the wall the door needed. That never showed up before, because the hall has no window to compete.

### Less hall: rows of living spaces, and wardrobes at the hall's end (`wingLayout.ts`, `zonePlanner.ts`)

**Row wings.** Every wing of an L, T or U house used to get a hall strip along its whole length, because every room had to touch a hall. In the family-3 L, the living wing's strip was 12 m² of a 26 m² hall.
- A wing that meets its parent at one end and is 3.1–6.4 m across can now be a **row** of living spaces (living, dining, kitchen, study, utility, WC), with no hall of its own.
- The room at the junction opens off the parent's hall, and the rest open off the room beside them. This uses `bandOf` with the downstairs rules, the same chain as a zone layout's day zone.
- `distributeWidths` moved to `slots.ts` so that `wingLayout.ts` and `bands.ts` can use each other without a cycle.

**Street front.** Leaner row plans could leave the hall unable to reach the street, putting the front door on a side wall. So:
- The wing planner's own score now charges 5 for a hall that misses the street front (`Geometry.street`), as heavy as the hall it saves.
- A row that reaches the street can instead take the front door into its street-end living space (`LayoutPlan.entrance`), with the hall reached through the row.
- The junction room is never that entrance, because it already opens off the hall.

**Garden doors.** Living, kitchen/dining and dining rooms in wing plans get garden doors (`gardenDoor`). Wing plans never had any; the emitter places one only on a garden wall long enough.

**Wardrobes.** Where a zone layout's bedroom hall stops at its last door, the rest of its strip was a hall cupboard (a 3.4 m² "Store" in the family-3 golden plan). If it lies beside a bedroom along its whole length and is at least 2.5 m², it is now that bedroom's **walk-in wardrobe**, opening off the bedroom (the master first). Smaller ends stay linen cupboards off the hall.

**Picking.** A size variation now has to be within the quality margin too. Before, a plan 40 points worse could take a card just for being a different house size.

### Preferences the winning planners ignored (`zonePlanner.ts`, `storeyPlanner.ts`, `designInterpreter.ts`)

The zone, two-storey and stack planners, which produce most shown plans, now read two preferences through `ZoneOptions`:
- **`kitchen_faces_garden` (`kitchenGarden`).** The day row charges 3 when the kitchen isn't the room at the garden end. The two-storey cross layout charges 3 for a kitchen in its front band.
- **`primary_bedroom_private` (`primaryPrivate`).** The master's "not at the quiet garden end" cost rises from 0.5 to 2 (`quietCost`), on one floor or upstairs. The master is never the direct-entry front room, which would share a wall with the living space by the front door.

The strip and wing planners already filtered their arrangements by `kitchen_faces_garden`.

**Claude.** The request reader now receives the brief's room picks (`pickedRooms`), not only the counts, so it knows a snug, a utility or an ensuite is already there.

## Results (three layouts per scenario, as the editor shows)

- **Identical pairs shown** went from 10 across the benchmark to 0.
- **The drawn 12 × 9 m house** shows three different ideas instead of one plan three times.
  - The other two are strip layouts, so its mean score falls from 84 to 57.
  - The zone planner has no other idea for that house. That is the planners' limit, now visible rather than hidden.
- **Scoreboard:** mean score 77 → 72, mostly because the score now charges hall cupboards as circulation. `front_door` 3 (unchanged), `room_shape` 8 → 9.
- **Generation time** for three layouts rose by up to about 80% (family-3: 100 → 180 ms). The worst case is now about 320 ms (family-4, any shape), still well within the 1 s target.
- Some briefs now show **fewer than three cards** when the rest would be mirror images: a Z-shaped two-storey house, and some shallow L/T/U two-storey houses.
- **Direct entry (Q3)** reaches the shown three for starter, family-3, bungalow, the deep 8.5 × 16 m house and the drawn L. It leads for starter (96) and bungalow (89).
  - Distinct pairs: family-3 0 → 2, bungalow 1 → 3, starter 2 → 3, deep house 0 → 2.
  - Mean circulation falls by 1–3 points where it appears (family-3 16% → 13%).
  - Scoreboard mean 72 → 73, findings unchanged.
  - The one-bedroom annexe template now opens into its living space, with a 1.4 m² inner lobby.
- **Hall (Q4).** Circulation is down in 10 of 16 scenarios:
  - starter 13% → 9%, annexe 11% → 7%, family-3 13% → 10%, bungalow 16% → 13%, the deep house 14% → 11%, family-3 L 17% → 14%;
  - the L's best wing plan: hall 26 → 14 m².
  - Scores rose to match (starter 85.6 → 92.5, family-3 L 59 → 70).
  - Hard-rule findings in the L and U went from 3 to 0.
  - The U's circulation rose 15% → 19%, because its hall now has to reach the street. Its score still rose 43 → 48.
  - Scoreboard mean 73 → 78; `front_door` 3 → 0, `kitchen_connected` 3 → 2, `master_largest` 2 → 1.
  - Two-storey halls are unchanged. The 2.2 m spine and the long landing are structural, and wait for roadmap X3.
- **Preferences (Q5).** With `kitchen_faces_garden`, every shown single-storey plan for family-3, family-4 and bungalow has its kitchen on the garden. Before, most had it on the street side or inside the plan.
  - The two-storey bungalow's three plans went from all street-side to all garden-side.
  - Two benchmark scenarios now hold this ("… kitchen to the garden").
  - `primary_bedroom_private` changes nothing visible for zone and two-storey plans: they already put the master on the garden end, away from the living spaces. Its effect is the direct-entry rule and a stronger push where a plan would move the master.

## Consequences

- Golden `describePlan` snapshots changed where a different plan is now shown. Each change is a mirror or near-copy giving way to another plan, or a plan with a side-wall front door dropping below one without.
- The Docker pixel baselines (`npm run test:screens`) may need updating where the shown layouts changed. They weren't run here.
- **Mirrors.** "Mirrored is the same plan" holds while the planners ignore north. Once they read `site.north` (roadmap M5), a mirror can face the sun differently, and `compareIdeas` should compare in true orientation.

## Addendum 2026-10-19: Q6, furniture in judging

- **The charge.** When several layouts are wanted, the six best by plan sense are laid out as they would be furnished (`chargeFurniture`, `select/pick.ts`). Each essential piece that won't fit (a bed, a sofa, a table) costs 2 points of sense before `pickIdeas` runs.
- **Where it runs.** `merge` and the two-storey `pick` both apply it. The live preview (a single layout) skips it.
- **Effect on the benchmark.** Missing furniture went from 48 pieces to 46, and the drawn U's third layout swapped for one that fits its furniture (sense 65.5 to 68.4). It costs about 15% more time.
- **Goldens.** Three golden groups changed: near-equal plans swapping places, and one house size moving half a metre.
- **Not done.** Strip and wing builds still furnish every candidate. Furnishing only the picks would be faster, but would rename furniture ids in every golden.

## Still open (roadmap)

- **Direct entry ranking.** Direct entry ranks first wherever it saves the most hall. Nothing yet weighs what an entrance hall gives (a draught lobby, coats, privacy from the door), so a brief that wants one can't say so. A brief preference or a lobby carved from the living space would.
- **Direct entry for every planner.** It covers zone layouts only: not wing, strip or two-storey plans.
- **Privacy elsewhere.** The wing and strip planners don't read `primary_bedroom_private`. A wing plan can still put the master against a living space.
- **AI eval.** The request reader's prompt changed, and `npm run eval` (36 paid Claude calls) hasn't been rerun.
- **U and T houses:** split-bedroom zone layouts were added on 2026-10-19 (ADR 0015). Us whose living spaces need the full depth, and Ts with their stem on the street, still use the wing planner.
- **Two-storey circulation** of 15–25% per floor: spine width, landing length, and stairs counted as hall (X3).
- **Q5:** reading `primary_bedroom_private` and `kitchen_faces_garden` in the zone and storey planners.
- **M1–M6, X1–X6:** circulation types, a programme graph, strategies as concepts, a fast evaluator, context (north, party walls), repair moves, and a template-tree solver with new strategies.
