# ADR 0005 — Start from rooms; photo renders of rooms

- Status: accepted. Implemented 2026-10-08.
- Date: 2026-10-08
- Builds on: [ADR 0002](0002-project-variants-and-design-intent.md), [ADR 0003](0003-furniture.md), [ADR 0004](0004-claude-request-reader.md)

## Context

The user wanted a drafted.ai-style start: choose the rooms (4 bedrooms, a kitchen, 2 bathrooms…), get several layouts to compare, and see the rooms as realistic pictures.

Until now, layouts only filled a house rectangle the user had drawn or typed, and 3D stills could only come from the viewer on screen.

## Decisions

### The planner chooses the house size

- **Footprints.** `design/footprint.ts` (pure) proposes up to three outside sizes per arrangement: compact, wide and deep. They come from the program's target areas plus walls and the hall. They respect each band's minimum widths, band depths of 3–5.6 m, an aspect ratio of 2.2 or less, and an optional plot limit, and they snap up to 0.5 m.
  - `minimumFootprint` gives the "these rooms need at least W × D" message.
- **Shared zoning.** `design/zoning.ts` holds the arrangements and the day/night zoning, so the chooser and the planner size bands the same way.
- **Auto mode.** `generate_layouts` gains `footprint: "auto"` and `plot`. In auto mode the strip planner builds each arrangement on a fresh shell of a chosen size, the same pattern as the templates. Without `footprint`, behaviour is unchanged.
  - Arrangements with the same split take the next size in turn, so the first concepts differ in both plan and size.
  - Candidates carry `variant = arrangement@WxD`, which "Generate more" excludes and "Generate similar" builds from.
  - At most 40 shells are built per request; a typical request takes about 40 ms.
- **Projects started from rooms.** `project/fromRooms.ts` creates the project:
  - an empty "Shell" root plan at a typical size, which keeps the shells and lineage invariants;
  - generated concepts under it;
  - `ProjectDocument.sizing = { footprint: "auto", plot? }`, which is optional, so the format stays version 1.
- **Keeps working in the editor.** The editor's design actions pass the sizing into every generate request, so the brief panel, Generate more, Similar and Regenerate keep sizing houses from the rooms. The brief and the board say so, with a link to switch to a fixed house size.

### "Pick your rooms"

- A new first start method on the new-project page and the home dashboard.
- It reuses the brief's room fields, now shared as `BriefRoomFields`.
- It adds an optional plot size and the number of layouts (3, 4 or 6), and shows a live first layout.
- It creates the project and opens the editor on the concept board (`/editor?project=…&start=concepts`).

### 3D stills of any plan

- **Shared scene code.** Mesh, material and light building moved out of `HouseViewer` into `rendering/three/sceneBuilder.ts`. The viewer and the new off-screen renderer share it.
- **Off-screen renderer.** `rendering/three/stills.ts` renders a room or the exterior of any `Level` to JPEG:
  - one shared WebGL renderer, because browsers cap WebGL contexts;
  - a small cache of built scenes;
  - interiors lit evenly, with a ceiling;
  - `null` where WebGL is unavailable.
- **Room camera.** `rendering/scene/roomCamera.ts` (pure, tested) frames each room on its "feature wall": the bed head, the sofa or the kitchen units.
  - The eye stands in the room, clear of furniture, at 1.45 m, with the lens fitted to the wall.
  - The interactive viewer's interior camera uses it too.
- **Previews.** `useStill` renders previews one at a time and only for visible cards. They are shown on concept cards, in the concept detail's exterior picture, and in the room gallery.

### Photo renders with Google Gemini

- **Structured requests only.** `design/renderRequest.ts` (pure) defines the request: structured facts about the view (room type, area, furniture kinds, windows, garden doors, floor finish, or the exterior finishes), an interior style, and the 3D still as a base64 JPEG.
  - No free text is accepted. The server writes the prompt (`renderPrompt`), so the route can't be used as a general image generator.
  - The prompt asks the model to keep the camera, walls, openings and every piece of furniture in place.
- **Which views.** `photoTargets` chooses the exterior, then living spaces, bedrooms and bathrooms. Halls, storage and anything under 3 m² are skipped, with at most 10 views per concept.
- **Out-of-date check.** `renderKey` hashes only what an image shows, so editing one room marks only that room's photo out of date.
- **Server.** `server/imageRenderer.ts` uses `@google/genai`'s `models.generateContent` with an image part and `responseModalities: [IMAGE]`.
  - The model is `GEMINI_IMAGE_MODEL`, default `gemini-3.1-flash-image`. That is the non-preview image model available to the key on 2026-10-08.
  - Blocks map to 422, bad keys to 503 and quota to 429. Since 2026-10-09 the call has a 50 s timeout (504), and network errors map to 502.
- **Route.** `app/api/design/render/route.ts`:
  - GET reports whether it's set up.
  - POST rejects bodies over 2 MB, checks the request schema and the JPEG magic bytes, and allows 20 photos per visitor per 10 minutes, plus an optional `GEMINI_DAILY_LIMIT`. Only photos that come back count towards the daily limit (since 2026-10-09).
  - The rate limiter is shared with the Claude route (`server/rateLimit.ts`).
- **Storage.** Photos live in a new IndexedDB store (database version 3, `renders`, indexed by project), not in the autosaved project JSON. Autosave copies every revision, so images there would be rewritten constantly.
  - Deleting a project deletes its photos, and duplicating copies them.
  - Returned images are re-encoded to JPEG of at most 1280 px.
- **Editor state.** `editor/state/renders.ts` is a store separate from the project's revision, so autosave ignores it.
  - It loads and prunes a project's photos.
  - It renders missing or out-of-date views two at a time, with progress and Cancel.
  - It stops at the first setup problem.
- **UI.**
  - The concept detail's Rooms tab is a gallery: a photo or a "3D preview" per view, an "Out of date" badge, an interior-style picker, **Render rooms**, and a lightbox with download.
  - Concept cards show three room pictures.
  - Without a key the button is disabled with set-up instructions.

## Consequences

- **Cost.** Each photo is a paid Gemini call. A concept is up to 10 photos, each taking about 10 s. Nothing is rendered without a click.
- **Fidelity.** Gemini keeps layouts well in practice (tested on a bedroom and a living room), but it adds decor and sometimes windows. The 3D preview stays available beside each photo.
- **Tests.**
  - Browser tests blank both API keys, so they never make paid calls.
  - The photo flow is tested in the browser against a mocked route.
  - The renders store and the route are unit-tested with stand-ins.
- **Footprint shapes.** The planner is still a two-band strip planner, so auto footprints are rectangles. L-shapes and two storeys would need a new planner.
