# ADR 0009 — Pins, regenerate selection and editing in Design

- Status: accepted. Implemented 2026-10-09.
- Date: 2026-10-09
- Builds on: [ADR 0002](0002-project-variants-and-design-intent.md), [ADR 0008](0008-zone-layouts-and-plan-sense.md)

## Context

The user wants editing to work like Drafted's. Drafted lets you:
- move walls, doors and windows on one canvas;
- place rooms yourself;
- select part of a plan and regenerate just that part.

A reviewer of Drafted criticised one thing: it's unclear whether a room you placed is fixed or only a suggestion.

Here, generated concepts opened in Design, where nothing structural could be dragged. Bigger changes re-planned from the empty shell. Nothing could be kept. Swapping two rooms moved only their labels.

## Decisions

### Pins (`Room.locked`, `commands/locks.ts`)

- **The flag.** `Room.locked` is optional, so the schema stays at v4 and older files load unchanged. It's set with `updateRoom`, and reconciliation carries it through edits.
- **What a pin protects.** A pinned room keeps:
  - its clear floor outline;
  - the doors and windows on its walls, by position in plan.

  `pinnedRoomChanges(before, after)` compares them. Furniture can still be arranged inside a pinned room.
- **Checked centrally.** `applyCommand` refuses any command that would change a pinned room ("Bedroom 2 is pinned. Unpin it to change it.").
  - Moving, deleting or thickening a wall around a pinned room is refused before anything else, so the pin is the reason given. Wall heights can still change.
  - `replaceDocument` isn't checked, because it also loads files. Instead, `applyProposal` compares the proposal with the plan.
- **Other places pins apply:**
  - The room planner drops options that would change a pinned room.
  - "Furnish all" skips pinned rooms.
  - Swapping a pinned room is refused.
- **In the UI.** A pin in the room card's header, and a pin by the room's name on the canvas.

### Editing in Design

- With Select, internal walls, doors and windows can be dragged on a concept. This uses Structure's gestures: a live preview, one undo step, and Esc to cancel. The outline and shell stay in Structure.
- **Hit order:** furniture, then a door or window where it sits in its wall, then internal walls, then rooms.
- A click without a drag still selects a room.

### Regenerate selection (`design/regionPlanner.ts`)

- **Band mode.** The selected rooms must together fill a rectangle; none can be pinned, and the hall can't be one of them. The rectangle's inner walls go, and new ones cut it into the same rooms in another order and at other widths, within their room rules (ADR 0008).
- **Doors and windows.** Each room gets a door into what it's reached from: the hall, another room across the rectangle's long side, or its neighbour, by the zone planner's preferences. Rooms on outside walls get windows, and living spaces get garden doors. The front door stays where it is.
- **What it refuses.** Orders that leave a room unreachable, a habitable room without daylight, or the front door opening into a bedroom.
- **What it guarantees.** Nothing outside the rectangle changes, and pinned neighbours are never touched.
- **How options are ranked.** By plan sense.
- **Plumbing.** It's the existing `room_variations` intent with two or more rooms, so it needs no new intent. Results are ordinary Proposals: apply, undo, or save as a concept.
- **In the UI.** The room card's AI tab lists the rooms beside the selected one (`neighbourRooms`). Tick some and choose "Lay out these rooms again"; options appear in the AI Designer chat.

### Pins and generation

Pins act only inside the open concept, and region results are Proposals on it. Generating from the brief still starts from the empty shell, and pins don't carry over to new concepts.

### Swapping rooms

- A swap lays both rooms out again for their new use, in one undo step.
- If the swap leaves either room breaking a plan-sense rule it didn't break before, the notice says what to check. The swap still goes ahead.

## Consequences

- Drafted's "select and regenerate" works for rooms in a row, which covers the common case: bedrooms along a hall, or the day zone's rooms.
- **Still open:**
  - **Wing mode.** A selection that includes the hall needs a region outline, a list of which walls are real outside walls, and building into the existing document.
  - **Brief changes with pins.** "Add an office" re-plans from the shell. It should re-plan around pinned rooms, growing an auto-sized outline.
  - **Multi-select on the canvas.** Shift-click is still to come; today the room card's list of neighbours stands in for it.
  - **Placing rooms before generating.** This is Drafted's canvas input, recorded in TODOS.md.
