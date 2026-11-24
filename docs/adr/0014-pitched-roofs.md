# ADR 0014 — Pitched roofs

- Status: accepted. Implemented 2026-10-19 (step 1 and the roof half of step 3 of the Drafted gap plan); the prototype stills were signed off by the user.
- Date: 2026-10-19
- Builds on: [ADR 0007](0007-orthogonal-outlines.md), [ADR 0010](0010-floors-and-stairs.md), [ADR 0011](0011-shaped-two-storey-houses.md)

## Context

Every house had a flat roof with a parapet. Drafted's V2 (July 2026) switches between hip and gable roofs, and a flat roof made our exteriors read as boxes. The 10-13 look-alike plan pulled hipped roofs in, with a prototype gate: stills of a rectangle, L, T, U and a two-storey house signed off before the rest was built.

## Decisions

### Geometry (`rendering/three/roofModel.ts`)

- **Hips from the largest rectangles.**
  - A right-angle outline is covered by its maximal rectangles, which overlap. They are found on the grid of the outline's own lines.
  - Each rectangle gets a hipped roof at one pitch.
  - The highest of them at each point is the roof. For a right-angle outline that is its straight skeleton, so hips, ridges and the valleys where wings meet need no special cases.
  - A test checks this on every named outline: the roof's height equals the pitch times the L∞ distance to the eaves.
- **Sizes.** 35° pitch, 0.4 m overhang, a 0.2 m fascia.
- **Lean-tos.** On a house of more than one floor, the top floor is hipped. Any part of a lower floor left open gets a lean-to.
  - Sides against an upper wall have no eave.
  - The pitch is at most 20°, and shallower where needed, so the roof stays 0.75 m under the upper floor's sills.
- **Drawing.**
  - Pieces are drawn as solids that run into each other.
  - Faces that share a plane (two wings' slopes over one eave) are merged first (`roofSurfaces`), so they don't flicker.
  - The fascia takes the window frames' colour.

### Data and defaults

- **Data.** `appearance.roofForm` is an optional `"hipped" | "flat"`.
- **Saved projects.** A project without it is flat, as it was made. Its exterior photo key is unchanged, so its photos stay current.
- **New projects.** A project made now starts as `NEW_PROJECT_APPEARANCE`: hipped, in slate. This applies through `addNew` in `home/library.ts`; an imported file keeps its own look.
- **Finishes.** Slate and clay tile join membrane and zinc. A membrane is offered only on a flat roof, slate and tile only on a pitched one.
- **Links.** "Send to my computer" links carry the look.
- **Photos.** The Gemini prompt names the roof: "a hipped natural slate roof with deep eaves". Stills frame the house by its full height, roof included.

## Not done

- A pitch per wing. (Gables were built on 2026-10-25, and a house-wide pitch in ADR 0019.)
  - A gable uses the same machinery: eaves on the long sides only, with the short sides as walls.
- Roof lights and chimneys.
