# Floor-plan editor — Milestone 1

A desktop-first browser editor for residential ground-floor plans:

- Create a rectangular house and partition it with connected internal walls.
- Name the enclosed rooms.
- Place doors and windows, and mark the rear wall.
- Edit accurately with dimensions, snapping and undo/redo.

Built with Next.js, TypeScript, Konva (`react-konva`), Zustand and Zod.

## Running

```bash
npm install
npm run dev          # http://localhost:3100
```

| Script              | Purpose                                                    |
| ------------------- | ---------------------------------------------------------- |
| `npm run typecheck` | Strict TypeScript                                          |
| `npm run lint`      | ESLint, including the domain dependency boundary           |
| `npm test`          | Headless Vitest suites (geometry, commands, editor, persistence) |
| `npm run build`     | Production build                                           |
| `npm run test:e2e`  | Builds, then runs Playwright browser workflows             |
| `npm run check`     | All of the above                                           |

Playwright uses port 3110 by default (`E2E_PORT` overrides it). Run `npx playwright install chromium` once before the first run. The visual spec writes screenshots to `test-results/visual/`.

## Using the editor

The plan fills the window. All controls float above it:

- **Top bar:** project name and menu (house dimensions, new house, open file, restore autosave), the Structure / Design / 3D switcher, undo and redo, save status, Share and Export.
- **Left:** the toolbar, with the active tool's options beside it.
- **Right:** the inspector, which appears only when something is selected.
- **Bottom right:** view controls.

| Tool   | Key | Action                                                                                         |
| ------ | --- | ---------------------------------------------------------------------------------------------- |
| Select | V   | Select walls, openings and rooms. Drag internal walls, wall end handles, openings and opening edges. |
| Room   | R   | Click an enclosed room to edit its name and use.                                               |
| Wall   | W   | Click a start point, then click each end. Walls stay horizontal or vertical. Esc ends the chain. |
| Door   | D   | Hover a wall to preview, click to place.                                                       |
| Window | N   | Hover a wall to preview, click to place.                                                       |

Workspaces:

- **Structure (1)** edits the shell: walls, doors and windows.
- **Design (2)** works with whole rooms. Clicks select rooms and rooms are tinted by type. A selected room offers *Redesign this room* and suggestions such as *Add storage*. These are recorded as structured requests; room-level redesign isn't implemented by the planner yet, and the editor says so.
- **3D** is not built yet.

Rooms:

- Every room has a **type**: Living Room, Kitchen, Kitchen / Dining, Dining Room, Bedroom, Primary Bedroom, Bathroom, Ensuite, WC, Utility, Hall, Office, Storage, Garage, Other or Unassigned.
- Changing the type of a room with a generated name ("Room 2") renames it ("Bedroom"). Names you typed are kept.
- **Target area** is optional, and the inspector shows how the actual clear area compares.
- *More settings* holds minimum and maximum area, floor material, and outside-wall preference.

AI Designer (**A**, or the sparkle button in the toolbar):

- Edit the **brief**: bedrooms, bathrooms, required spaces, preferences, and free-text instructions. The brief is saved with the project.
- **Generate layouts** asks the layout planner for three alternatives. They are added as **Plan A, B, C…** in the variation tray at the bottom of the canvas. The plan you were editing is never changed.
- The current planner is deterministic. It places two bands of rooms either side of a hall, across the depth or the width of the house. If the brief doesn't fit, it relaxes it step by step (combining kitchen and dining, then going open-plan), and each layout lists those compromises. It doesn't read the free-text instructions yet.

Variations:

- The tray appears once a project has more than one plan. Click a plan to edit it; each plan keeps its own undo history.
- Double-click a plan to rename it, and use × then *Delete* to remove it.
- **+ Variation**, or **Project menu → New variation of this plan**, copies the current plan.

Direct manipulation comes first, then simple controls, then precise values:

- **Doors and windows:**
  - Drag them along their wall. They snap to the centre of their stretch of wall, flush to a corner, or to the half-grid.
  - Drag a selected opening's edge handles to resize it.
  - While one is selected, its width and its clearance to the corners on either side are shown in mm.
  - The inspector has width, height and sill (mm), a position slider, door flip buttons, and the exact offset under *More settings*.
- **Walls:** drag internal walls and their end handles. A live length shows while you drag. Exact length, thickness and height are in the inspector.
- **House:** outside width and depth are under **Project menu → House dimensions…**, or select an external wall and edit its length.

Other controls:

- **Delete / Backspace** deletes the selection.
- **Esc** cancels a drag, ends a wall chain, clears the selection, then returns to Select.
- **⌘Z / ⌘⇧Z** (Ctrl+Z / Ctrl+Y on other platforms) undo and redo.
- **L** toggles the Layers list, which gives keyboard access to every room, wall and opening.
- **Zoom** with the wheel (centred on the cursor), **+ / −** or **F** (fit plan).
- **Pan** with Space-drag or middle-button drag.

Shortcuts never fire while you are typing in a field.

Snapping prefers endpoints and junctions, then wall axes, then the 100 mm grid. It uses an 8 px screen radius, so it behaves the same at every zoom level.

Measurements:

- House width and depth are outside-face dimensions.
- Wall lengths are centreline (axis) lengths.
- Opening offsets run from the wall start along the centreline.
- Room areas are clear floor areas between wall faces.

Saving:

- The whole project (brief and every plan) autosaves to this browser (IndexedDB), and the previous revision is kept for recovery.
- **Export → Project file** downloads the native JSON project format.
- **Export → Image** downloads a PNG of the current view, without selection overlays.
- **Project menu → Open project file** validates every plan before anything is replaced. A project file replaces the open project; *Restore previous autosave* brings back what you had. A single-plan file in the earlier format opens into the current plan as one undoable step.
- Plans saved by earlier versions (schema v1, rooms with a "use") are upgraded automatically.

## Structure

```text
src/
  app/                      Next.js shell (editor loads client-side only)
  components/ui/            Accessible controls and icons
  domain/
    plan/                   Schema (Zod), types, defaults, migrations, room types
    brief/                  HouseBrief schema and preference vocabulary
    design/                 Design intents, planner interface, deterministic strip planner
    project/                ProjectDocument: brief + plan variants with lineage
    geometry/               Axes, contacts, faces, footprints, clear areas, envelope
    commands/               applyCommand, validation, room reconciliation, import/export
  editor/
    state/                  Document store with history, session state, save status
    tools/                  Tool controller, snapping, hit testing
    components/             Editor app, dialogs, keyboard shortcuts
      shell/                Top bar, floating toolbar, tool options, layers, view controls, status
      inspector/            Floating contextual inspector cards
      designer/             AI Designer panel, variation tray, plan thumbnails
    rendering/scene/        Pure document → 2D scene derivation
    rendering/konva/        Konva adapter
    viewport/               Metres ↔ pixels, zoom, pan, fit
  persistence/              IndexedDB autosave, JSON files
tests/
  geometry/ commands/ editor/ persistence/ design/   Vitest
  e2e/                                       Playwright
docs/adr/0001-plan-document-and-geometry.md  Units, references, topology, derived data
docs/adr/0002-project-variants-and-design-intent.md  Rooms, brief, variants, intent → planner
```

Domain code must not import React, Konva, browser APIs or editor state. ESLint enforces this.

## Out of scope for Milestone 1

- AI or extension generation
- 3D
- Planning rules
- Address lookup
- Costing
- BIM/CAD export
- Multiple storeys
- Angled walls
