# ADR 0003 — Furniture and fittings

- Status: accepted. Implemented 2026-10-08.
- Date: 2026-10-08
- Builds on: [ADR 0001](0001-plan-document-and-geometry.md), [ADR 0002](0002-project-variants-and-design-intent.md)

## Context

Several parts of the editor were waiting on furniture:

- the Furniture tool, the room card's Furniture tab, and the 3D "Show furniture" toggle;
- the room goals *Add storage*, *Add kitchen island*, *Create dining zone* and *Add an ensuite*, which the room planner turned down;
- concepts in Designs, which read as empty boxes rather than homes.

## Decisions

### Plan schema v3

`Level.furniture: Record<Id, Furniture>` is added. A v2→v3 step in `migrateToCurrent` adds an empty record, so older files and autosaves keep loading.

```ts
Furniture {
  id, kind,                // one of FURNITURE_KINDS (28 pieces)
  position: Point2,        // centre of the footprint
  rotation: 0 | 90 | 180 | 270,  // quarter turns CCW; at 0 the back faces north (+y)
  width, depth, height     // metres; width across the front, before rotation
}
```

- **Quarter turns only.** Walls are orthogonal, so every footprint stays an axis-aligned rectangle. Collision, snapping and layout all stay simple. Free angles can come later through another schema step.
- **The room is derived, not stored.** A piece belongs to whichever room contains its position (`roomAtPoint`). Wall edits never have to update furniture, and furniture never has to be reconciled like rooms are.
- **Furniture never blocks an edit.** Commands check only the piece itself: a known kind, a quarter turn, sizes within `FURNITURE_LIMITS`. Where it stands is reported by `furnitureIssues(level)`: outside every room, into a wall, in a door swing, or overlapping another piece. These show as red outlines in Designs and a note in the inspector. A wall move that leaves a sofa half inside a wall is therefore allowed, and the sofa is flagged.

### Commands

`addFurniture`, `updateFurniture` (position, rotation, size), `deleteFurniture`, and `replaceFurniture { remove, add }`. `replaceFurniture` furnishes or clears a room or a whole plan as one undoable step. None of them touch geometry, so rooms are not reconciled.

### Catalog and automatic layout (`src/domain/furniture/`)

- `catalog.ts`: kinds, labels, typical sizes, heights, `placement` ("wall" or "free"), and the clearance needed in front of each piece. `ROOM_FURNITURE` lists what each room type usually holds.
- `geometry.ts`: footprints, the item frame ↔ plan mapping, and turning.
- `layout.ts`: a room's context. This covers its floor, its wall faces (with which side is wall), door swing and passage zones, window strips, and what already stands there. It also has the placement checks, `wallSpots` and `freeSpots`.
- `furnish.ts`: one rule-based recipe per room type. For example: the bed goes against a wall without the door, with bedside tables either side. The sofa faces a TV on the opposite wall. Kitchen units go along the best wall, with the fridge at one end. Recipes are deterministic like the strip planner, and every piece they place is clear of walls, doors and other pieces. What doesn't fit is returned as `missing` rather than forced in.
- `issues.ts`: the placement problems described above.

### Planners

- The strip planner furnishes every layout it generates.
- The room planner now acts on:
  - `add_storage`: the widest wardrobe or shelving on each free wall.
  - `add_kitchen_island`: kitchen units first if there are none, then islands with room to walk round.
  - `create_dining_zone`: a table for 6 or for 4.
  - `add_ensuite`: walls off a corner of a rectangular bedroom that doesn't hold the bedroom's door. It adds a door into the new room and fits a shower, toilet and basin. The bedroom keeps its name, type and a usable area.
- Options that move walls lay out again any changed room whose furniture would end up in the way.
- `improve_privacy` is still recorded as intent only.

### Editor

- Furniture is worked on in **Designs**:
  - the Furniture tool (U) with its catalog;
  - selecting and dragging with Select;
  - Shift+R to turn, arrow keys to nudge, ⌘D to duplicate, Delete to remove;
  - the inspector card;
  - the room card's Furniture tab: Furnish room, Add a piece, Remove all;
  - "Furnish empty rooms", "Lay out every room again" and "Remove all furniture" under More.
- Structure draws furniture faded, and it can't be selected there.
- Pieces that stand against walls snap: within reach of a wall face they turn to put their back to it, sit flush, and centre on the wall or sit flush with its ends. Alt places a piece without snapping.
- 2D symbols are built as pure data (`rendering/scene/furnitureSymbols.ts`). The canvas, the SVG plan drawings and the catalog thumbnails all draw from them.
- 3D massing is pure data (`rendering/three/furnitureModel.ts`): a few boxes per piece. They are capped at the cutaway height in the dollhouse view and can be hidden with "Show furniture".

## Consequences

- Schema v3 is a breaking format change; the migration keeps v1 and v2 files loading.
- Generated concepts are larger documents (about 15–30 pieces per plan for a three-bedroom brief). Autosave stays small because records are shared.
- Clicking a room's centre in Designs can now select its furniture. Clicking empty floor, or the room in the Layers list, selects the room.
