# 0018: Working like Drafted

Date: 2026-10-25. Status: accepted.

## Context

On 2026-10-25 the user asked for the app to work like drafted.ai, its UI and features, leaving accounts and sharing out for now. This pauses the site-first direction of 2026-10-20 (its site tracing stays). We copy behaviour and flow, never Drafted's name, logo, wording or images.

## Decisions

- **Five layouts a run**, lettered A–E (`LAYOUTS_PER_RUN`). Room variations stay at three. The plan limit is 60.
- **The Studio.** Requirements is one canvas: the live plan on a dot grid, a "My rooms" card with a tile per room (S/M/L for its size group, area, drag to place that very room, `pick#n`), an AI/placed mix bar, canvas controls with undo and redo of the brief (session only), a live 3D card, and a Create bar with total and heated area, storeys and shape. "Add rooms" swaps the tiles for the old list. Placements draw as named pills. Phones keep a stacked layout.
- **Gabled roofs** beside hipped: each largest rectangle gets eaves on its long sides and flush gable ends drawn in the wall finish. Roof unions snap to 0.1 mm and drop faces lying inside others; if a union still fails the faces are drawn as they are, and the viewer draws the house without its roof rather than crash.
- **Imperial units** as a display and input layer (`parseLength`, `feetInches`); the plan stays in metres.
- **Erase** (E): brush rooms (not halls or pinned rooms), then Regenerate: one room gets its variations, several go to band-mode `planRegion`.
- **Furnish & Render**: furnishes empty rooms, shows the plan furnished, and opens the render panel with a house style (`appearance.exteriorStyle`, part of the exterior prompt and key only when set) and camera spots put down on the plan (`StillTarget.room.spot`).
- **Drawing exports**: elevations, DXF and IFC are pure functions of the plan (`rendering/drawing/`); the PDF draws them through a small pen interface that jsPDF satisfies. jsPDF loads only when exporting.
- **Design history**: generated plans record the brief and time of their run (`origin.brief`, `origin.at`), so a run's rooms can be used again.
- **House plans**: a fixed catalogue of named houses (room preset × shape × storeys, with a style), laid out lazily as cards scroll in. Remix makes a project from its rooms with five layouts and its look.
- **Pictures**: a floor plan, inspiration or a site plan is read by Claude (`claude-opus-5`, structured output, server-side fallbacks) into rooms, shape, storeys and notes. Nothing changes until "Use this"; pictures are scaled down in the browser and not kept.

## Not done

Accounts and sharing (the user's call), the agent chat, and erasing across a hall: see TODOS.md.
