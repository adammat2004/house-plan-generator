# ADR 0002 — Rooms, house brief, layout variants and design intent

- Status: accepted. Implemented 2026-10-07, apart from room-level planning, which is recorded as intent only.
- Date: 2026-10-07
- Builds on: [ADR 0001](0001-plan-document-and-geometry.md)

## Context

The editor is becoming an AI-assisted design workspace. The intended flow is:

1. Describe the house.
2. Generate several valid layouts.
3. Compare them and pick one.
4. Edit it.
5. Regenerate individual rooms.

This needs four things the M1 model doesn't have:

- rooms with a purpose and targets;
- a structured brief;
- several alternative plans with lineage;
- a safe route from natural language to geometry.

ADR 0001's guarantees stay in force:

- the `PlanDocument` is authoritative;
- derived data is never stored;
- every change goes through `applyCommand`.

## Decisions

### Implementation notes

- **Rooms:**
  - Schema v2 lives in `src/domain/plan/schema.ts`, with the v1→v2 step in `migrations.ts`.
  - Naming helpers live in `src/domain/plan/rooms.ts`.
  - `updateRoom` takes `changes`, and `null` clears an optional field.
- **Brief:** `src/domain/brief/schema.ts`.
- **Project:**
  - `src/domain/project/schema.ts` defines the project document. A bare `PlanDocument` (file or autosave) is wrapped as a project with one plan, labelled "My plan".
  - The editor's `project` store (`src/editor/state/stores.ts`) keeps per-plan histories.
- **Planning:**
  - The intents and goal vocabulary are in `src/domain/design/intent.ts`.
  - The planner interface is in `planner.ts`.
  - The first planner is `stripPlanner.ts` (id `strip-planner-v1`), working from the space program in `program.ts`.
  - `src/editor/state/design.ts` is the only bridge between the UI and planners.
- **Room-level intents:** `redesign_room` is accepted and validated, but the strip planner answers `unsupported-intent`. The UI reports this rather than faking a result.
- **Free text:** `additionalInstructions` is stored, but no planner reads it yet. Generated plans say so in their notes.

### Rooms (PlanDocument schema v2)

- `Room.usage` (8 values) becomes `Room.type`. The values are: `living`, `kitchen`, `kitchen_dining`, `dining`, `bedroom`, `primary_bedroom`, `bathroom`, `ensuite`, `wc`, `utility`, `hall`, `office`, `storage`, `garage`, `other` and `unspecified`.
- Optional program fields are added: `targetArea`, `minArea`, `maxArea`, `floorMaterial`, and `externalWall` (`required`, `preferred` or `avoid`).
- The polygon and area remain **derived** from walls.
- **Connections** are split:
  - Actual connections will be derived from doors by a `deriveRoomGraph(level)` helper. It is not built yet, because no planner needs it so far.
  - Desired connections are constraints and belong to the brief.
- A v1→v2 step in `migrateToCurrent` maps the old usages one-to-one. Files and autosaves from v1 keep loading.

### House brief

`HouseBrief` is a zod schema in `src/domain/brief`:

```ts
{
  bedrooms: number;
  bathrooms: number;
  requiredSpaces: BriefSpace[];    // kitchen, living, dining, office, utility, garage
  preferences: PreferenceId[];
  additionalInstructions: string;
}
```

- `PreferenceId` is a closed vocabulary: `open_plan`, `kitchen_faces_garden`, `maximize_natural_light`, `primary_bedroom_private`, `separate_living_room`, `home_office`, `large_kitchen`, `utility_near_kitchen` and `accessible_layout`.
- Free text only adds to the structured fields; it never replaces them.

### Project and variants

A `ProjectDocument` wraps plans. It does not live inside `PlanDocument`, because every variant shares one brief.

```ts
ProjectDocument {
  schemaVersion, id, name,
  brief: HouseBrief,
  activePlanId: Id,
  plans: PlanVariant[]
}

PlanVariant {
  id, label,                       // "Plan A"
  document: PlanDocument,          // full, independently valid geometry
  parentId: Id | null,             // source plan
  origin: { kind: "user" } | { kind: "generated"; requestId; planner; seed },
  scope: { kind: "plan" } | { kind: "rooms"; roomIds: Id[] },  // changed region
  createdAt
}
```

- Generating layouts **adds** variants. It never overwrites the user's plan.
- Room-level variations use the same record with `scope.kind = "rooms"` and a `parentId`.
- Generated plans record `origin.summary` and `origin.notes`: the idea behind the layout and any compromises made to fit the brief.
- Canvas placement for side-by-side variants can be added to `PlanVariant` later without changing anything else.
- Undo/redo stays **per plan**. The document store keeps one `History` per variant and swaps the active one when the user switches plans.
- Persistence stores the project in the same IndexedDB slots that used to hold a plan, with the same recovery rotation. A legacy single `PlanDocument`, whether an autosave or a file, is wrapped as a project with one user plan.

### Design intent and planning

The pipeline is:

> user request → (LLM) structured `DesignIntent` → deterministic `LayoutPlanner` → `PlanDocument` candidates → renderer

- `DesignIntent` is a zod union. It includes `generate_layouts { brief, count }`, `redesign_room { roomId, goals }` and `room_variations { roomIds, goals, count }`.
- `LayoutPlanner.plan(request)` returns candidates that have been built with `applyCommand` and checked with `validateDocument`. Every candidate is therefore valid and editable.
- The first planner is a deterministic demo planner. It partitions the envelope into zones from the brief.
- An LLM may only produce `DesignIntent`. It never produces coordinates, and UI components never compute geometry for AI actions.

### 3D readiness

Walls already carry thickness and height. Openings carry height and sill. Levels carry elevation and a default wall height. Footprints and clear polygons are derived.

Together these support wall extrusion, floor slabs and openings. Ceiling height, slab thickness, roof and room materials are added as level and room fields when 3D work starts.

## Consequences

- Schema v2 and the project wrapper are breaking format changes. The migrations above keep old files and autosaves loading.
- Autosave payloads grow with the number of variants. Records are shared and immutable, so memory stays modest.
- Planner output is always reproducible from `(brief, source plan, seed)`, which keeps AI features debuggable.
