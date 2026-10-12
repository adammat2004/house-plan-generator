# Design system

Simple, calm and warm: a home designer for people in Ireland and the UK, not a CAD tool. Every screen has one obvious next step, and the house plan is the biggest thing on it.

Tokens live in `src/app/tokens.css`. Canvas and 3D colours mirror them in `src/design/tokens.ts`; `tests/design/tokens.test.ts` fails if the two disagree. Use tokens, never raw values: `tests/design/css-tokens.test.ts` fails on a hex or `rgb()` colour, a px font size, a px radius or a raw shadow anywhere outside `tokens.css`. To fade a token, use `color-mix(in srgb, var(--ink) 10%, transparent)`.

## Type

Two faces, loaded with `next/font` in `src/app/layout.tsx`: **Newsreader** for page and panel titles, **Inter** for everything else. Weights 400, 500 and 600 only. Numbers that measure anything (areas, lengths, counts in a row) use `font-variant-numeric: tabular-nums`.

| Token | Size | Face | Use |
|---|---|---|---|
| `--fs-display-xl` | 56px / 1.02 | Newsreader 400 | Home hero only |
| `--fs-display-l` | 40px / 1.08 | Newsreader 400 | Page titles (Projects, Templates, Help, Settings) |
| `--fs-display-m` | 32px / 1.1 | Newsreader 400 | Step titles (Choose your rooms, Your layouts) |
| `--fs-display-s` | 24px / 1.15 | Newsreader 400 | Panel titles (the selected layout or room) |
| `--fs-title` | 16px / 1.35 | Inter 600 | Card titles, section headings |
| `--fs-body` | 14px / 1.5 | Inter 400 | Default text and controls |
| `--fs-small` | 13px / 1.45 | Inter 400/500 | Secondary text, small buttons, group labels (600, sentence case) |
| `--fs-caption` | 12px / 1.4 | Inter 500 | Meta, chips, field labels |

Group labels are sentence case. The only tracked capitals are plan annotations (GARDEN, STREET, and UP and DOWN on stairs).

## Colour

| Token | Value | Use |
|---|---|---|
| `--bg` | `#f8f7f3` | Page and top-bar background |
| `--canvas` | `#f2f0ea` | Behind the plan and boards |
| `--surface` / `--surface-2` / `--surface-3` | `#fff` / `#f4f3ef` / `#ecebe5` | Panels and cards / hover and tracks / pressed |
| `--line` / `--line-strong` | `#e6e3db` / `#d4d0c6` | Dividers / control borders |
| `--ink` / `--ink-2` / `--ink-3` | `#1e2420` / `#525852` / `#646962` | Text; `--ink-3` passes 4.5:1 on every background, the canvas and pressed surfaces included |
| `--ink-disabled` | `#a4a8a1` | Disabled text only |
| `--brand` / `--brand-hover` / `--brand-soft` | `#1f3a32` / `#2a4a40` / `#edf2ef` | Primary buttons, the current step |
| `--on-brand` | `#fff` | Text on brand |
| `--accent` / `--accent-ink` / `--accent-soft` / `--accent-line` | `#2f6f5e` / `#245848` / `#e5efeb` / `#c5dcd4` | Links, focus, selection, success, Recommended |
| `--danger` / `--danger-ink` / `--danger-soft` / `--danger-line` | `#b8432f` / `#86301f` / `#f6e3df` / `#e9c4bb` | Destructive actions and errors |
| `--warning` / `--warning-ink` / `--warning-soft` / `--warning-line` | `#9a5a10` / `#6b4a12` / `#fbf5ea` / `#eedcbc` | Things to check, notes that need attention |
| `--media` | `#e7e0d2` | Behind photos and 3D stills while they load |
| `--sky` | `#e9eef1` | The 3D daylight sky, and the 3D pane before it draws |
| `--glass` | 92% white | Labels and controls over pictures |
| `--grid-line` | 5% ink | The drafting grid on plan paper |
| `--scrim` / `--scrim-strong` | 24% / 82% ink | Behind dialogs / behind the photo lightbox |
| Room families | day `#f3e7cf`, night `#dfe7ef`, wet `#d9ebe6`, service `#ece8e0`, hall `#f1eee8` | Plan fills; each room type takes its family's tint |

## Space, shape, depth

- **Space:** `--space-1` … `--space-10` = 4, 8, 12, 16, 20, 24, 32, 40, 48, 64px. Panels pad 20-24, cards 16-18, list rows 10 vertically.
- **Radii:** `--r-xs` 3 (thin bars, skeleton lines), `--r-sm` 6 (chips, small inputs), `--r-md` 10 (buttons, inputs, rows), `--r-lg` 14 (cards, floating panels), `--r-xl` 20 (hero media, dialogs), `--r-pill`.
- **Shadows:** `--shadow-1` resting cards, `--shadow-2` panels floating over the canvas, `--shadow-3` menus, popovers and dialogs. Always an offset plus a soft blur; never a coloured glow. A selected card may add a ring (`box-shadow: 0 0 0 1px var(--brand)`), which is a border, not depth.
- **Gutter:** `--gutter` (24px) between the canvas edge and floating panels.
- **Layers:** `--z-chrome` 10 (floating canvas panels, which sit under the top bar's menus), `--z-panel` 20, `--z-popover` 30, `--z-toast` 40, `--z-modal` 50, `--z-tooltip` 60.

## Motion

`--dur-fast` 120ms for hover and press, `--dur-base` 200ms for panels and fades, `--dur-slow` 320ms for the layouts reveal, all with `--ease-out`. Under `prefers-reduced-motion` every duration is zero and loops stop. The layouts reveal is the product's one authored motion moment; nothing else animates for show.

The one exception is the plan's view, and it isn't for show: Fit, F, Shift+F and the zoom buttons glide there over 200ms, so you can see where you've gone. Scrolling, pinching and dragging move it directly, and fits the editor makes for itself are instant.

## On the plan

- **Scroll pans, Ctrl or ⌘ + scroll zooms** (a trackpad pinch too), about the pointer, as in Figma and Miro.
- **The pointer says what it can do:** a resize arrow on walls that drag, a hand on furniture, doors, windows and stairs, a pointer on rooms.
- **What's picked shows its handles:** grips on a room's sides (one wall each), squares on a piece's corners, ends on an inside wall, corners on the outline. Its sizes show on accent pills, and they change as you drag. A dashed accent line shows what a dragged wall lines up with.
- **A small toolbar floats over what's picked** with the next things people do to it; the inspector has the rest.

## Focus and browser surfaces

One focus ring everywhere, fields included: `outline: 2px solid var(--accent); outline-offset: 2px`. Selection uses `--accent-soft`; caret, checkboxes, radios and ranges use `--accent`; scrollbars use `--line-strong`.

## Components (`src/components/ui`)

Home and editor share them. Keep every `data-testid` when replacing markup.

- **Button:** primary, secondary, ghost, danger; sizes sm 32, md 40, lg 48. **One primary per screen region.**
- **IconButton:** 32px, 44px on touch screens (`pointer: coarse`).
- **SegmentedControl** for 2-4 views of the same thing; **Tabs** (underline) for panel sections.
- **CountStepper**, **Select**, **TextField** (always a visible label; a placeholder is never the label), **Toggle**, **Chip**.

## Steps and views

- **Five steps** in the top bar, keys 1 to 5: **Map** (the plot, and which side the garden is), **Requirements** (the rooms), **Explore** (the layouts side by side), **Refine** (one plan, every part of it editable) and **Review** (the chosen design summed up, with its downloads). The current step is a white pill; below 1360px wide only the current step keeps its name, and under 1024px the steps fold into "Step n of 5".
- **Views are not steps.** Beside Export, in Refine and Review only, a pill switch shows the plan three ways: **2D Plan** (the plan without furniture, for the layout), **3D View** (the house in 3D over the plan, or beside it with Side by side), and **Furnished** (the plan with its furniture, which can be picked and moved). Shift+1, 2 and 3 switch them. Every tool works in both 2D views; a tool picked in 3D brings the plan back, and the Furniture tool shows the furnished view.
- **Outside Refine the plan is for looking at:** dragging pans it, and in Review a click picks a room.
- **Map** sets the plot: its width along the street and depth back from it (both optional), what to leave free at the front, each side and the back (6, 1 and 11 m to start), and north, on a dial in 15° steps. The plan shows the whole plot with the room left for the house dashed; layouts are sized to fit that room, and a house that doesn't fit is told so in plain words. Once north is set, a compass sits by the house's south-east corner (and in plan images), the panel says which way the garden faces, and the 3D sun keeps to the real compass. The plan itself never turns.
- **Downloads.** Review's main download is the presentation image: the plan in its garden, cropped to the plot, with the project's name, the plan's size and rooms, the date and a scale bar along the bottom. The plain plan image is the plan as framed, without the garden. Both show the floor on show, its labels, and the compass once north is set. Review also lists each room's floor finish and the interior style.
- **Comparing plans.** The plan menu (top left in Refine) lists the layouts, then your own house, each with the copies made from it underneath. "Compare with another plan" puts two plans side by side at one scale. Zooming either drawing zooms both, rooms that differ are outlined (unless they're different layouts altogether), and the numbers that tell them apart have a tick on the better side. Either side can be swapped for another plan, and "Work on this plan" opens it. Escape goes back.

## Plan drawing

The plan is drawn like a home, not a drawing sheet, and stays exact: everything is drawn from the plan's own geometry in code, never from pictures.

- **Floors show their finish**: herringbone wood, wood boards, tiles, stone, carpet, concrete or vinyl. A room with no finish set shows the one its use usually has (tiles in a bathroom, wood elsewhere); a room with no use is a plain tint. The same finishes are painted on the 3D floors and in the layout pictures (`rendering/scene/finishes.ts`).
- **Walls** are near-black with a soft shadow at their feet. Doors and windows are real gaps: the floor runs through a doorway, a door is a thin leaf with a quiet swing, wide outside doors slide, and a window is a white frame with its glass and an outside sill.
- **Room names** sit on a soft white pill with the area underneath, and keep off the stairs. A picked room's pill gets an accent edge.
- **Furniture** is drawn in what it's made of (wood, fabric, linen, white, metal), coloured by the house's interior style, with a small shadow to the south-east and no blur. Coffee tables and beds stand on rugs, which stop at the walls. The style sets woods, fabrics, bedding and rugs only (`rendering/scene/style.ts`); the plan uses light versions so floors and labels still read.
- **The garden** is worked out from the house (`rendering/scene/garden.ts`): mown lawn to the plot's edge, gravel at the foot of the walls, a terrace across the garden doors, a path from the front door to the street, hedges on the boundary, and trees kept clear of the walls and the dimension lines. Without a plot of its own, the plot reaches 9 m past the garden side, 5 m past the street side and 4.5 m past each end. The same garden is drawn on the plan, in 3D and in the layout pictures, and plain plan images leave it out.

## Floors

- **Floor switcher.** A SegmentedControl of floor names (Ground, First, Second) in the canvas dock, beside a "+" to add a floor above, disabled at three with the reason in its tooltip. A house of one floor shows only "+ Floor". PageUp and PageDown move between floors, and switching works on phones; adding a floor doesn't.
- **On the plan.** The floor below shows faded under the floor on show, and the outline of the floor above shows dashed. Both are left out of exports.
- **Stairs** are drawn as on an architect's plan.
  - On the floor they leave from, the treads below the cut (about 1.2 m up) are solid, a break line crosses the flight, the rest is dashed, and UP sits just past the foot.
  - On the floor they arrive at, the whole flight shows, with DOWN just past the top.
  - Room names keep off the flight and the floor at each end.
- **Cards and previews** show every floor side by side, ground first, each named under its drawing, with the stairs drawn.

## Copy

Say what happened and what to do, in plain words. Never show vendor names, API keys, environment variables, "paid call" or raw error text to users; setup hints appear only in development. No "coming soon" controls: a control that does nothing doesn't ship. UK spelling, metric units; UK visitors also see square feet beside areas.
