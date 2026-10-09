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

### Lot polygon, setbacks, street side and north

**What:** Replace "plot max width/depth" with a lot outline, setbacks, which side the street is on, and a north arrow. The planner then fits the buildable area, puts the entrance on the street, and turns the garden and living rooms to the sun.

**Why:** Drafted's canvas stands for your lot. We always assume the street is to the south (`geometry/outlinePresets.ts`), and the north badge only means "up" (`CanvasControls.tsx`).

**Context:** `ProjectDocument.sizing.plot` holds only `maxWidth`/`maxDepth` (`src/domain/project/schema.ts`). The plan-sense rule "front door on the street side" needs a real street side to mean anything.

**Effort:** L
**Priority:** P2
**Depends on:** the zone planner and `sense.ts`.

## Accounts

### Accounts, server storage and Share links

**What:** Sign-in, projects stored on a server, and Share links with view, comment and edit permissions.

**Why:** The Share button is disabled ("coming soon", `TopBar.tsx`). Clearing browser data loses every project. Accounts also give real per-user AI quotas, replacing today's per-instance caps.

**Context:**
- Persistence is IndexedDB v3 (`src/persistence/planStorage.ts`) plus JSON files. There's no backend.
- The project format is versioned and validated, so it's ready to store on a server.

**Effort:** XL
**Priority:** P2
**Depends on:** a hosting decision.

## 3D

### Pitched and gabled roofs

**What:** Hip or gable roofs per wing with a pitch setting, instead of the flat roof with a parapet.

**Why:** A flat parapet roof on a family bungalow looks like a commercial unit, and Gemini photos keep that shape. Drafted shows gabled roofs.

**Context:** `houseModel.ts` builds the flat roof. The wing partition (`geometry/partition.ts`) already gives the per-wing rectangles a roof needs. ADR 0007 lists this as open.

**Effort:** M
**Priority:** P3
**Depends on:** None.

## Units and storeys

### Imperial units

**What:** Feet and inches, and square feet, for display and input.

**Why:** Drafted switches between imperial and metric. The Units select is disabled until this exists.

**Context:** Everything inside stays in metres. This is a formatting and parsing layer over the inspectors, dimensions, room areas and the new-project form.

**Effort:** M
**Priority:** P2
**Depends on:** None.

### More than one storey

**What:** Upper floors and basements, with stairs.

**Why:** Drafted lists it as in progress too. The Floors select is hidden until this exists.

**Context:** `PlanDocument.levels` is already an array, but every planner, scene and render uses `levels[0]`. This also needs stairs, stacking wet rooms, and 3D.

**Effort:** XL
**Priority:** P4
**Depends on:** pins and region regeneration.

## Completed
