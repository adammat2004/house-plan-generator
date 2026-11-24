# ADR 0015 — Split-bedroom layouts for U and T houses

- Status: accepted. Implemented 2026-10-19 (step 4 of the Drafted gap plan).
- Date: 2026-10-19
- Builds on: [ADR 0008](0008-zone-layouts-and-plan-sense.md), [ADR 0013](0013-generation-benchmark-and-picking-ideas.md)

## Context

U and T houses were laid out only by the wing planner: one hall strip with every room off it. They scored 38–56 on plan sense against 80–97 for zone layouts. Their halls took 15–20% of the floor.

The zone planner handled rectangles and two-column Ls. A U, or a T with its bar on the street, splits into three columns across the street front.

## Decisions

- **Three columns.** `columnsOf` accepts outlines of two or three rectangles side by side, each touching the next for a metre or more.
- **The layout.** Three columns get split-bedroom layouts (`splitWingPlans`): a bedroom wing either side of the living spaces.
  - The master suite has a wing of its own. Alternatively, the smallest bedroom or the study joins it as a nursery or office.
  - Everything else goes in the other wing (`splitNights`).
  - Each wing is a single- or double-loaded night zone from the existing builders.
  - The living spaces are one row down the middle (`dayRow`).
- **Ways in.** The front door opens into one wing's hall, and the other wing's hall (`hall2`) opens off a living space. Or the front door opens straight into the living spaces, with both halls off them.
  - The walls are the same whichever way in is used, so only the best of the three is kept.
- **Daylight.** A living space down the middle must reach an outside wall: an end of the row, or a side where the wing beside it stops (a T's stem). Otherwise it would have no window.
  - The emitter also puts a narrower window beside a room's garden doors when they take its only outside wall.
- **Spare length.** A wing longer than its rooms need gets a walk-in wardrobe beyond the master (a dressing room once it's 6 m² or more), or a store, of at most 2.4 m. The rooms don't all stretch to fill it.
- **Houses sized from the rooms** (`splitFootprints`):
  - A U forms where the living spaces need at least 2 m less depth than the wings, with its courtyard on the garden or on the street.
  - A T forms where they need at least 2 m more.
  - Up to eight are offered, smallest first. A size can fit on paper and not in a plan, so callers stop once enough houses work: one for the preview, three otherwise.
  - Auto U and T briefs now go through `merge`/`pickIdeas` with the wing planner's layouts. Before, they skipped ranking.
- **Ids.** Ids start `zones-c.`, with a family for variety by the way in and the split. "Show similar" for a zone layout now tries its own family first.

## Results (benchmark)

| Scenario | Before | After |
|---|---|---|
| family-4 T (auto) | 39.6–46.1, hall 15–20% | 85.2 / 77.7 / 77.5, hall 9–11% |
| family-3 drawn U | 54.1–56.4 | 75 leads (hall 11.9%) |
| bungalow U (auto) | 45.7–51.6 | unchanged: its living spaces need more depth than its wings, so no U forms |
| family-3 drawn T (stem on the street) | 37.9–38.3 | unchanged: its arms are too short for either half of the bedrooms |

Golden and sense snapshots are unchanged. The live preview takes at most 45 ms, and three layouts at most 234 ms.

## Not done

- A front/back split for Ts: bedrooms across the bar, living spaces down the stem. It suits a T with its stem on the street, and should come with the concept layer (M3).
- Us whose living spaces need the full depth: living spaces across the back bar, bedrooms in the arms.
- Brief preferences for split bedrooms. Today they compete on score.
