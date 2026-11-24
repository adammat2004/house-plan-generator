"use client";

import dynamic from "next/dynamic";
import { useDeferredValue, useMemo, useState } from "react";
import { BRIEF_PRESETS, picksFromCounts, ROOM_PICK_GROUP_LABEL, ROOM_PICK_GROUPS, ROOM_PICK_SPECS, pickedBathrooms, pickedBedrooms, type RoomPick, type RoomPickGroup, type RoomPicks } from "@/domain/brief/rooms";
import { BRIEF_LIMITS, PREFERENCE_IDS, PREFERENCE_LABEL, withPicks, type HouseBrief } from "@/domain/brief/schema";
import { createPlanDocument } from "@/domain/commands";
import { placementRoom } from "@/domain/design/placement";
import { DEFAULT_INTERIOR_STYLE } from "@/domain/design/renderRequest";
import { generationPlot } from "@/domain/project/site";
import { planLayouts } from "@/domain/design/stripPlanner";
import { analyzeEnvelope } from "@/domain/geometry/envelope";
import type { Level, PlanDocument } from "@/domain/plan/types";
import { DEFAULT_APPEARANCE } from "@/domain/project/schema";
import { PROJECT_TEMPLATES } from "@/domain/project/templates";
import { CountStepper, Menu, SegmentedControl, Tabs } from "@/components/ui/controls";
import { CheckIcon, ChevronDownIcon, CubeIcon, MinusIcon, PinIcon, PlusIcon, SparkleIcon } from "@/components/ui/icons";
import { design, editor, renders, useDocumentState, useProjectState, useRenders, useSessionState } from "../../state/editor";
import { goToStep, selectWorkspace } from "../shell/tools";
import { BriefSection, BriefSizeFields, toggle } from "./BriefFields";
import { CreateBar, DesignHistoryButton, MixBar, RoomTiles, StudioControls, useBriefHistory } from "./Studio";
import { DesignHistory } from "./DesignHistory";
import { PictureReader } from "./PictureReader";
import { PlanThumbnail } from "./PlanThumbnail";
import { PICK_ROOM_TYPE, RoomTile } from "./RoomTile";
import { PICK_DRAG_TYPE, PlaceGrid, PlacementMarkers, placementDropHandlers } from "./Placements";

const LevelView = dynamic(() => import("../../rendering/three/LevelView"), { ssr: false, loading: () => <div className="three-host three-loading">Loading 3D…</div> });

/** Accessibility has its own section; the rest are design preferences. */
const DESIGN_PREFERENCES = PREFERENCE_IDS.filter((p) => p !== "accessible_layout");

type Tab = "rooms" | "presets";
type PreviewMode = "2d" | "3d";

/**
 * Step 2, Requirements ("Choose your rooms"): what the house needs, picked
 * room by room, beside a live preview of a layout for those rooms.
 * "Generate layouts" opens Explore and fills it. The user's own plan is
 * never changed.
 */
export function BriefPanel() {
  const workspace = useSessionState((s) => s.workspace);
  if (workspace !== "brief") return null;
  return <RoomsStep />;
}

/** One preview plan for the step, shared by the facts and the canvas. */
function RoomsStep() {
  const preview = usePreviewLevel();
  // The pick under the pointer or focus: its rooms are outlined on the preview.
  const [hovered, setHovered] = useState<RoomPick | null>(null);
  const brief = useProjectState((s) => s.brief);
  const history = useBriefHistory();
  const highlight = useMemo(() => (hovered && preview.plan ? roomsOfPick(preview.plan, hovered, picksOf(brief)) : undefined), [hovered, preview.plan, brief]);
  return (
    <div className="rooms-step studio" data-testid="brief-panel">
      <RoomsPreview preview={preview} highlight={highlight} history={history} />
      <RoomsPanel onHover={setHovered} />
      <CreateBar plan={preview.plan} picks={picksOf(brief)} />
    </div>
  );
}

/** The rooms a pick became in a plan, every one of them. */
function roomsOfPick(plan: PlanDocument, pick: RoomPick, picks: RoomPicks): string[] {
  const ids: string[] = [];
  for (let n = 1; n <= (picks[pick] ?? 0); n++) {
    const found = placementRoom(`${pick}#${n}`, plan, picks).roomId;
    if (found && !ids.includes(found)) ids.push(found);
  }
  return ids;
}

type Preview = ReturnType<typeof usePreviewLevel>;

/** The picks shown for a brief: its own, or ones matching an older brief's counts. */
export function picksOf(brief: HouseBrief): RoomPicks {
  return brief.rooms ?? picksFromCounts(brief.bedrooms, brief.bathrooms, brief.requiredSpaces, brief.preferences.includes("open_plan"));
}

function RoomsPanel({ onHover }: { onHover: (pick: RoomPick | null) => void }) {
  const status = useSessionState((s) => s.designer.status);
  const lastResult = useSessionState((s) => s.designer.lastResult);
  const brief = useProjectState((s) => s.brief);
  const sizing = useProjectState((s) => s.sizing);
  const [view, setView] = useState<"tiles" | "adding" | "history">("tiles");
  const adding = view === "adding";
  const [tab, setTab] = useState<Tab>("rooms");
  const update = (patch: Partial<HouseBrief>) => editor.setBrief({ ...brief, ...patch });
  const running = status === "running";
  const auto = sizing?.footprint === "auto";
  const picks = picksOf(brief);

  return (
    <section className="rooms-panel studio-panel" aria-label="My rooms">
      <header className="studio-panel-head">
        <h2 className="rooms-title">{adding ? "Add rooms" : view === "history" ? "Design history" : "My rooms"}</h2>
        <button
          type="button"
          className={`btn btn-md ${view !== "tiles" ? "btn-primary" : "btn-secondary"}`}
          onClick={() => setView(view === "tiles" ? "adding" : "tiles")}
          aria-expanded={adding}
          data-testid="add-rooms"
        >
          {view !== "tiles" ? (
            "Done"
          ) : (
            <>
              <PlusIcon width={16} height={16} /> Add rooms
            </>
          )}
        </button>
      </header>
      <div className="rooms-panel-scroll">
        {view === "history" ? (
          <DesignHistory />
        ) : adding ? (
          <>
            <Tabs
              label="Choose rooms"
              value={tab}
              tabs={[
                { value: "rooms", label: "Rooms" },
                { value: "presets", label: "Starting points" },
              ]}
              onChange={setTab}
              testIdPrefix="rooms-tab"
            />
            {tab === "rooms" && <RoomPicker brief={brief} onHover={onHover} />}
            {tab === "presets" && (
              <>
                <Presets brief={brief} onPicked={() => setTab("rooms")} />
                <h3 className="rooms-subhead">From example homes</h3>
                <Inspiration onPicked={() => setTab("rooms")} />
              </>
            )}
          </>
        ) : (
          <>
            <MixBar brief={brief} picks={picks} />
            <RoomTiles brief={brief} picks={picks} onHover={onHover} />
            <p className="studio-hint">Drag a room onto the plan to say roughly where it goes. Click it for its size.</p>
            <PictureReader />
          </>
        )}

        {view !== "history" && (
          <details className="rooms-more">
            <summary data-testid="rooms-more">
              More options <ChevronDownIcon width={16} height={16} />
            </summary>
            <div className="rooms-more-body">
              <p className="rooms-map-note">
                {auto ? "The plot the house must fit" : "Your house's size and garden side"} {auto ? "is" : "are"} set in Map.{" "}
                <button type="button" className="link-btn" onClick={() => goToStep("map")} data-testid="brief-open-map">
                  Open Map
                </button>
              </p>
              <BriefSection title="Approximate sizes">
                <BriefSizeFields brief={brief} onChange={update} />
              </BriefSection>
              <BriefSection title="Accessibility">
                <label className="switch-row">
                  <span>
                    <strong>Accessible layout</strong>
                    <small>Step-free, with 1.5 m hallways and 1 m wide doors.</small>
                  </span>
                  <input
                    type="checkbox"
                    role="switch"
                    checked={brief.preferences.includes("accessible_layout")}
                    data-testid="brief-pref-accessible_layout"
                    onChange={() => update({ preferences: toggle(brief.preferences, "accessible_layout") })}
                  />
                </label>
              </BriefSection>
              <BriefSection title="Design preferences">
                <div className="chips">
                  {DESIGN_PREFERENCES.map((p) => {
                    const on = brief.preferences.includes(p);
                    return (
                      <button key={p} type="button" className={`chip${on ? " is-on" : ""}`} aria-pressed={on} data-testid={`brief-pref-${p}`} onClick={() => update({ preferences: toggle(brief.preferences, p) })}>
                        {on && <CheckIcon width={13} height={13} />}
                        {PREFERENCE_LABEL[p]}
                      </button>
                    );
                  })}
                </div>
                {brief.preferences.includes("kitchen_faces_garden") && !auto && <RearWallCheck />}
              </BriefSection>
              <BriefSection title="Anything else about the house?">
                <Instructions key={brief.additionalInstructions} value={brief.additionalInstructions} onCommit={(additionalInstructions) => update({ additionalInstructions })} />
              </BriefSection>
            </div>
          </details>
        )}
      </div>

      <footer className="rooms-footer">
        {lastResult && lastResult.tone !== "success" && (
          <div className={`designer-result is-${lastResult.tone}`} role="status" data-testid="designer-result">
            <p>{lastResult.message}</p>
            {lastResult.offerAutoSize && !auto && (
              <button
                type="button"
                className="btn btn-secondary btn-sm"
                disabled={running}
                onClick={async () => {
                  selectWorkspace("design");
                  await design.sizeFromRooms();
                }}
                data-testid="size-from-rooms"
              >
                Size the house from the rooms
              </button>
            )}
          </div>
        )}
        {brief.placements && (
          <p className="rooms-placed" data-testid="rooms-placed">
            {Object.keys(brief.placements).length === 1 ? "1 room placed on the plan" : `${Object.keys(brief.placements).length} rooms placed on the plan`}: layouts that put {Object.keys(brief.placements).length === 1 ? "it" : "them"} there come first.
          </p>
        )}
        {view !== "history" && <DesignHistoryButton onClick={() => setView("history")} />}
      </footer>
    </section>
  );
}

function RoomPicker({ brief, onHover }: { brief: HouseBrief; onHover: (pick: RoomPick | null) => void }) {
  const picks = picksOf(brief);
  const [closed, setClosed] = useState<ReadonlySet<RoomPickGroup>>(new Set());
  const set = (id: RoomPick, value: number) => editor.setBrief(withPicks(brief, { ...picks, [id]: value }));
  const bedrooms = pickedBedrooms(picks);
  const bathrooms = pickedBathrooms(picks);
  const placedPicks = new Set(Object.keys(brief.placements ?? {}).map((k) => k.split("#")[0]));
  const card = (id: RoomPick) => {
    const spec = ROOM_PICK_SPECS[id];
    const count = picks[id] ?? 0;
    const unavailable = id === "ensuite" && !picks.master_bedroom;
    const full =
      count >= spec.max || unavailable || (spec.group === "bedrooms" && bedrooms >= BRIEF_LIMITS.maxBedrooms) || (spec.group === "bathrooms" && bathrooms >= BRIEF_LIMITS.maxBathrooms);
    return (
      <li
        key={id}
        className={`pick-card${count ? " is-on" : ""}${unavailable ? " is-unavailable" : ""}`}
        data-testid={`pick-${id}`}
        onPointerEnter={() => count && onHover(id)}
        onPointerLeave={() => onHover(null)}
        onFocus={() => count && onHover(id)}
        onBlur={() => onHover(null)}
      >
        <span
          className={`pick-handle${count ? " is-draggable" : ""}`}
          draggable={count > 0}
          onDragStart={(e) => {
            e.dataTransfer.setData(PICK_DRAG_TYPE, id);
            e.dataTransfer.effectAllowed = "move";
          }}
          title={count ? `Drag onto the plan to say roughly where the ${spec.label.toLowerCase()} goes` : undefined}
          data-testid={`pick-drag-${id}`}
        >
          <RoomTile type={PICK_ROOM_TYPE[id]} size={44} className="pick-tile" />
        </span>
        <span className="pick-text">
          <strong>{spec.label}</strong>
          <small>{unavailable ? "Add a master bedroom first" : spec.hint}</small>
        </span>
        <CountStepper
          noun={spec.label.toLowerCase()}
          value={count}
          max={full && !unavailable ? count : spec.max}
          disabledReason={unavailable ? "it needs a master bedroom first" : undefined}
          onChange={(v) => set(id, v)}
          testIdPrefix={`pick-${id}`}
        />
        {count > 0 ? (
          <Menu label={`Place ${spec.label.toLowerCase()}`} align="right" className="place-menu" testId={`place-menu-${id}`} summary={<PinIcon width={16} height={16} className={placedPicks.has(id) ? "is-placed" : undefined} />}>
            <PlaceGrid pick={id} brief={brief} picks={picks} />
          </Menu>
        ) : (
          <span className="place-menu-space" aria-hidden />
        )}
      </li>
    );
  };
  return (
    <div className="room-picker" data-testid="room-picker">
      {ROOM_PICK_GROUPS.map(({ group, picks: ids }) => {
        const open = !closed.has(group);
        return (
          <section key={group} className="pick-group">
            <button
              type="button"
              className="pick-group-header"
              aria-expanded={open}
              onClick={() => setClosed((c) => (c.has(group) ? new Set([...c].filter((g) => g !== group)) : new Set([...c, group])))}
            >
              {ROOM_PICK_GROUP_LABEL[group]}
              {open ? <MinusIcon width={16} height={16} /> : <PlusIcon width={16} height={16} />}
            </button>
            {open && <ul>{ids.map(card)}</ul>}
          </section>
        );
      })}
    </div>
  );
}

/** One picture from each of bedrooms, living spaces and bathrooms, so presets read at a glance. */
const presetPictures = (picks: RoomPicks): RoomPick[] =>
  (["bedrooms", "living", "bathrooms"] as const).flatMap((group) => ROOM_PICK_GROUPS.find((g) => g.group === group)!.picks.filter((id) => picks[id]).slice(0, 1));

const describePicks = (picks: RoomPicks) => `${pickedBedrooms(picks)} bed · ${pickedBathrooms(picks)} bath`;

function Presets({ brief, onPicked }: { brief: HouseBrief; onPicked: () => void }) {
  const current = JSON.stringify(picksOf(brief));
  return (
    <ul className="preset-list" data-testid="presets">
      {BRIEF_PRESETS.map((p) => {
        const active = JSON.stringify(withPicks(brief, p.picks).rooms) === current;
        return (
          <li key={p.id}>
            <button
              type="button"
              className={`preset-card${active ? " is-active" : ""}`}
              onClick={() => {
                editor.setBrief(withPicks(brief, p.picks));
                onPicked();
              }}
              data-testid={`preset-${p.id}`}
            >
              <span className="preset-images" aria-hidden>
                {presetPictures(p.picks).map((id) => (
                  // eslint-disable-next-line @next/next/no-img-element -- small static illustrations
                  <img key={id} src={`/rooms/${id}.jpg`} alt="" width={56} height={42} loading="lazy" />
                ))}
              </span>
              <span className="preset-text">
                <strong>{p.label}</strong>
                <small>{p.description}</small>
              </span>
              <span className="preset-meta">{describePicks(p.picks)}</span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}

/** The example plans never change, so they are planned once per session rather than on every visit to the tab. */
let inspirationExamples: Array<{ template: (typeof PROJECT_TEMPLATES)[number]; level: Level | null }> | null = null;

function examplePlans() {
  return (inspirationExamples ??= PROJECT_TEMPLATES.map((t) => {
    const source = createPlanDocument({ id: `inspiration-${t.id}`, width: t.width, depth: t.depth });
    const plan = planLayouts({ intent: { action: "generate_layouts", brief: t.brief, count: 1 }, source, brief: t.brief, idPrefix: t.id }).candidates[0]?.document;
    return { template: t, level: plan?.levels[0] ?? null };
  }));
}

/** Example homes to borrow a room list from. */
function Inspiration({ onPicked }: { onPicked: () => void }) {
  const brief = useProjectState((s) => s.brief);
  const examples = examplePlans();
  return (
    <ul className="preset-list" data-testid="inspiration">
      {examples.map(({ template: t, level }) => (
        <li key={t.id}>
          <button
            type="button"
            className="preset-card"
            onClick={() => {
              const picks = picksFromCounts(t.brief.bedrooms, t.brief.bathrooms, t.brief.requiredSpaces, t.brief.preferences.includes("open_plan"));
              editor.setBrief(withPicks({ ...brief, preferences: t.brief.preferences, roomSizes: t.brief.roomSizes }, picks));
              onPicked();
            }}
            data-testid={`inspiration-${t.id}`}
          >
            <span className="preset-images">{level && <PlanThumbnail level={level} palette="warm" className="inspiration-plan" pad={0.4} />}</span>
            <span className="preset-text">
              <strong>{t.name}</strong>
              <small>{t.description}</small>
            </span>
            <span className="preset-meta">Use these rooms</span>
          </button>
        </li>
      ))}
    </ul>
  );
}

// ── Live preview ──────────────────────────────────────────────────────────

/** A layout for the picked rooms, worked out as the picks change. Not saved until layouts are generated. */
function usePreviewLevel(): { plan: PlanDocument | null; level: Level | null; problem: string | null; tooSmall: boolean; stale: boolean } {
  const current = useProjectState((s) => s.brief);
  // Counters answer at once; the preview plans a beat later, and skips ahead while clicks keep coming.
  const brief = useDeferredValue(current);
  const sizing = useProjectState((s) => s.sizing);
  const site = useProjectState((s) => s.site);
  const plans = useProjectState((s) => s.plans);
  // The user's own house, which layouts fill when the house size is fixed.
  const active = useDocumentState((s) => s.history.present);
  const rootId = (plans.find((p) => p.parentId === null && p.origin.kind === "user") ?? plans[0]).id;
  const planned = useMemo(() => {
    const auto = sizing?.footprint === "auto";
    const plot = generationPlot({ site, sizing });
    const source = editor.planDocument(rootId) ?? active;
    const result = planLayouts({
      intent: { action: "generate_layouts", brief, count: 1, ...(auto ? { footprint: "auto" as const, ...(plot ? { plot } : {}) } : {}) },
      source,
      brief,
      idPrefix: "preview",
    });
    const first = result.candidates[0];
    return first
      ? { plan: first.document, level: first.document.levels[0], problem: null, tooSmall: false }
      : { plan: null, level: null, problem: result.issues[0]?.message ?? "These rooms don't fit a layout yet.", tooSmall: !!result.issues[0]?.tooSmall };
  }, [brief, sizing, site, rootId, active]);
  return { ...planned, stale: brief !== current };
}

function RoomsPreview({ preview, highlight, history }: { preview: Preview; highlight?: readonly string[]; history: ReturnType<typeof useBriefHistory> }) {
  const { plan, level, problem, tooSmall, stale } = preview;
  const brief = useProjectState((s) => s.brief);
  const picks = picksOf(brief);
  const drop = placementDropHandlers(plan, brief, picks);
  const stored = useProjectState((s) => s.appearance);
  const appearance = useMemo(() => ({ ...DEFAULT_APPEARANCE, ...stored }), [stored]);
  const style = appearance.interiorStyle ?? DEFAULT_INTERIOR_STYLE;
  const available = useRenders((s) => s.available);
  const [mode, setMode] = useState<PreviewMode>("2d");
  const [zoom, setZoom] = useState(1);
  const [photo, setPhoto] = useState<{ level: Level; url: string } | null>(null);
  const [rendering, setRendering] = useState(false);
  const [photoError, setPhotoError] = useState<string | null>(null);
  // Low cut walls show the rooms and furniture, as a dollhouse.
  const display = useMemo(() => ({ cutaway: true, roof: false, dimensions: false, landscape: true, furniture: true, roomLabels: true }), []);
  // The card shows the house whole, with its roof, as it will look.
  const cardDisplay = useMemo(() => ({ cutaway: false, roof: true, dimensions: false, landscape: true, furniture: false, roomLabels: false }), []);
  const env = level ? analyzeEnvelope(level) : null;
  const sizeKey = env?.ok ? `${env.info.width}x${env.info.depth}` : "none";
  const shownPhoto = photo && photo.level === level ? photo.url : null;
  // Photos need the image service; in production the button only shows when it's there.
  const showRender = available === "yes" || (available === "no" && process.env.NODE_ENV === "development");

  const renderPhoto = async () => {
    if (!level) return;
    setRendering(true);
    setPhotoError(null);
    const result = await renders.renderOne(plan ?? level, { kind: "aerial" }, appearance, style);
    setRendering(false);
    if (result.ok) setPhoto({ level, url: result.url });
    else setPhotoError(result.message);
  };

  const plans = (
    <div className="studio-zoom" style={{ transform: `scale(${zoom})` }}>
      {plan && plan.levels.length > 1
        ? plan.levels.map((l) => (
            <figure key={l.id} className="rooms-floor">
              <PlanThumbnail level={l} plan={plan} palette="schematic" className="rooms-plan" pad={0.8} detail highlight={highlight}>
                <PlacementMarkers plan={plan} level={l} brief={brief} picks={picks} />
              </PlanThumbnail>
              <figcaption>{l.name}</figcaption>
            </figure>
          ))
        : level && (
            <PlanThumbnail level={level} palette="schematic" className="rooms-plan" pad={1.2} detail highlight={highlight}>
              {plan && <PlacementMarkers plan={plan} level={level} brief={brief} picks={picks} />}
            </PlanThumbnail>
          )}
    </div>
  );

  return (
    <section className={`rooms-preview is-${mode}${stale ? " is-stale" : ""}`} aria-label="Layout preview" data-testid="rooms-preview">
      <div className="rooms-preview-panes">
        {mode === "3d" ? (
          <div className="rooms-preview-3d">
            {level &&
              (shownPhoto ? (
                // eslint-disable-next-line @next/next/no-img-element -- an object URL made in the browser
                <img className="rooms-photo" src={shownPhoto} alt="Photo render of the layout from above" data-testid="rooms-photo" />
              ) : (
                <LevelView level={plan ?? level} display={display} appearance={appearance} lighting="midday" camera="orbit" cameraKey={sizeKey} />
              ))}
          </div>
        ) : (
          <div
            className={`rooms-preview-2d${plan && plan.levels.length > 1 ? " is-floors" : ""}`}
            {...drop}
            onWheel={(e) => {
              if (!e.ctrlKey && !e.metaKey) return;
              setZoom((z) => Math.min(3, Math.max(0.5, z * (e.deltaY < 0 ? 1.1 : 1 / 1.1))));
            }}
            data-testid="rooms-drop"
          >
            {plans}
          </div>
        )}
      </div>

      {!level && (
        <div className="rooms-preview-empty" role="status" data-testid="rooms-preview-problem">
          <p>{problem}</p>
          {tooSmall && (
            <button type="button" className="btn btn-primary btn-sm" onClick={() => editor.setSizing({ footprint: "auto" })} data-testid="preview-size-from-rooms">
              Size the house from the rooms
            </button>
          )}
        </div>
      )}

      <div className="rooms-preview-top">
        <SegmentedControl
          label="Preview"
          value={mode}
          options={[
            { value: "2d", label: "Plan" },
            { value: "3d", label: "3D" },
          ]}
          onChange={setMode}
          size="md"
          className="floating-pill"
          testIdPrefix="rooms-view"
        />
        <StudioControls zoom={zoom} onZoom={setZoom} history={history} brief={brief} plan={mode === "2d"} />
        {mode === "2d" && level ? (
          <button type="button" className="studio-three-card" onClick={() => setMode("3d")} aria-label="Open the 3D view" data-testid="studio-three-card">
            <LevelView level={plan ?? level} display={cardDisplay} appearance={appearance} lighting="midday" camera="orbit" cameraKey={sizeKey} />
            <span className="studio-three-chip">
              <CubeIcon width={14} height={14} /> 3D
            </span>
          </button>
        ) : (
          level &&
          mode === "3d" &&
          showRender && (
            <div className="rooms-photo-tools">
              {shownPhoto ? (
                <button type="button" className="btn btn-secondary btn-md" onClick={() => setPhoto(null)} data-testid="rooms-photo-back">
                  Back to 3D
                </button>
              ) : (
                <button
                  type="button"
                  className="btn btn-secondary btn-md"
                  disabled={available !== "yes" || rendering}
                  onClick={() => void renderPhoto()}
                  data-tooltip={available === "no" ? "Photos need GEMINI_API_KEY in .env.local (shown in development only)" : "Turns this view into a photo, in about ten seconds"}
                  data-tooltip-side="left"
                  data-testid="rooms-render-photo"
                >
                  <SparkleIcon width={16} height={16} /> {rendering ? "Making a photo…" : "Render photo"}
                </button>
              )}
              {photoError && <span className="rooms-photo-error">{photoError}</span>}
            </div>
          )
        )}
      </div>
    </section>
  );
}

/** "Kitchen facing garden" needs to know where the garden is. */
function RearWallCheck() {
  const hasRear = useDocumentState((s) => s.history.present.levels[0].rearWallId !== null);
  if (hasRear) return null;
  return (
    <p className="brief-note" data-testid="brief-rear-note">
      Mark the garden side so we know where the garden is.{" "}
      <button type="button" className="link-btn" onClick={() => goToStep("map")}>
        Mark it in Map
      </button>
    </p>
  );
}

/** Free text that supplements the structured brief; saved on blur. Re-keyed when the saved value changes. */
function Instructions({ value, onCommit }: { value: string; onCommit: (v: string) => void }) {
  const [text, setText] = useState(value);
  const ai = useSessionState((s) => s.designer.ai);
  const notesHint =
    ai === "available" ? "We read these notes when you generate layouts and add what we can to your rooms."
    : process.env.NODE_ENV === "development" ? "Saved with your rooms. Set ANTHROPIC_API_KEY to have them read into the brief (shown in development only)."
    : "Saved with your rooms.";
  return (
    <div className="field">
      <textarea
        aria-label="Anything else about the house?"
        rows={3}
        maxLength={BRIEF_LIMITS.maxInstructions}
        placeholder="e.g. We work from home and would love a boot room by the back door."
        value={text}
        data-testid="brief-instructions"
        onChange={(e) => setText(e.target.value)}
        onBlur={() => text !== value && onCommit(text)}
      />
      <p className="field-hint">{notesHint}</p>
    </div>
  );
}
