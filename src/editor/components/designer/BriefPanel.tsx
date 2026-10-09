"use client";

import dynamic from "next/dynamic";
import { useMemo, useState } from "react";
import { BRIEF_PRESETS, picksFromCounts, ROOM_PICK_GROUP_LABEL, ROOM_PICK_GROUPS, ROOM_PICK_SPECS, pickedBathrooms, pickedBedrooms, type RoomPick, type RoomPickGroup, type RoomPicks } from "@/domain/brief/rooms";
import { BRIEF_LIMITS, PREFERENCE_IDS, PREFERENCE_LABEL, withPicks, type HouseBrief } from "@/domain/brief/schema";
import { createPlanDocument, facingLabel } from "@/domain/commands";
import { assessPlan } from "@/domain/design/analysis";
import { DEFAULT_INTERIOR_STYLE } from "@/domain/design/renderRequest";
import { planLayouts } from "@/domain/design/stripPlanner";
import { analyzeEnvelope } from "@/domain/geometry/envelope";
import { describeOutline } from "@/domain/geometry/outlineDescription";
import type { Level } from "@/domain/plan/types";
import { DEFAULT_APPEARANCE } from "@/domain/project/schema";
import { PROJECT_TEMPLATES } from "@/domain/project/templates";
import { IconButton } from "@/components/ui/controls";
import { ArrowLeftIcon, CheckIcon, ChevronDownIcon, ExteriorIcon, InteriorIcon, MinusIcon, OrbitIcon, PlusIcon, SparkleIcon, SunIcon, WalkIcon } from "@/components/ui/icons";
import type { CameraMode, Lighting } from "../../rendering/three/viewer";
import { design, editor, renders, useDocumentState, useProjectState, useRenders, useSessionState } from "../../state/editor";
import { generateFromRooms, selectWorkspace } from "../shell/tools";
import { BriefSection, BriefSizeFields, HouseShapeChips, toggle } from "./BriefFields";
import { PlanThumbnail } from "./PlanThumbnail";

const LevelView = dynamic(() => import("../../rendering/three/LevelView"), { ssr: false, loading: () => <div className="three-host three-loading">Loading 3D…</div> });

/** Accessibility has its own section; the rest are design preferences. */
const DESIGN_PREFERENCES = PREFERENCE_IDS.filter((p) => p !== "accessible_layout");

type Tab = "rooms" | "presets" | "inspiration";
type PreviewMode = "3d" | "2d" | "split";

/**
 * Step 2, "Select your rooms": what the house needs, picked room by room,
 * beside a live 3D preview of a layout for those rooms. "Generate layouts"
 * (or Next) asks the planner for options and opens them in Design. The
 * user's own plan is never changed.
 */
export function BriefPanel() {
  const workspace = useSessionState((s) => s.workspace);
  if (workspace !== "brief") return null;
  return (
    <div className="rooms-step" data-testid="brief-panel">
      <RoomsPanel />
      <RoomsPreview />
    </div>
  );
}

/** The picks shown for a brief: its own, or ones matching an older brief's counts. */
export function picksOf(brief: HouseBrief): RoomPicks {
  return brief.rooms ?? picksFromCounts(brief.bedrooms, brief.bathrooms, brief.requiredSpaces, brief.preferences.includes("open_plan"));
}

function RoomsPanel() {
  const status = useSessionState((s) => s.designer.status);
  const lastResult = useSessionState((s) => s.designer.lastResult);
  const brief = useProjectState((s) => s.brief);
  const sizing = useProjectState((s) => s.sizing);
  const extension = useProjectState((s) => s.details?.type === "extension");
  const [tab, setTab] = useState<Tab>("rooms");
  const update = (patch: Partial<HouseBrief>) => editor.setBrief({ ...brief, ...patch });
  const running = status === "running";
  const auto = sizing?.footprint === "auto";

  return (
    <section className="rooms-panel" aria-label="Select your rooms">
      <div className="rooms-panel-scroll">
        <button type="button" className="rooms-back" onClick={() => selectWorkspace("structure")} data-testid="rooms-back">
          <ArrowLeftIcon width={16} height={16} /> Back
        </button>
        <p className="rooms-step-label">Step 2 of 4</p>
        <h2 className="rooms-title">Select your rooms</h2>
        <p className="rooms-lead">
          Choose what you want in your {extension ? "extension" : "home"}. We&rsquo;ll create layouts with the right size and flow for your spaces.
        </p>

        <div className="rooms-tabs" role="tablist">
          {(["rooms", "presets", "inspiration"] as Tab[]).map((t) => (
            <button key={t} type="button" role="tab" aria-selected={tab === t} className={tab === t ? "is-active" : undefined} onClick={() => setTab(t)} data-testid={`rooms-tab-${t}`}>
              {t[0].toUpperCase() + t.slice(1)}
            </button>
          ))}
        </div>

        {tab === "rooms" && <RoomPicker brief={brief} />}
        {tab === "presets" && <Presets brief={brief} onPicked={() => setTab("rooms")} />}
        {tab === "inspiration" && <Inspiration onPicked={() => setTab("rooms")} />}

        {auto && (
          <BriefSection title="House shape" hint="The house is shaped and sized from your rooms. Any shape mixes rectangles with L, T and U houses.">
            <HouseShapeChips value={brief.houseShape} onChange={(houseShape) => update({ houseShape })} />
          </BriefSection>
        )}

        <details className="rooms-more">
          <summary data-testid="rooms-more">
            More options <ChevronDownIcon width={16} height={16} />
          </summary>
          <div className="rooms-more-body">
            {auto ? <SizingSummary /> : <ShellSummary />}
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
      </div>

      <footer className="rooms-footer">
        {lastResult && lastResult.tone !== "success" && (
          <div className={`designer-result is-${lastResult.tone}`} role="status" data-testid="designer-result">
            <p>{lastResult.message}</p>
            {lastResult.offerAutoSize && !auto && (
              <button
                type="button"
                className="btn btn-outline btn-sm"
                disabled={running}
                onClick={async () => {
                  if ((await design.sizeFromRooms()).length) selectWorkspace("design");
                }}
                data-testid="size-from-rooms"
              >
                Size the house from the rooms
              </button>
            )}
          </div>
        )}
        <button type="button" className="btn btn-primary btn-block btn-lg" disabled={running} onClick={() => void generateFromRooms()} data-testid="generate-layouts">
          <SparkleIcon width={18} height={18} /> {running ? "Generating…" : "Generate layouts"}
        </button>
      </footer>
    </section>
  );
}

function RoomPicker({ brief }: { brief: HouseBrief }) {
  const picks = picksOf(brief);
  const [closed, setClosed] = useState<ReadonlySet<RoomPickGroup>>(new Set());
  const set = (id: RoomPick, value: number) => editor.setBrief(withPicks(brief, { ...picks, [id]: value }));
  const bedrooms = pickedBedrooms(picks);
  const bathrooms = pickedBathrooms(picks);
  const card = (id: RoomPick) => {
    const spec = ROOM_PICK_SPECS[id];
    const count = picks[id] ?? 0;
    const unavailable = id === "ensuite" && !picks.master_bedroom;
    const full =
      count >= spec.max || unavailable || (spec.group === "bedrooms" && bedrooms >= BRIEF_LIMITS.maxBedrooms) || (spec.group === "bathrooms" && bathrooms >= BRIEF_LIMITS.maxBathrooms);
    return (
      <li key={id} className={`pick-card${count ? " is-on" : ""}${unavailable ? " is-unavailable" : ""}`} data-testid={`pick-${id}`}>
        <label className="pick-check">
          <input type="checkbox" checked={count > 0} disabled={unavailable} onChange={() => set(id, count ? 0 : 1)} aria-label={spec.label} data-testid={`pick-${id}-check`} />
          <span aria-hidden>{count > 0 && <CheckIcon width={13} height={13} />}</span>
        </label>
        {/* eslint-disable-next-line @next/next/no-img-element -- small static illustrations */}
        <img className="pick-image" src={`/rooms/${id}.jpg`} alt="" width={84} height={64} loading="lazy" />
        <span className="pick-text">
          <strong>{spec.label}</strong>
          <small>{unavailable ? "Add a master bedroom first" : spec.hint}</small>
        </span>
        <span className="pick-counter" role="group" aria-label={`${spec.label} count`}>
          <IconButton label={`Fewer: ${spec.label}`} disabled={!count} onClick={() => set(id, count - 1)} data-testid={`pick-${id}-dec`}>
            <MinusIcon width={15} height={15} />
          </IconButton>
          <output data-testid={`pick-${id}-count`}>{count}</output>
          <IconButton label={`More: ${spec.label}`} disabled={full} onClick={() => set(id, count + 1)} data-testid={`pick-${id}-inc`}>
            <PlusIcon width={15} height={15} />
          </IconButton>
        </span>
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

/** Example homes to borrow a room list from. */
function Inspiration({ onPicked }: { onPicked: () => void }) {
  const brief = useProjectState((s) => s.brief);
  const examples = useMemo(
    () =>
      PROJECT_TEMPLATES.map((t) => {
        const source = createPlanDocument({ id: `inspiration-${t.id}`, width: t.width, depth: t.depth });
        const plan = planLayouts({ intent: { action: "generate_layouts", brief: t.brief, count: 1 }, source, brief: t.brief, idPrefix: t.id }).candidates[0]?.document;
        return { template: t, level: plan?.levels[0] ?? null };
      }),
    [],
  );
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

const CAMERAS: ReadonlyArray<{ id: CameraMode; label: string; Icon: typeof OrbitIcon }> = [
  { id: "orbit", label: "Orbit", Icon: OrbitIcon },
  { id: "walk", label: "Walk", Icon: WalkIcon },
  { id: "interior", label: "Interior", Icon: InteriorIcon },
  { id: "exterior", label: "Exterior", Icon: ExteriorIcon },
];

const LIGHTING: ReadonlyArray<{ id: Lighting; label: string }> = [
  { id: "morning", label: "Morning" },
  { id: "midday", label: "Daylight" },
  { id: "evening", label: "Evening" },
  { id: "night", label: "Night" },
];

/** A layout for the picked rooms, worked out as the picks change. Not saved until layouts are generated. */
function usePreviewLevel(): { level: Level | null; problem: string | null; tooSmall: boolean } {
  const brief = useProjectState((s) => s.brief);
  const sizing = useProjectState((s) => s.sizing);
  const plans = useProjectState((s) => s.plans);
  // The user's own house, which layouts fill when the house size is fixed.
  const active = useDocumentState((s) => s.history.present);
  const rootId = (plans.find((p) => p.parentId === null && p.origin.kind === "user") ?? plans[0]).id;
  return useMemo(() => {
    const auto = sizing?.footprint === "auto";
    const source = editor.planDocument(rootId) ?? active;
    const result = planLayouts({
      intent: { action: "generate_layouts", brief, count: 1, ...(auto ? { footprint: "auto" as const, ...(sizing?.plot ? { plot: sizing.plot } : {}) } : {}) },
      source,
      brief,
      idPrefix: "preview",
    });
    const first = result.candidates[0];
    return first
      ? { level: first.document.levels[0], problem: null, tooSmall: false }
      : { level: null, problem: result.issues[0]?.message ?? "These rooms don't fit a layout yet.", tooSmall: !!result.issues[0]?.tooSmall };
  }, [brief, sizing, rootId, active]);
}

function RoomsPreview() {
  const { level, problem, tooSmall } = usePreviewLevel();
  const stored = useProjectState((s) => s.appearance);
  const appearance = useMemo(() => ({ ...DEFAULT_APPEARANCE, ...stored }), [stored]);
  const style = appearance.interiorStyle ?? DEFAULT_INTERIOR_STYLE;
  const available = useRenders((s) => s.available);
  const [mode, setMode] = useState<PreviewMode>("3d");
  const [camera, setCamera] = useState<CameraMode>("orbit");
  const [cameraTick, setCameraTick] = useState(0);
  const [lighting, setLighting] = useState<Lighting>("midday");
  const [dimensions, setDimensions] = useState(false);
  const [photo, setPhoto] = useState<{ level: Level; url: string } | null>(null);
  const [rendering, setRendering] = useState(false);
  const [photoError, setPhotoError] = useState<string | null>(null);
  // Low cut walls show the rooms and furniture, as a dollhouse.
  const display = useMemo(() => ({ cutaway: true, roof: false, dimensions, landscape: true, furniture: true, roomLabels: true }), [dimensions]);
  const env = level ? analyzeEnvelope(level) : null;
  const facts = level ? assessPlan(level) : null;
  const sizeKey = env?.ok ? `${env.info.width}x${env.info.depth}` : "none";
  const shownPhoto = photo && photo.level === level ? photo.url : null;

  const renderPhoto = async () => {
    if (!level) return;
    setRendering(true);
    setPhotoError(null);
    const result = await renders.renderOne(level, { kind: "aerial" }, appearance, style);
    setRendering(false);
    if (result.ok) setPhoto({ level, url: result.url });
    else setPhotoError(result.message);
  };

  return (
    <section className={`rooms-preview is-${mode}`} aria-label="Layout preview" data-testid="rooms-preview">
      <div className="rooms-preview-panes">
        {mode !== "2d" && (
          <div className="rooms-preview-3d">
            {level &&
              (shownPhoto ? (
                // eslint-disable-next-line @next/next/no-img-element -- an object URL made in the browser
                <img className="rooms-photo" src={shownPhoto} alt="Photo render of the layout from above" data-testid="rooms-photo" />
              ) : (
                <LevelView level={level} display={display} appearance={appearance} lighting={lighting} camera={camera} cameraKey={`${sizeKey}:${cameraTick}`} />
              ))}
          </div>
        )}
        {mode !== "3d" && <div className="rooms-preview-2d plan-paper">{level && <PlanThumbnail level={level} palette="type" className="rooms-plan" pad={0.8} detail />}</div>}
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
        <div className="rooms-view-switch floating-pill" role="radiogroup" aria-label="Preview">
          {(
            [
              ["3d", "3D view"],
              ["2d", "2D plan"],
              ["split", "Split"],
            ] as const
          ).map(([id, label]) => (
            <button key={id} type="button" role="radio" aria-checked={mode === id} className={mode === id ? "is-active" : undefined} onClick={() => setMode(id)} data-testid={`rooms-view-${id}`}>
              {label}
            </button>
          ))}
        </div>
        <div className="rooms-preview-tools">
          <label className="floating-pill toggle-pill">
            <input type="checkbox" role="switch" checked={dimensions} onChange={() => setDimensions(!dimensions)} data-testid="rooms-dimensions" />
            Show dimensions
          </label>
          <label className="floating-pill floor-pill">
            Floor
            <select aria-label="Floor" defaultValue="ground">
              <option value="ground">Ground Floor</option>
              <option value="first" disabled>
                First Floor (coming soon)
              </option>
            </select>
          </label>
        </div>
      </div>

      {level && facts && (
        <div className="rooms-preview-facts floating-pill" data-testid="rooms-preview-facts">
          {env?.ok && (
            <span>
              {env.info.width} × {env.info.depth} m
            </span>
          )}
          <span>{Math.round(facts.totalArea)} m² inside</span>
          <span>
            {facts.bedrooms} bed · {facts.bathrooms} bath
          </span>
        </div>
      )}

      {level && mode !== "2d" && (
        <>
          <div className="rooms-photo-tools">
            {shownPhoto ? (
              <button type="button" className="btn btn-outline floating-pill" onClick={() => setPhoto(null)} data-testid="rooms-photo-back">
                Back to 3D
              </button>
            ) : (
              <button
                type="button"
                className="btn btn-outline floating-pill"
                disabled={available !== "yes" || rendering}
                onClick={() => void renderPhoto()}
                data-tooltip={available === "no" ? "Photo renders need GEMINI_API_KEY in .env.local" : "One paid call to Google's Gemini image model"}
                data-tooltip-side="left"
                data-testid="rooms-render-photo"
              >
                <SparkleIcon width={16} height={16} /> {rendering ? "Rendering photo…" : "Render photo"}
              </button>
            )}
            {photoError && <span className="rooms-photo-error">{photoError}</span>}
          </div>
          {!shownPhoto && (
            <div className="rooms-dock floating-pill" role="radiogroup" aria-label="Camera">
              {CAMERAS.map(({ id, label, Icon }) => (
                <button
                  key={id}
                  type="button"
                  role="radio"
                  aria-checked={camera === id}
                  className={camera === id ? "is-active" : undefined}
                  onClick={() => {
                    setCamera(id);
                    setCameraTick((t) => t + 1);
                  }}
                  data-testid={`rooms-camera-${id}`}
                >
                  <Icon width={20} height={20} />
                  {label}
                </button>
              ))}
            </div>
          )}
          {!shownPhoto && (
            <label className="rooms-light floating-pill">
              <SunIcon width={18} height={18} />
              <select aria-label="Lighting" value={lighting} onChange={(e) => setLighting(e.currentTarget.value as Lighting)} data-testid="rooms-lighting">
                {LIGHTING.map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.label}
                  </option>
                ))}
              </select>
            </label>
          )}
        </>
      )}
    </section>
  );
}

/** The shell the layouts must fit: outside size and which side the garden is. */
function ShellSummary() {
  const level = useDocumentState((s) => s.history.present.levels[0]);
  const env = analyzeEnvelope(level);
  if (!env.ok) return null;
  return (
    <div className="shell-summary" data-testid="brief-shell">
      <span>
        Shell{" "}
        <strong>
          {env.info.isRectangle ? "" : `${describeOutline(env.info).words}, `}
          {env.info.width.toFixed(1)} × {env.info.depth.toFixed(1)} m
        </strong>
      </span>
      <span>
        Garden side <strong>{(level.rearWallId && facingLabel(level, level.rearWallId)) || "not set"}</strong>
      </span>
      <button type="button" className="link-btn" onClick={() => editor.setSizing({ footprint: "auto" })} data-testid="use-auto-size">
        Size the house from the rooms instead
      </button>
    </div>
  );
}

/** Houses sized from the rooms: the plot they must fit, and a way back to the user's own house. */
function SizingSummary() {
  const plot = useProjectState((s) => s.sizing?.plot);
  return (
    <div className="shell-summary" data-testid="brief-sizing">
      <span>
        House size <strong>chosen from your rooms</strong>
      </span>
      <span>
        Plot <strong>{plot?.maxWidth || plot?.maxDepth ? `up to ${plot.maxWidth ?? "any"} × ${plot.maxDepth ?? "any"} m` : "no limit"}</strong>
      </span>
      <button type="button" className="link-btn" onClick={() => editor.setSizing({ footprint: "source" })} data-testid="use-fixed-shell">
        Use a fixed house size instead
      </button>
    </div>
  );
}

/** "Kitchen facing garden" needs to know where the garden is. */
function RearWallCheck() {
  const hasRear = useDocumentState((s) => s.history.present.levels[0].rearWallId !== null);
  if (hasRear) return null;
  return (
    <p className="brief-note" data-testid="brief-rear-note">
      Mark the rear wall so we know where the garden is.{" "}
      <button type="button" className="link-btn" onClick={() => selectWorkspace("structure")}>
        Go to Structure
      </button>
    </p>
  );
}

/** Free text that supplements the structured brief; saved on blur. Re-keyed when the saved value changes. */
function Instructions({ value, onCommit }: { value: string; onCommit: (v: string) => void }) {
  const [text, setText] = useState(value);
  const ai = useSessionState((s) => s.designer.ai);
  const notesHint =
    ai === "available"
      ? "When you generate layouts, Claude reads these notes and adds what it can to your rooms."
      : "Saved with your brief. Add an Anthropic API key to have Claude read these notes into the brief.";
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
