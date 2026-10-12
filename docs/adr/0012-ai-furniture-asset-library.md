# ADR 0012 — AI-made furniture asset library

- Status: accepted. The pipeline, Tripo as the service, and the 3D and plan runtime are built. All 21 modelled warm_minimal pieces are published (5.8 MB); the other five styles are still to make.
- Date: 2026-10-12
- Builds on: [ADR 0003](0003-furniture.md), [ADR 0005](0005-rooms-first-and-photo-renders.md)

## Context

The user wants rooms that look real, like Drafted's furnished plans: realistic furniture seen from above on the plan, and real models in 3D. They were clear that they don't mean the Gemini photos (ADR 0005), which stay as they are.

Today all furniture is drawn in code:
- **2D:** vector symbols, in `scene/furnitureSymbols.ts`.
- **3D:** stacks of boxes, in `three/furnitureModel.ts`.

The editor redesign of 2026-10-11 had decided "procedural rendering, no image assets". The user reversed that on 2026-10-12, and this ADR records it.

The user's choices:
- The library is used in **both** the 2D Furnished view and the 3D view.
- 3D models come from **AI image-to-3D**: Gemini makes a reference picture, then an image-to-3D service turns it into a GLB.
- Assets are made **once, by a script**, and reviewed before they're committed. Nothing is generated while the app runs, so people using it pay nothing and don't wait.
- There is **one asset per kind per interior style**, chosen from `appearance.interiorStyle`.

## Decisions so far

- **Pipeline.** `npm run assets:build` (`scripts/assets/`) runs four stages:
  1. a reference picture from Gemini (`prompts.ts`, `gemini.ts`);
  2. a 3D model through fal.ai (`vendors.ts`);
  3. normalising (`normalise.ts`);
  4. the plan picture, drawn from the normalised model in headless Chromium (`bake.ts`, `bake/harness.js`). Because it's drawn from the model, 2D and 3D always match.

  Each stage is cached in `.assets-cache/` by a hash of what went into it, so a run that stops picks up again without paying twice. Each run writes a contact sheet to `test-results/assets/index.html`. Options come from `ASSETS_*` environment variables: `ASSETS_SMOKE=1` runs the later stages on box furniture with no keys, and `ASSETS_VENDOR=none` makes reference pictures only.
- **Model convention.** Front at +Z, back at −Z (the plan's +y at rotation 0), centred, standing on Y = 0, and sized to the catalog's width, depth and height. Pieces whose back is taller than their front (sofas, beds, toilets) are turned automatically. For pieces without a back, the service's own facing is kept and the result is marked "guessed". An override in `scripts/assets/review.json` wins over both. Stretching any axis more than about 20% beyond an even scale flags the model to be made again.
- **Compression.** Meshopt geometry and WebP textures (1024 px, 512 px for small pieces). Triangle budgets are 25k, 12k or 6k by footprint. Three ships the meshopt decoder, so there's no wasm to host.
- **Plan pictures.** Drawn straight down at 256 px/m with a 0.15 m margin and the back at the top. The light comes from the north-west, with a soft shadow to the south-east to match the drawn furniture's `FURNITURE_SHADOW`.
- **What stays in code.** Built-in pieces that come in any length (kitchen units, worktops, islands, shelving, showers, wardrobes) stay procedural, with better materials to come. Stretching a model along its length would distort it.
- **Services.** All are reached through fal.ai with one key:
  - TRELLIS and TRELLIS.2 (MIT licence);
  - Tripo v2.5 (commercial use on paid plans).

  **Hunyuan3D is excluded** because its licence excludes the EU and UK. Stable Fast 3D is excluded too.

## Spike results (2026-10-12)

The spike compared five services on warm_minimal × sofa, armchair, double bed, coffee table and chest of drawers: 24 paid calls, about $7. Every service gave usable shapes. All the sizes came within 10% of the catalog once beds kept their own height.

| Service | Seen in the spike |
|---|---|
| TRELLIS ($0.02) | Very good for the price. Colours drift darker than the reference (the oak chest came out walnut). |
| TRELLIS.2 | Greyer colours. The bed's throw came out torn. The bed is heavy (42k triangles, 1.3 MB). |
| Tripo v2.5 | The cleanest and most consistent across all five. Wood comes out a little orange. Fast (~90–150 s). Its models face a quarter turn off ours, handled by `facing: 3`. |
| Meshy 7.1 | Good sofa and table. Blotchy marks on the armchair. The fal queue took 13–15 minutes. |
| Rodin | Good shapes, but the colours wash out pale against the reference even when matte. The most expensive. |

**Normaliser changes from the spike:**
- **Beds keep their natural height,** because the catalog's 0.5 m is the mattress, not the headboard.
- **Each service has a `facing`,** used when a piece has no tall back to go by.
- **Every model is made matte:** the roughness map is dropped, metalness is set to 0 and roughness to 0.8. The services' glossy maps washed colours out under the studio light.
- **The simplifier may lose more detail** (error 0.01) to stay near the triangle budgets.
- **Tripo's base colours are corrected** (`colour`: saturation 0.8, brightness 1.04), because its oak came out orange against the reference pictures.
- **Dining sets are turned** in `review.json` so the table runs across, with the chairs front and back as the planner lays them out. The four-seat set's prompt asks for exactly four chairs, none at the ends: the first one had five.

**Decided 2026-10-12:** Tripo for everything, and the files are committed to git (about 1.4 MB for the first five pieces; about 8 MB per style).

## Runtime

- **Publishing.** `npm run assets:publish` copies each style/kind's chosen model and plan picture to `public/assets/furniture/{style}/{kind}.{hash8}.glb|.webp` and writes `src/editor/rendering/assets/furnitureAssets.json`. Files nothing points at are removed. `scripts/assets/review.json` can name another service for a piece, or reject it so it stays drawn in code.
- **Lookups** live in `rendering/assets/manifest.ts`:
  - `assetFor` tries the style, then "any", then warm_minimal.
  - `assetForItem` gives up when an item is resized beyond 0.7–1.4× the catalog on any axis.
  - Models are scaled from the catalog size, so a bed keeps its headboard however the item's height is set.
- **3D** (`three/furnitureAssets.ts`):
  - Each model loads once with `GLTFLoader` and the meshopt decoder, and every scene uses copies of it.
  - The template's meshes and materials are marked `sharedAsset`, and `clearGroup` doesn't free them.
  - `HouseModel.furniture` lists each piece with its floor height and cutaway cap.
  - `buildHouse` places a model where one has loaded and skips that piece's boxes.
  - In the cutaway, a model's materials are copied with a clipping plane (`localClippingEnabled`).
  - The viewer builds with boxes first, then again once the models arrive.
  - Stills (`prepareStillModels`, `useStill`) wait for the models, and the library's generation is part of the stills' scene cache key.
  - The GLB export uses world transforms.
- **Plan** (`konva/sprites.ts`):
  - Furniture is drawn as a Konva image wherever it's shown (Furnished, and the Explore board), flipped with `scaleY: -1` and turned like the item. Pieces without a picture keep their symbol.
  - Concept thumbnails (`PlanThumbnail`) draw the same pictures as SVG `<image>`s.
  - Plan and presentation exports wait for the pictures; 3D exports wait for the models.
- **Test hooks:** `__floorPlanEditor.planSprites()` and `furniture3d()`. The furniture e2e checks both.

## Still to decide

- **The Asset Lab:** a dev page to approve or reject pieces and fix orientation, instead of editing `review.json` by hand.
- **The other five styles,** and the decor kinds below.
- **Decor kinds:** a side table and a floor lamp would need schema v7. Rugs stay derived from the furniture they sit under.

## Consequences

- Making assets costs money and is done by hand in the terminal. Tests and the app never call Gemini or fal.ai for assets.
- `STYLE_WORDS` is now exported from `renderRequest.ts`, so the photos and the asset prompts describe a style in the same words.
