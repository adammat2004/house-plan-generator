# TODOS

Deferred from the Drafted-parity engineering review (2026-10-09). The work in scope is the plan for a generator that makes sense plus Drafted-style editing (pins, regenerate selection, dragging walls in Design).

## Design workspace

### Place rooms on a canvas before generating

**What:** In the Rooms step, let people drag the rooms they picked onto the house outline as soft hints or hard pins before generating. A bubble diagram (which rooms should be next to which) can come later.

**Why:** It's Drafted's signature input ("79% AI-Create / 21% placed by you"). Our Rooms step is a list of counters.

**Context:**
- Once pins and `planRegion` exist, a placed room is either a pinned room or a hint that the zone scorer rewards.
- Reuse those rather than building a parallel placement model.
- Say plainly whether a placed room is fixed or a suggestion. That ambiguity is the main complaint about Drafted's version.

**Effort:** L
**Priority:** P1
**Depends on:** room pins (`Room.locked`), band-mode `planRegion`, the access-graph zone planner.

### Zone layouts for U and T houses

**What:** Lay U and T outlines out as day and night zones, as rectangles and Ls already are.

**Why:** U and T houses still use the wing planner's skeleton: a hall strip with every room off it. They score 40–50 on plan sense, where zone layouts score 80–97.

**Context:**
- `planZoneColumns` (`design/zonePlanner.ts`) handles outlines that split into two columns running back from the street.
- A U is three columns. The middle one is shallower and is the natural home for the day zone, with a bedroom wing on each side. Each wing would need its own hall, joined across the front.
- `zoneFootprints` would propose U shapes the same way it proposes Ls.

**Effort:** L
**Priority:** P1
**Depends on:** None.

### Regenerate a selection that includes the hall (wing mode)

**What:** Let "Lay out again" take in the hall, re-planning its rooms and their circulation in an area of any right-angle shape.

**Why:** Band mode (`design/regionPlanner.ts`) only re-orders rooms that together fill a rectangle beside a hall. Drafted lets you redraw any area.

**Context:**
- Needs the region's outline plus which of its edges are real outside walls, so windows never land on walls shared with pinned rooms.
- Needs the emitter to build into the existing document, keeping the doors of pinned rooms that open into the region.
- Measure "unchanged" by geometry, since pinned and free rooms share wall records. ADR 0009 has the details.

**Effort:** L
**Priority:** P2
**Depends on:** None.

### Brief changes that keep pinned rooms

**What:** When the brief changes ("add an office") and rooms are pinned, re-plan the free area of the open concept around them. For a house sized from the rooms, grow the outline if needed; for a drawn house, refuse and give the area needed.

**Why:** Today a brief change re-plans from the empty shell, so edits and pins don't carry over.

**Context:** `layouts()` in `editor/state/design.ts` always plans from the root shell. Pins only act inside the open concept (ADR 0009).

**Effort:** M
**Priority:** P2
**Depends on:** Regenerate a selection that includes the hall.

### Retire the strip planner

**What:** Remove `buildLayout` in `design/stripPlanner.ts` once zone layouts cover small drawn houses. Port the strip sizer (`footprint.ts`) and the templates.

**Why:** It's the source of the corridor layouts. Today it remains only as a fallback for drawn houses too narrow for a day zone beside a night zone, such as 8 × 10 m for three bedrooms.

**Context:** The `plans:render` report and the scoreboard in `tests/design/sense.test.ts` show where it's still chosen.

**Effort:** M
**Priority:** P3
**Depends on:** Zone layouts for small houses (for example, a day zone across the front with the bedrooms behind).

## Export

### PDF export with dimensions, then DXF

**What:** Export a plan as a dimensioned PDF sheet: the plan, overall sizes, and a room schedule with areas. DXF for CAD users later.

**Why:** Drafted exports PDF, DXF, IFC and GLB; we have JSON, PNG and GLB. A PDF is what people hand to a builder or architect.

**Context:** `buildDimensions` (`src/editor/rendering/scene/planScene.ts`) already works out the dimension lines, and the Konva stage can render off-screen. There's no PDF dependency yet; pick one that runs client-side.

**Effort:** M
**Priority:** P2
**Depends on:** None. Most useful once the plans make sense.

## Site

### Lot outlines, and planning with north

**What:** Let the plot be any outline (not only a rectangle), and have the planners use north: turn the garden and living rooms to the sun, and put the entrance on the street.

**Why:** Drafted's canvas stands for your lot. The Map step now has a rectangular plot, the gaps to leave and north (`src/domain/project/site.ts`), and layouts fit what the gaps leave, but a corner or wedge plot can't be described, and north only turns the 3D sun and the compass.

**Context:** `ProjectDocument.site` holds `plot` (width along the street, depth back from it), `setbacks` and `north`; the street is always opposite the garden side, so plans never turn. `generationPlot` turns the site into the planners' `PlotLimits`. The plan-sense rule "front door on the street side" already uses the garden side.

**Effort:** L
**Priority:** P2
**Depends on:** the zone planner and `sense.ts`.

## Accounts

### Accounts, server storage and Share links

**What:** Sign-in, projects stored on a server, and Share links with view, comment and edit permissions.

**Why:** There's no way to share a project: the Share button was removed rather than left disabled (premium pass, 2026-10-10), and "Send to my computer" only copies one layout. Clearing browser data loses every project. Accounts also give real per-user AI quotas, replacing today's per-instance caps.

**Context:**
- Persistence is IndexedDB v3 (`src/persistence/planStorage.ts`) plus JSON files. There's no backend.
- The project format is versioned and validated, so it's ready to store on a server.

**Effort:** XL
**Priority:** P2
**Depends on:** a hosting decision.

## 3D

### Pitched and gabled roofs

**What:** Hip or gable roofs per wing with a pitch setting, instead of the flat roof with a parapet.

**Why:** A flat parapet roof on a family bungalow looks like a commercial unit, and Gemini photos keep that shape. Drafted shows gabled roofs. Needed for launch: the Layouts page's 3D still and every room photo show the roof.

**Context:** `houseModel.ts` builds the flat roof. The wing partition (`geometry/partition.ts`) already gives the per-wing rectangles a roof needs. ADR 0007 lists this as open.

**Effort:** M
**Priority:** P1
**Depends on:** None.

## Touch and phones

### Touch editing on tablets

**What:** Edit plans with touch on tablets: drag walls and furniture, pinch to zoom, long-press for the room menu.

**Why:** Phones and touch-only tablets under 1024px get a read-only Refine and 3D today; landscape iPads keep the mouse-style editor, which works but isn't designed for fingers.

**Context:** Read-only is one gate in `stores.ts` (`session.readOnly`). Hit targets are 44px under `pointer: coarse`, but drag handles and snapping are sized for a mouse.

**Effort:** L
**Priority:** P2
**Depends on:** None.

### Phone editor

**What:** Editing on phones: a bottom-sheet room panel, one tool at a time, and larger handles.

**Why:** Phones can pick rooms and compare layouts, then "Send to my computer" to edit. Some people only have a phone.

**Context:** Builds on touch editing. The phone layout for Rooms and Layouts already exists.

**Effort:** L
**Priority:** P3
**Depends on:** Touch editing on tablets.

### Phone tests in WebKit

**What:** Run the phone Playwright project in WebKit as well as Chromium.

**Why:** Most UK and Irish phone visitors use Safari; the phone project only runs Chromium.

**Context:** `playwright.config.ts` has a `phone` project at 390 × 844 with touch. WebKit needs its own WebGL check for the 3D still.

**Effort:** S
**Priority:** P2
**Depends on:** The phone Playwright project.

## Units and storeys

### Imperial units

**What:** Feet and inches for dimensions and input.

**Why:** Drafted switches between imperial and metric. Square feet beside areas have shipped (en-GB browsers by default, a Settings toggle otherwise; `domain/geometry/units.ts`), but lengths and inputs are metric only.

**Context:** Everything inside stays in metres. This is a formatting and parsing layer over the inspectors, dimension lines and the new-project form; the area preference in `components/units.ts` shows where a units setting lives.

**Effort:** M
**Priority:** P2
**Depends on:** None.

### Three-storey generation

**What:** Generate townhouses of three floors from the brief.

**Why:** The editor and 3D already take three floors (ADR 0010), but the generator stops at two, and the AI interpreter sends "three storeys" to unclear.

**Context:** It needs:
- a townhouse room split (living on the middle floor is common);
- stairs lined up through every floor;
- landings on the middle floor that wrap round the stairwell;
- a protected escape route.

`storeyPlanner.ts` builds one flight between two floors. A third floor needs `stairLine` repeated and the cross arrangement's middle band kept free on every floor.

**Effort:** L
**Priority:** P3
**Depends on:** None.

### Shaped two-storey houses: what's still open

**What:** The gaps left by ADR 0011.

**Why:** Each one leaves a shaped two-storey house less than it could be.

**Context:**
- **A floor the user drew upstairs** is replanned from scratch. Its outline could choose the core instead.
- **A wing upstairs beside a long landing** gets a study, or a bedroom grown into it. It could take a bedroom of its own, moved out of the core, with the core's upstairs replanned with one room fewer.
- **Generous outlines with small briefs** get snugs downstairs. A bedroom downstairs (a guest room in the wing) would use the space better when upstairs is short of room.
- **Very wide cores** are stacked in part (6.5–9.5 m), with the rest a wing. A third column of rooms, or a wider landing, would stack them whole.

**Effort:** M
**Priority:** P3
**Depends on:** None.

### Regenerating one floor

**What:** Lay out the first floor again while keeping the ground floor, or the other way round.

**Why:** A user happy with one floor can only regenerate the whole house.

**Context:** The stairs are fixed by the floor that's kept. Planning one floor means `storeyPlanner` with the stair position given, emitting into a `levelView` and splicing it back, as `buildStoreys` does.

**Effort:** M
**Priority:** P3
**Depends on:** None.

### Floors: what's still open

**What:** The smaller gaps left by ADR 0010.

**Why:** Each one is a place where a two-storey house still acts as if it were single-storey.

**Context:**
- **Walk** stays on the ground floor; climbing the stairs needs a ramp collider along the flight.
- **Pitched roofs** over the upper floor. Exposed lower roofs are flat by choice.
- **Inserting a floor** between two others. `addLevel` only adds at the top.
- **Room areas** count a stairwell's floor as the landing's area on the upper floor.
- **Basements**, which the user left out of scope.

**Effort:** M
**Priority:** P4
**Depends on:** None.

## Completed

### Two-storey houses of any shape (2026-10-12)

Two-storey layouts in every right-angle outline (ADR 0011). A core of the outline takes the stairs and the floor above; the other parts are wings of ground-floor rooms, single-storey under flat roofs, or built up with a bedroom grown into them. In shallow parts the stairs run along the street wall. The Rooms step sizes L, T and U two-storey houses from the rooms. The emitter's false "1 door or window didn't fit" note is gone.

### One Refine mode instead of Edit walls (2026-10-12)

Refine has one editing mode. The Rooms / Walls switch became a view switch, 2D Plan / Furnished: every tool works in both, and furniture shows (and can be picked) only when furnished. The `structure` workspace is gone; `hitRefine` picks furniture, then doors and windows, then walls, then rooms. An outside wall drags only once it's selected, so a stray drag can't move a side of the house.
