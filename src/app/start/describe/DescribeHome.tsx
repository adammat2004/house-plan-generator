"use client";

import Link from "next/link";
import { editorHref, startDesigning } from "@/home/library";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { Logo } from "@/components/brand";
import { CountStepper } from "@/components/ui/controls";
import { ArrowRightIcon, SparkleIcon, WarningIcon } from "@/components/ui/icons";
import { briefFromFields, fieldsOfBrief, PROMPT_MAX_LENGTH, type BriefFields } from "@/domain/brief/fromPrompt";
import { BRIEF_LIMITS, BRIEF_SPACE_LABEL, BRIEF_SPACES, PREFERENCE_IDS, PREFERENCE_LABEL, type HouseBrief } from "@/domain/brief/schema";
import { targetAreaFit } from "@/domain/design/program";
import { BriefSection, BriefSizeFields, HouseShapeChips, StoreyChips, toggle } from "@/editor/components/designer/BriefFields";
import { createProjectFromBrief, generateHref } from "./createFromBrief";

export const DESCRIBE_EXAMPLES = [
  "4 bed family home, open-plan kitchen, home office, about 200 m², single storey",
  "Two-storey 3 bed with a garage and a utility room, around 150 m²",
  "Compact 2 bed bungalow, 2 bathrooms, lots of natural light",
];

type Availability = "checking" | "yes" | "no";
interface Read {
  fields: BriefFields;
  reply: string;
  notes: string[];
}

/**
 * Describe your dream home: a sentence or two becomes the structured brief,
 * shown as fields to adjust, and then the usual layouts are made from it.
 * Without an AI key the prompt is switched off and the room picker is the way in.
 */
export function DescribeHome() {
  const router = useRouter();
  const [available, setAvailable] = useState<Availability>("checking");
  const [text, setText] = useState("");
  const [reading, setReading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [read, setRead] = useState<Read | null>(null);
  const [creating, setCreating] = useState(false);
  const brief = useRef<HTMLElement>(null);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/design/brief")
      .then((r) => r.json() as Promise<{ available?: boolean }>)
      .then((d) => !cancelled && setAvailable(d.available ? "yes" : "no"))
      .catch(() => !cancelled && setAvailable("no"));
    return () => {
      cancelled = true;
    };
  }, []);

  const describe = async (value = text) => {
    if (reading || value.trim().length < 3) return;
    setReading(true);
    setError(null);
    try {
      const response = await fetch("/api/design/brief", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ text: value }) });
      const data = (await response.json()) as { brief?: HouseBrief; reply?: string; notes?: string[]; error?: string };
      if (!response.ok || !data.brief) {
        setError(data.error ?? "Couldn't read that. Try again, or fill it in yourself.");
        if (response.status === 503) setAvailable("no");
        return;
      }
      setRead({ fields: fieldsOfBrief(data.brief), reply: data.reply ?? "", notes: data.notes ?? [] });
      requestAnimationFrame(() => brief.current?.scrollIntoView({ behavior: "smooth", block: "start" }));
    } catch {
      setError("Couldn't reach the assistant. Try again, or fill it in yourself.");
    } finally {
      setReading(false);
    }
  };

  const fillItIn = async () => {
    try {
      router.push(editorHref(await startDesigning(), "rooms"));
    } catch {
      setError("Couldn't start a new design.");
    }
  };

  const generate = async () => {
    if (!read || creating) return;
    setCreating(true);
    try {
      router.push(generateHref(await createProjectFromBrief(briefFromFields(read.fields))));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't start the design.");
      setCreating(false);
    }
  };

  return (
    <main className="describe" data-testid="describe-page">
      <Link href="/" className="start-brand" aria-label="Home">
        <Logo withName />
      </Link>
      <h1>Describe your dream home</h1>
      <p className="describe-lede">Tell us what you want in a sentence or two. We turn it into a brief you can adjust, then draw layouts for it.</p>

      {available === "no" ? (
        <div className="describe-unavailable" role="status" data-testid="describe-unavailable">
          <p>
            <WarningIcon width={16} height={16} /> Describing your home isn&apos;t available right now.
          </p>
          <p>You can still choose your rooms yourself.</p>
        </div>
      ) : (
        <form
          className="describe-form"
          onSubmit={(e) => {
            e.preventDefault();
            void describe();
          }}
        >
          <textarea
            aria-label="Describe your dream home"
            placeholder={DESCRIBE_EXAMPLES[0]}
            rows={4}
            value={text}
            maxLength={PROMPT_MAX_LENGTH}
            disabled={available === "checking" || reading}
            data-testid="describe-input"
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                e.preventDefault();
                void describe();
              }
            }}
          />
          <div className="describe-examples">
            {DESCRIBE_EXAMPLES.map((example) => (
              <button key={example} type="button" className="chip" disabled={available !== "yes" || reading} onClick={() => setText(example)}>
                {example}
              </button>
            ))}
          </div>
          <button type="submit" className="btn btn-primary btn-lg" disabled={available !== "yes" || reading || text.trim().length < 3} aria-busy={reading} data-testid="describe-submit">
            <SparkleIcon width={18} height={18} /> {reading ? "Reading your description…" : "Build my brief"}
          </button>
        </form>
      )}
      {error && (
        <p className="describe-error" role="alert" data-testid="describe-error">
          {error}
        </p>
      )}

      {read && <BriefReview ref={brief} read={read} onChange={(fields) => setRead({ ...read, fields })} onGenerate={() => void generate()} creating={creating} />}

      <div className="describe-alt">
        <p>Prefer to choose the rooms yourself?</p>
        <button type="button" className="btn btn-secondary btn-md" onClick={() => void fillItIn()} data-testid="describe-form-link">
          Fill it in yourself <ArrowRightIcon width={14} height={14} />
        </button>
      </div>
    </main>
  );
}

function BriefReview({ ref, read, onChange, onGenerate, creating }: { ref: React.Ref<HTMLElement>; read: Read; onChange: (fields: BriefFields) => void; onGenerate: () => void; creating: boolean }) {
  const { fields } = read;
  const set = (patch: Partial<BriefFields>) => onChange({ ...fields, ...patch });
  const brief = briefFromFields(fields);
  const fit = targetAreaFit(brief);
  return (
    <section className="describe-brief" ref={ref} aria-label="Your brief" data-testid="describe-brief">
      {read.reply && <p className="describe-reply">{read.reply}</p>}
      {read.notes.length > 0 && (
        <ul className="describe-notes" data-testid="describe-notes">
          {read.notes.map((n, i) => (
            <li key={i}>{n}</li>
          ))}
        </ul>
      )}
      <div className="describe-counts">
        <label>
          <span className="field-label">Bedrooms</span>
          <CountStepper noun="bedroom" value={fields.bedrooms} max={BRIEF_LIMITS.maxBedrooms} onChange={(bedrooms) => set({ bedrooms })} testIdPrefix="describe-bedrooms" />
        </label>
        <label>
          <span className="field-label">Bathrooms</span>
          <CountStepper noun="bathroom" value={fields.bathrooms} max={BRIEF_LIMITS.maxBathrooms} onChange={(bathrooms) => set({ bathrooms })} testIdPrefix="describe-bathrooms" />
        </label>
        <div className="field">
          <label htmlFor="describe-area">Floor area (m²)</label>
          <input
            id="describe-area"
            type="number"
            inputMode="numeric"
            min={BRIEF_LIMITS.minTargetArea}
            max={BRIEF_LIMITS.maxTargetArea}
            placeholder="Any size"
            value={fields.targetArea ?? ""}
            data-testid="describe-area"
            onChange={(e) => {
              const n = Number(e.target.value);
              const rest = { ...fields };
              delete rest.targetArea;
              onChange(e.target.value && n > 0 ? { ...rest, targetArea: Math.min(n, BRIEF_LIMITS.maxTargetArea) } : rest);
            }}
          />
        </div>
      </div>
      {fit && (
        <p className={`describe-fit${fit.met ? "" : " is-short"}`} role="status" data-testid="describe-fit">
          {fit.met ? <>These rooms can make a house of about {fields.targetArea} m².</> : fit.message}
        </p>
      )}
      <BriefSection title="Rooms">
        <div className="chips">
          {BRIEF_SPACES.map((s) => {
            const on = fields.spaces.includes(s) || (s === "office" && fields.preferences.includes("home_office"));
            return (
              <button key={s} type="button" className={`chip${on ? " is-on" : ""}`} aria-pressed={on} data-testid={`describe-space-${s}`} onClick={() => set({ spaces: toggle([...fields.spaces], s), ...(s === "office" && on ? { preferences: fields.preferences.filter((p) => p !== "home_office") } : {}) })}>
                {BRIEF_SPACE_LABEL[s]}
              </button>
            );
          })}
        </div>
      </BriefSection>
      <BriefSection title="Wishes">
        <div className="chips">
          {PREFERENCE_IDS.map((p) => {
            const on = fields.preferences.includes(p);
            return (
              <button key={p} type="button" className={`chip${on ? " is-on" : ""}`} aria-pressed={on} data-testid={`describe-pref-${p}`} onClick={() => set({ preferences: toggle([...fields.preferences], p) })}>
                {PREFERENCE_LABEL[p]}
              </button>
            );
          })}
        </div>
      </BriefSection>
      <BriefSection title="Storeys">
        <StoreyChips value={fields.storeys} onChange={(storeys) => set({ storeys })} testPrefix="describe" />
      </BriefSection>
      <BriefSection title="House shape">
        <HouseShapeChips value={fields.houseShape} onChange={(houseShape) => set({ houseShape })} testPrefix="describe" />
      </BriefSection>
      <BriefSection title="Room sizes">
        <BriefSizeFields brief={brief} onChange={(patch) => set({ roomSizes: patch.roomSizes })} testPrefix="describe" />
      </BriefSection>
      <button type="button" className="btn btn-primary btn-lg" disabled={creating} aria-busy={creating} onClick={onGenerate} data-testid="describe-generate">
        {creating ? "Starting…" : "Generate layouts"} <ArrowRightIcon width={18} height={18} />
      </button>
    </section>
  );
}
