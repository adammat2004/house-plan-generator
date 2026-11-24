# ADR 0016 — Placing rooms before generating

- Status: accepted. Implemented 2026-10-19 (steps 2 and 7 of the Drafted gap plan; V10 of the 10-13 look-alike plan).
- Date: 2026-10-19
- Builds on: [ADR 0006](0006-rooms-step.md), [ADR 0013](0013-generation-benchmark-and-picking-ideas.md), [ADR 0015](0015-split-bedroom-layouts.md)

## Context

Drafted's main input is dragging rooms onto the lot before generating. The 10-13 design made it a soft hint: it chooses between layouts and never constrains them, and the card says when a layout misses one. That plan put the ranking inside `pickVaried`, which the 10-14 work had since replaced with `pickIdeas`.

## Decisions

- **Data.** `brief.placements` is optional and keyed `pick#n` (`double_bedroom#2`).
  - Each value is `{u, v}`, from 0 to 1, over the ground floor's bounding box: u across the house, v from the street to the garden.
  - There is no version bump.
  - `withPicks` and `normaliseBrief` drop placements whose room is no longer picked, and a brief without picked rooms has none.
- **Naming.** `pickRoomName` (`program.ts`) is the one source of room names. Both generation and placement matching use it, and placement falls back to merged rooms, such as a kitchen inside the open plan.
- **Honoured.** A placement is honoured when its point falls inside the room, or when the room's middle is in the same third of the house both ways (`checkPlacements`, `design/placement.ts`).
- **Ranking.**
  - `pickIdeas(…, placed)` puts the plans that honour every placement first, closest first. It only considers plans that break no more hard rules and are within `QUALITY_MARGIN` (20) of the best plan's sense, so a placement never brings in a worse plan.
  - Without placements, the path is unchanged; goldens are identical.
  - The Recommended badge adds up to 2 brief points for honouring.
- **Building.** Zone plans are judged on their rectangles before they're built (`layoutPlacement`), so the ones that honour a placement are built first. This replaces the planned `buildBudget`: no build caps change. Wing, strip and two-storey plans are ranked after building.
- **On screen** (`designer/Placements.tsx`):
  - A picked room's tile in the Requirements list drags onto the preview.
  - Markers can be dragged to move them, and a cross removes one. A dashed line runs to the room the marker landed in.
  - On a house of two floors, each marker shows on its room's floor.
  - Each picked row has a pin button with a 3×3 "Place…" grid (garden at the top), for keyboard and touch.
  - "Clear placements" removes them all.
  - A card that misses a placement says where the room went instead. The detail panel lists every placement.
- **Speed.** The live preview with a placement stays inside the 80 ms budget (a test checks it at three times that), so no Worker was needed.

## Not done

- **Hard placements** ("keep it here"): TODOS P2.
- **A bubble diagram** of which rooms sit next to which.
- **Pre-build judging for wing, strip and two-storey plans.** It would come with the layout IR in M3/M4.
