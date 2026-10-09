# Floor-plan editor — Milestone 1

A desktop-first browser editor for residential ground-floor plans:

- Create a house of any right-angle shape (rectangle, L, T, U, Z, or drawn by its corners) and partition it with connected internal walls.
- Name the enclosed rooms.
- Place doors and windows, and mark the rear wall.
- Edit accurately with dimensions, snapping and undo/redo.

Built with Next.js, TypeScript, Konva (`react-konva`), Zustand and Zod.

## Running

```bash
npm install
npm run dev          # http://localhost:3100
```

To have Claude read requests in the AI Designer, put an Anthropic API key in `.env.local` at the project root (git ignores it):

```bash
ANTHROPIC_API_KEY=sk-ant-...
```

For photo renders of rooms, also add a Google AI Studio key (each photo is a paid call; optional `GEMINI_IMAGE_MODEL` picks the model, default `gemini-3.1-flash-image`, and `GEMINI_DAILY_LIMIT` caps photos per day):

```bash
GEMINI_API_KEY=...
```

Both keys stay on the server (`/api/design/interpret`, `/api/design/render`). Visitors are limited to 30 AI requests and 20 photos per 10 minutes. If Claude hasn't answered within 25 seconds, the built-in reader answers instead; a photo gives up after 50 seconds. Browser tests run with both keys blanked, so they never make paid calls.

| Script              | Purpose                                                    |
| ------------------- | ---------------------------------------------------------- |
| `npm run typecheck` | Strict TypeScript                                          |
| `npm run lint`      | ESLint, including the domain dependency boundary           |
| `npm test`          | Headless Vitest suites (geometry, commands, editor, persistence) |
| `npm run build`     | Production build                                           |
| `npm run test:e2e`  | Builds, then runs Playwright browser workflows             |
| `npm run check`     | All of the above                                           |
| `npm run eval`      | Opt-in: scores Claude's reading of about 30 example requests |

Playwright uses port 3110 by default (`E2E_PORT` overrides it). Run `npx playwright install chromium` once before the first run. The visual spec writes screenshots to `test-results/visual/`.

The eval makes a paid call per example, so it only runs with the key set in the shell (`ANTHROPIC_API_KEY=sk-ant-... npm run eval`) and skips itself otherwise. It prints the pass rate and every example that didn't match.

## Deploying

The app has no accounts, so anyone who can reach a deployed copy can spend from its API keys. Before a public deploy:

- **Set a spend limit with each provider.** This is the real ceiling; everything the app does is per server instance.
  - Anthropic: a spend limit on the workspace the key belongs to.
  - Google: a budget on the Cloud project behind the Gemini key. Budgets alert rather than stop spending, so also lower the image model's requests-per-day quota.
- **Set `TRUSTED_PROXY_HOPS`** to the number of proxies in front of the app. Each proxy adds the address it was reached from to the end of `x-forwarded-for`, and a visitor can write anything before that, so the per-visitor limits count from the right.
  - `1` (the default): one load balancer or platform edge, as on most hosts.
  - `2` or more: for example a CDN in front of the host's own proxy.
  - `0`: a proxy that sets `x-real-ip` instead, such as nginx with `proxy_set_header X-Real-IP $remote_addr`.
  - Without a proxy the app can't tell visitors apart reliably, so put one in front.
- **Optionally cap each day.** `CLAUDE_DAILY_LIMIT` and `GEMINI_DAILY_LIMIT` cap the AI requests and photos answered per day (UTC). Only successful calls count. Each instance keeps its own count, so on a host that runs several, the caps slow spending down but don't bound it.
- **Allow long requests.** The routes declare `maxDuration`: 30 seconds for Claude, 60 for photos. Hosts with a shorter limit end them early.

## Using the editor

The plan fills the window. All controls float above it:

- **Top bar:** project name and menu (house dimensions, new house, open file, restore autosave), the numbered steps Structure / Rooms / Design / 3D, undo and redo, save status, Share, Export and **Next** (on to the next step).
- **Left:** the toolbar, with the active tool's options beside it.
- **Right:** the inspector, which appears only when something is selected.
- **Bottom right:** view controls.

| Tool   | Key | Action                                                                                         |
| ------ | --- | ---------------------------------------------------------------------------------------------- |
| Select | V   | Select walls, openings and rooms. Drag internal walls, wall end handles, openings and opening edges. Drag outside walls to reshape the house, Alt-drag for a bay or recess, and drag the corner squares of a selected outside wall to cut notches. |
| Room   | R   | Click an enclosed room to edit its name and use.                                               |
| Wall   | W   | Click a start point, then click each end. Walls stay horizontal or vertical. Esc ends the chain. |
| Outline | O  | Click the outside corners of a new house; Enter or the first corner finishes, Backspace takes a corner back. Asks before replacing a house with rooms. |
| Door   | D   | Hover a wall to preview, click to place.                                                       |
| Window | N   | Hover a wall to preview, click to place.                                                       |
| Furniture | U | Design only. Pick a piece from the catalog, then click in a room to place it.              |

Workspaces:

- **Structure (1)** edits the shell: walls, doors and windows.
- **Rooms (2)** picks the rooms (see *Start from rooms* below).
- **Design (3)** works with whole rooms and their furniture. Clicks select rooms or furniture, and rooms are tinted by type. A selected room offers *Redesign this room* and suggestions such as *Add storage*, *Add kitchen island* or *Add an ensuite*. These come back as options to apply.
- **3D (4)** shows the house, with its furniture, in 3D.

Rooms:

- Every room has a **type**: Living Room, Kitchen, Kitchen / Dining, Dining Room, Bedroom, Primary Bedroom, Bathroom, Ensuite, WC, Utility, Hall, Office, Storage, Garage, Other or Unassigned.
- Changing the type of a room with a generated name ("Room 2") renames it ("Bedroom"). Names you typed are kept.
- **Target area** is optional, and the inspector shows how the actual clear area compares.
- *More settings* holds minimum and maximum area, floor material, and outside-wall preference.

House shapes:

- New projects, the **New house** dialog and the house card's **Change shape…** offer rectangle, L, T, U and Z presets with their wing sizes.
- Layouts fill any right-angle outline. Rectangles use the strip planner; other shapes use the wing planner, which splits the outline into wings, runs one connected hall through them and fills each wing with rooms.
- When the house is sized from the rooms, the brief's **House shape** (Any, Rectangle, L, T or U) lets the planner shape it too. Typing "make it L-shaped" or "a courtyard house" sets it.

Start from rooms (like drafted.ai):

- **Pick your rooms** on the home screen or the new-project page takes an optional maximum plot size, then opens the editor's **Rooms** step. A typical family home is picked to start with.
- **Rooms (2)** is a list of room cards (master, double and single bedrooms, ensuite, family bathroom, WC, open-plan or separate kitchen, dining and living rooms, office, utility, garage), each with a tick and a counter. An ensuite needs a master bedroom.
  - **Presets** fill in a whole house in one go (starter, family homes, bungalow, work from home, annexe). **Inspiration** does the same from example homes.
  - **More options** holds the room sizes, accessibility, preferences and notes.
  - Beside the list, a live 3D preview of the first layout updates as you pick, with room names and areas. It switches between 3D view, 2D plan and Split; Show dimensions; Orbit, Walk, Interior and Exterior cameras; and daylight. **Render photo** turns the preview into a realistic picture with Google Gemini (one paid call, not saved).
- **Generate layouts** (or **Next** in the top bar) sizes each house from the rooms (compact, wide or deep footprints) and opens the concepts in **Design**. Generate more keeps sizing houses from the rooms; the brief can switch to a fixed house size.
- Each concept shows its rooms as 3D pictures. In a concept's **Rooms** tab, **Render rooms** turns them into realistic photos with Google Gemini (see below), in the interior style you choose. Photos are kept with the project in this browser and marked out of date when the room or the style changes.

Brief and AI Designer:

- The **Rooms** step is the brief: the rooms picked, preferences, room sizes and free-text notes. The brief is saved with the project.
- **Generate layouts** asks the layout planner for three alternatives. They open in **Design**, and the plan you were editing is never changed.
- The planner is deterministic. It places two bands of rooms either side of a hall, across the depth or the width of the house. If the brief doesn't fit, it relaxes it step by step (combining kitchen and dining, then going open-plan), and each layout lists those compromises.
- The **AI Designer** beside a plan in Design takes requests in your own words. Room changes come back as options to apply, undo, or keep as a separate concept; new rooms go into the brief.
- With an Anthropic API key set up (see below), **Claude** reads those requests and the brief's notes. It only turns words into room goals and brief changes; the planners draw everything, and every option is checked like a hand edit. Without a key, a simpler built-in reader handles typed requests and the notes are kept but not read.

Furniture:

- Generated layouts arrive furnished. Each room is laid out from its type: beds against a wall away from the door, sofas facing a TV, kitchen units along the best wall, and so on.
- In Design, the room card's **Furniture** tab lists what's in the room. **Furnish room** lays it out (again), and **Add a piece** opens the Furniture tool with that room's usual pieces. The toolbar's **More** menu furnishes every empty room, lays out every room again, or removes all furniture.
- Pieces that stand against walls snap as you place or drag them. Near a wall they turn to put their back to it, sit flush, and centre on the wall or sit flush with its ends. Hold **Alt** to place freely.
- With a piece selected:
  - **Shift+R** turns it a quarter turn.
  - The arrow keys nudge it 50 mm (500 mm with Shift).
  - **⌘D** duplicates it.
  - **Delete** removes it.
  - The inspector sets its exact width, depth and height, and shows the gaps to the walls around it.
- Furniture never blocks an edit. A piece that ends up in a wall, a door swing or another piece is outlined in red, and the inspector says why.
- Structure shows furniture faded. In 3D it can be hidden with **Show furniture**.

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
- Plans saved by earlier versions are upgraded automatically: schema v1 (rooms with a "use"), v2 (no furniture) and v3 (a rectangle-only envelope). Plan files are now schema v4; older builds of the editor refuse them.

## Structure

```text
src/
  app/                      Next.js shell (editor loads client-side only) and the AI route
  components/ui/            Accessible controls and icons
  domain/
    plan/                   Schema (Zod), types, defaults, migrations, room types
    brief/                  HouseBrief schema and preference vocabulary
    design/                 Design intents, planner interface, deterministic strip, wing and room planners
    furniture/              Furniture catalog, footprints, room layouts, placement problems
    project/                ProjectDocument: brief + plan variants with lineage
    geometry/               Axes, contacts, faces, footprints, clear areas, envelope, outlines and their presets, wing partitions
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
  server/                   Server-only code: the Claude request reader, Gemini photo renders, rate limits
tests/
  geometry/ commands/ editor/ persistence/ design/   Vitest
  furniture/ server/                         Vitest
  eval/                                      Opt-in Claude eval (npm run eval)
  e2e/                                       Playwright
docs/adr/0001-plan-document-and-geometry.md  Units, references, topology, derived data
docs/adr/0002-project-variants-and-design-intent.md  Rooms, brief, variants, intent → planner
docs/adr/0003-furniture.md                 Furniture schema, commands, layouts, snapping
docs/adr/0004-claude-request-reader.md     Claude reading requests and brief notes into intent
docs/adr/0005-rooms-first-and-photo-renders.md  Houses sized from rooms; 3D stills; Gemini photo renders
docs/adr/0006-rooms-step.md                The Rooms step
docs/adr/0007-orthogonal-outlines.md       Right-angle outlines, the wing planner, shapes from rooms, outline editing
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
- Angled walls (outlines are right-angle only)
