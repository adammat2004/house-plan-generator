# ADR 0001 — Plan document, units, wall references and derived geometry

- Status: accepted
- Date: 2026-10-07
- Scope: Milestone 1 (single ground-floor level, orthogonal walls)

## Context

The editor needs one authoritative, serialisable description of a house plan that:

- can be validated without a browser, React or Konva;
- survives autosave, JSON import/export and undo/redo exactly;
- will later feed generation, validation, 3D and export adapters without a redesign.

Interactive editing (drags, snapping, selection) must never become a second source of truth.

## Decisions

### Units and coordinates

- All lengths and coordinates are **metres**; areas are **square metres**. The document records `units: "m"`.
- Plan space is right-handed: **X right, Y up**. Elevation will be Z. Only the viewport flips Y for the screen.
- The lower-left **outside** corner of the house is the origin `(0, 0)`. It stays fixed when the house is resized.
- Tolerances live in `src/domain/geometry/numeric.ts`:
  - `EPS = 1e-6 m` for numerical comparison.
  - `EDIT_PRECISION = 0.001 m`: every committed coordinate and length is rounded to the millimetre.
  - Grid snapping (default 100 mm) is an interaction aid only and is not part of the document.

### Walls and references

- A wall references two **vertices** by id. Its geometry is its **centreline** (axis) plus `thickness` and `height`.
- Corners and chains share a vertex. A tee is a vertex lying on another wall's axis. A crossing is two axes intersecting at their interiors. Tees and crossings are **derived** from geometry and never stored as references, so wall ids stay stable when junctions appear or disappear.
- The envelope is exactly four `external` walls, listed counterclockwise from the south wall. They form a locked rectangle. The user changes outside width and depth; dragging or deleting external walls is refused.
- Entered house width and depth are measured **outside face to outside face**. Centrelines are inset by half the external thickness.
- M1 validation accepts only horizontal and vertical walls. The vertex/segment schema can represent angled walls later.

### Openings

- Doors and windows are hosted features: `wallId` plus `offset` (wall start to opening start, along the axis) and `width`.
- An opening must fit within one **host interval**: the wall axis minus the zones (±½ thickness) occupied by perpendicular walls at corners, tees and crossings. Openings never split walls and never merge rooms.
- When a wall's start vertex moves along the wall (stretching or resizing), offsets are adjusted so openings stay fixed in plan. When a whole wall slides sideways, its openings move with it.

### Rooms

- A room record holds identity and user metadata (`name`, `usage`) plus a `seed` point. Room geometry is never stored.
- Enclosed regions come from the planar graph of wall axes:
  1. Split the axes at every contact.
  2. Prune dangling filaments and bridges.
  3. Trace faces; bounded faces are counterclockwise.
  4. Attach freestanding components as holes of the smallest face containing them.
- Clear floor area is the face minus the union of wall footprints. It is measured between internal wall faces and includes joins. Polygon booleans go through a small adapter over `polygon-clipping`.
- After every geometry change, rooms are reconciled with new regions by maximum overlap:
  - Each old room claims the region it overlaps most; ties go to the lower region index.
  - When several rooms claim one region (a merge), the one with the largest overlap survives; ties go to the lower room id.
  - Unclaimed regions (for example the smaller children of a split) get new rooms with default names.
  - A seed is kept while it is still inside its region; otherwise it moves to an interior point.
- Invariant: every enclosed region has exactly one room, and every room's seed lies in exactly one region.

### Derived data is not persisted

The document never stores footprint dimensions, room polygons, wall surface polygons, junctions or areas. Derivations are cached by the identity of the immutable `walls`, `vertices` and `envelope` records. Editing room names or openings therefore reuses topology, and per-face clear regions are reused across drag frames.

### Commands

- `applyCommand(document, command) → CommandResult` is pure and atomic:
  transform → derive topology → reconcile rooms → validate → commit.
- A failure returns structured issues (`code`, `message`, `entityIds`). The caller keeps its last valid document.
- New ids come from outside the transformation: the editor passes a random `idPrefix` per command or gesture. Without a prefix, a deterministic, collision-free scheme is used, which keeps tests reproducible.
- Drag previews run the same command path without committing. One completed drag is one history entry. Escape cancels it. Pan, zoom, selection and hover are session state outside the document and outside history.
- Wall moves slide a wall, together with collinear segments continuing it, perpendicular to its axis. Attached perpendicular walls stretch to follow. A move is rejected if it would disconnect a junction, collapse an attached wall, or pass through a parallel wall.

### Persistence and versioning

- The native project format is JSON with `schemaVersion: 1`. `migrateToCurrent` is the single entry point for future upgrades.
- Imported files and autosaves must pass migration, Zod structural parsing and full geometric validation before they replace anything. Newer versions are refused with a clear message.
- Autosave writes only committed documents to IndexedDB, debounced, and rotates the previous saved revision into a recovery slot in the same transaction.

## Consequences

- The domain (`src/domain`) has no React, Konva, browser or editor-state imports. ESLint enforces this. All geometry and commands are covered by headless Vitest suites.
- Konva only draws a scene derived from the document. Hit testing and snapping use domain geometry in world coordinates.
- Adding levels, angled walls or new opening types extends the schema and validation. It does not change how references work.
- Room identity follows a geometric policy. Splits and merges can reassign metadata in ways the user may want to correct, which renaming handles.
