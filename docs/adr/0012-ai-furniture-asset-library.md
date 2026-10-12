# ADR 0012 — AI-made furniture asset library

- Status: proposed. The pipeline is built; the 3D service, where the files live, and the runtime are still open.
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

## Still to decide

- **Which service:** see the spike results above.
- **Where the files live.** About 125 assets come to roughly 40–70 MB. They could go in plain git, in Git LFS, or in external storage.
- **The runtime:**
  - 3D: an `AssetLibrary` with clone-per-item, box fallbacks, and a clipping-plane cutaway; `clearGroup` must not free shared models; GLB export must use world transforms.
  - 2D: Konva sprites in the Furnished view with `scaleY = -1` under the flipped stage, plus exports that wait for the pictures to load.
- **Decor kinds:** a side table and a floor lamp would need schema v7. Rugs stay derived from the furniture they sit under.

## Consequences

- Making assets costs money and is done by hand in the terminal. Tests and the app never call Gemini or fal.ai for assets.
- `STYLE_WORDS` is now exported from `renderRequest.ts`, so the photos and the asset prompts describe a style in the same words.
