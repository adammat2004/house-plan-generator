# ADR 0006 — The Rooms step: pick rooms beside a live 3D preview

- Status: accepted. Implemented 2026-10-08.
- Date: 2026-10-08
- Builds on: [ADR 0005](0005-rooms-first-and-photo-renders.md)

## Context

The user sent a mockup for room picking ("Select your rooms", step 2 of 4): room cards with pictures and counters, Rooms / Presets / Inspiration tabs, and a large live 3D view of the house with room labels, view and camera controls.

They chose:
- to make it the editor's step 2, replacing the Brief workspace;
- a live 3D preview, with a photo on request;
- card pictures generated once with Gemini and shipped as static files.

## Decisions

### Room picks in the brief

- **Picks, not just counts.** `brief/rooms.ts` (pure) defines the room kinds you can pick: master, double and single bedrooms, ensuite, family bathroom, WC, open plan, kitchen, kitchen / dining, living room, dining room, office, utility and garage. Each kind has a label, a hint, a group and a limit.
  - `HouseBrief.rooms` is an optional partial record of counts, so the format is unchanged for older briefs.
- **One source of truth.** `withPicks(brief, picks)` derives `bedrooms`, `bathrooms` and `requiredSpaces` from the picks.
  - `normaliseBrief` reconciles the other way: if the counts or spaces change some other way (the Claude reader, older projects), the picks follow.
  - Older briefs get picks from their counts (`picksFromCounts`).
- **Rules.** `cleanPicks` drops an ensuite without a master bedroom and clamps each kind to its limit.
- **Program.** When picks are present, `programFromBrief` lays them out exactly:
  - single bedrooms are smaller than doubles;
  - the ensuite is attached to the master bedroom;
  - to fit, separate kitchen and dining combine first, then the living room joins them (relax levels 1 and 2).
- **Presets.** `BRIEF_PRESETS`: starter, family of 3 and 4 bedrooms, bungalow, work from home, annexe. Every preset is tested to generate valid layouts.
- **Floor finishes.** Generated rooms now get a default floor: tiles in wet rooms and the utility, concrete in the garage, timber elsewhere.

### The step in the editor

- **Steps.** The workspaces are labelled as numbered steps, Structure / Rooms / Design / 3D. The workspace id stays `"brief"`.
  - A **Next** button in the top bar moves on: Structure → Rooms; Rooms → generate layouts; Design → 3D.
- **Starting from rooms.** The new-project page now asks only for an optional plot size. The project is created with a typical family home picked and no layouts (`count: 0`), and the editor opens on the Rooms step (`start=rooms`).
- **Left panel** (`designer/BriefPanel.tsx`):
  - room cards with a picture, tick and counter, grouped into bedrooms, bathrooms, living spaces and other rooms;
  - **Presets** and **Inspiration** tabs that fill in a whole house;
  - **More options** for room sizes, accessibility, preferences and notes;
  - **Generate layouts** at the bottom.
- **Live preview.** The first layout is planned on every change (`planLayouts` with a count of 1, a few milliseconds) and shown in:
  - `LevelView`, a props-driven wrapper around `HouseViewer`, cut away so the rooms are visible, with room names and areas as labels;
  - the 2D plan, or both side by side;
  - with Show dimensions, a floor selector (one floor for now), Orbit / Walk / Interior / Exterior cameras and the lighting.
- **Render photo.** Renders an aerial "dollhouse" view (a new `aerial` view kind) and sends it to the existing Gemini route.
  - This is one paid call. The photo is kept for the session only, because the picks change often.
  - The aerial camera (`aerialCameraPose`) frames the whole house with the roof off.
- **Card pictures.** Fourteen isometric room pictures were generated once with Gemini and are served from `public/rooms/` (about 18 KB each). Nothing is generated at runtime for them.

## Consequences

- The Rooms step is a brief editor with a preview, so whatever is picked there is exactly what the planner builds.
- The preview shows only the first layout. The concepts in Design are the real comparison.
- A floor texture bug was found: plank rows left transparent gaps that showed as black rectangles in the 3D view and in photos. It was fixed while building this step.
- Still open: more than one floor, and pictures for presets beyond the current set.
