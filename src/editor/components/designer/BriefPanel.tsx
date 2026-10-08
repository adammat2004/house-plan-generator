"use client";

import { useState, type ReactNode } from "react";
import {
  BRIEF_LIMITS,
  BRIEF_SPACE_LABEL,
  BRIEF_SPACES,
  PREFERENCE_IDS,
  PREFERENCE_LABEL,
  ROOM_SIZE_LABEL,
  ROOM_SIZES,
  roomSizeOf,
  SIZED_ROOM_LABEL,
  SIZED_ROOMS,
  type HouseBrief,
  type RoomSize,
  type SizedRoom,
} from "@/domain/brief/schema";
import { describeEntity } from "@/domain/commands";
import { analyzeEnvelope } from "@/domain/geometry/envelope";
import { IconButton } from "@/components/ui/controls";
import { CheckIcon, MinusIcon, PlusIcon, SparkleIcon } from "@/components/ui/icons";
import { design, editor, useDocumentState, useProjectState, useSessionState } from "../../state/editor";
import { selectWorkspace } from "../shell/tools";

/** Accessibility has its own section; the rest are design preferences. */
const DESIGN_PREFERENCES = PREFERENCE_IDS.filter((p) => p !== "accessible_layout");

const toggle = <T extends string>(list: T[], item: T) => (list.includes(item) ? list.filter((x) => x !== item) : [...list, item]);

/**
 * The Brief workspace: what the house needs, collected beside the plan.
 * Edits the project's structured brief; "Generate layouts" asks the planner
 * for new plans and opens them in Designs. The open plan is never changed.
 */
export function BriefPanel() {
  const workspace = useSessionState((s) => s.workspace);
  const status = useSessionState((s) => s.designer.status);
  const lastResult = useSessionState((s) => s.designer.lastResult);
  const brief = useProjectState((s) => s.brief);
  if (workspace !== "brief") return null;

  const update = (patch: Partial<HouseBrief>) => editor.setBrief({ ...brief, ...patch });
  const setSize = (group: SizedRoom, size: RoomSize) => update({ roomSizes: { ...brief.roomSizes, [group]: size } });
  const running = status === "running";
  const sizeApplies: Record<SizedRoom, boolean> = {
    living: brief.requiredSpaces.includes("living"),
    kitchen: brief.requiredSpaces.includes("kitchen"),
    bedrooms: brief.bedrooms > 0,
  };

  const generate = async () => {
    const ids = await design.generateLayouts();
    if (ids.length) selectWorkspace("design");
  };

  return (
    <section className="brief-panel floating" aria-label="Design brief" data-testid="brief-panel">
      <header className="brief-header">
        <span className="brief-eyebrow">
          <SparkleIcon width={14} height={14} /> Design brief
        </span>
        <h2>What does this house need?</h2>
        <p>Answer what you know. We&rsquo;ll lay out options that fit inside your shell.</p>
        <ShellSummary />
      </header>

      <div className="brief-body">
        <BriefSection title="Rooms">
          <div className="stepper-pair">
            <Stepper label="Bedrooms" value={brief.bedrooms} max={BRIEF_LIMITS.maxBedrooms} testId="brief-bedrooms" onChange={(bedrooms) => update({ bedrooms })} />
            <Stepper label="Bathrooms" value={brief.bathrooms} max={BRIEF_LIMITS.maxBathrooms} testId="brief-bathrooms" onChange={(bathrooms) => update({ bathrooms })} />
          </div>
        </BriefSection>

        <BriefSection title="Spaces" hint="Living spaces to include alongside the bedrooms.">
          <div className="space-grid">
            {BRIEF_SPACES.map((space) => {
              const on = brief.requiredSpaces.includes(space);
              return (
                <label key={space} className={`space-tile${on ? " is-on" : ""}`}>
                  <input type="checkbox" checked={on} data-testid={`brief-space-${space}`} onChange={() => update({ requiredSpaces: toggle(brief.requiredSpaces, space) })} />
                  <span className="space-check" aria-hidden>
                    {on && <CheckIcon width={12} height={12} />}
                  </span>
                  {BRIEF_SPACE_LABEL[space]}
                </label>
              );
            })}
          </div>
        </BriefSection>

        <BriefSection title="Approximate sizes">
          <div className="size-rows">
            {SIZED_ROOMS.map((group) => (
              <SizeRow key={group} group={group} value={roomSizeOf(brief, group)} disabled={!sizeApplies[group]} onChange={(size) => setSize(group, size)} />
            ))}
          </div>
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

        <BriefSection title="Floors">
          <div className="segmented brief-floors" role="radiogroup" aria-label="Floors">
            <button type="button" role="radio" aria-checked="true" className="is-active">
              Single storey
            </button>
            <button type="button" role="radio" aria-checked="false" aria-disabled="true" data-tooltip="Two-storey layouts are coming soon" data-tooltip-side="top">
              Two storeys
            </button>
          </div>
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
          {brief.preferences.includes("kitchen_faces_garden") && <RearWallCheck />}
        </BriefSection>

        <BriefSection title="Anything else about the house?">
          <Instructions key={brief.additionalInstructions} value={brief.additionalInstructions} onCommit={(additionalInstructions) => update({ additionalInstructions })} />
        </BriefSection>
      </div>

      <footer className="brief-footer">
        {lastResult && lastResult.tone !== "success" && (
          <div className={`designer-result is-${lastResult.tone}`} role="status" data-testid="designer-result">
            <p>{lastResult.message}</p>
          </div>
        )}
        <button type="button" className="btn btn-primary btn-block btn-lg" disabled={running} onClick={() => void generate()} data-testid="generate-layouts">
          <SparkleIcon width={18} height={18} /> {running ? "Generating…" : "Generate layouts"}
        </button>
        <p className="field-hint">Layouts open in Designs as new plans. Your current plan is never changed.</p>
      </footer>
    </section>
  );
}

function BriefSection({ title, hint, children }: { title: string; hint?: string; children: ReactNode }) {
  return (
    <fieldset className="brief-section">
      <legend>{title}</legend>
      {hint && <p className="field-hint">{hint}</p>}
      {children}
    </fieldset>
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
        Shell <strong>{env.info.width.toFixed(1)} × {env.info.depth.toFixed(1)} m</strong>
      </span>
      <span>
        Garden side <strong>{level.rearWallId ? describeEntity(level, level.rearWallId).replace(" external wall", "") : "not set"}</strong>
      </span>
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

function SizeRow({ group, value, disabled, onChange }: { group: SizedRoom; value: RoomSize; disabled: boolean; onChange: (size: RoomSize) => void }) {
  return (
    <div className={`size-row${disabled ? " is-disabled" : ""}`}>
      <span id={`size-${group}`}>{SIZED_ROOM_LABEL[group]}</span>
      <div className="segmented" role="radiogroup" aria-labelledby={`size-${group}`}>
        {ROOM_SIZES.map((size) => (
          <button
            key={size}
            type="button"
            role="radio"
            aria-checked={size === value}
            className={size === value ? "is-active" : undefined}
            disabled={disabled}
            onClick={() => onChange(size)}
            data-testid={`brief-size-${group}-${size}`}
          >
            {ROOM_SIZE_LABEL[size]}
          </button>
        ))}
      </div>
    </div>
  );
}

function Stepper({ label, value, max, onChange, testId }: { label: string; value: number; max: number; onChange: (v: number) => void; testId: string }) {
  return (
    <div className="stepper" role="group" aria-label={label}>
      <span>{label}</span>
      <div className="stepper-controls">
        <IconButton label={`Fewer ${label.toLowerCase()}`} disabled={value <= 0} onClick={() => onChange(value - 1)} data-testid={`${testId}-dec`}>
          <MinusIcon width={16} height={16} />
        </IconButton>
        <output aria-live="polite" data-testid={testId}>
          {value}
        </output>
        <IconButton label={`More ${label.toLowerCase()}`} disabled={value >= max} onClick={() => onChange(value + 1)} data-testid={`${testId}-inc`}>
          <PlusIcon width={16} height={16} />
        </IconButton>
      </div>
    </div>
  );
}

/** Free text that supplements the structured brief; saved on blur. Re-keyed when the saved value changes. */
function Instructions({ value, onCommit }: { value: string; onCommit: (v: string) => void }) {
  const [text, setText] = useState(value);
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
      <p className="field-hint">Saved with your brief. Layouts don&rsquo;t read free text yet.</p>
    </div>
  );
}
