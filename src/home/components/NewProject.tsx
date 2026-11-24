"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useId, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  ArrowRightIcon,
  CheckIcon,
  ChevronDownIcon,
  ChevronRightIcon,
  CloseIcon,
  ExtensionIcon,
  HelpIcon,
  HouseMark,
  OutbuildingIcon,
  UploadIcon,
} from "@/components/ui/icons";
import { BRAND } from "@/components/brand";
import { useAreaText } from "@/components/units";
import { createPlanDocument } from "@/domain/commands";
import { analyzeEnvelope } from "@/domain/geometry/envelope";
import { DEFAULT_HOUSE } from "@/domain/plan/defaults";
import type { PlanDocument } from "@/domain/plan/types";
import {
  PROJECT_LOCATION_LABEL,
  PROJECT_LOCATIONS,
  type ProjectDetails,
  type ProjectDocument,
  type ProjectLocation,
  type ProjectType,
} from "@/domain/project/schema";
import { HOUSE_FIELDS, parseHouseValues, shapeDefaults, WingFields, type HouseFieldKey, type WingText } from "@/editor/components/CreateHouseDialog";
import { ShapePicker } from "@/editor/components/ShapePicker";
import { describeOutline } from "@/domain/geometry/outlineDescription";
import { defaultShapeParams, presetOutline, SHAPE_DEFAULT_SIZE, type ShapePreset } from "@/domain/geometry/outlinePresets";
import { PlanThumbnail } from "@/editor/components/designer/PlanThumbnail";
import { readProjectFile } from "@/persistence/jsonFile";
import { createBlankProject, createProjectFromDimensions, createProjectFromImport, editorHref } from "../library";
import { MassingPreview } from "./illustrations";

export type StartMethod = "scratch" | "dimensions" | "import";
type PreviewView = "2d" | "split" | "3d";

const METHODS: ReadonlyArray<{ id: StartMethod; title: string; text: string }> = [
  { id: "scratch", title: "Draw from scratch", text: "Start with a blank outline and draw the walls yourself." },
  { id: "dimensions", title: "Enter dimensions", text: "Type in the outside size of the house you have." },
  { id: "import", title: "Import a plan", text: `Open a project file saved from ${BRAND.name}.` },
];

const TYPES: ReadonlyArray<{ id: ProjectType; title: string; text: string; Icon: typeof HouseMark }> = [
  { id: "house", title: "House", text: "A whole home", Icon: HouseMark },
  { id: "extension", title: "Extension", text: "Add to existing home", Icon: ExtensionIcon },
  { id: "other", title: "Other", text: "Garage, studio, etc.", Icon: OutbuildingIcon },
];

const SUBMIT_LABEL: Record<StartMethod, string> = {
  scratch: "Start drawing",
  dimensions: "Create the outline",
  import: "Open the plan",
};

const PREVIEW_CHIP: Record<StartMethod, string> = {
  scratch: "Start from a blank outline",
  dimensions: "Your house outline",
  import: "Your imported plan",
};

const isMethod = (v: string | null): v is StartMethod => v === "scratch" || v === "dimensions" || v === "import";

/** The "Create a new project" page. The starting method can be preselected with ?method=. */
export function NewProjectPage() {
  const param = useSearchParams().get("method");
  const method = isMethod(param) ? param : "scratch";
  // Next keeps this page mounted after it opens the editor, so start a fresh form after each
  // project is created, and whenever a link chooses a different method.
  const [created, setCreated] = useState(0);
  return <NewProjectForm key={`${method}-${created}`} initialMethod={method} onCreated={() => setCreated((n) => n + 1)} />;
}

type ImportState =
  | { status: "empty" }
  | { status: "reading"; fileName: string }
  | { status: "error"; fileName: string; message: string }
  | { status: "ready"; fileName: string; project: ProjectDocument };

function NewProjectForm({ initialMethod, onCreated }: { initialMethod: StartMethod; onCreated: () => void }) {
  const router = useRouter();
  const [method, setMethod] = useState<StartMethod>(initialMethod);
  const [name, setName] = useState("My House");
  const nameTouched = useRef(false);
  const [location, setLocation] = useState<ProjectLocation | "">("");
  const [type, setType] = useState<ProjectType | null>("house");
  const [dims, setDims] = useState<Record<HouseFieldKey, string>>({
    width: String(DEFAULT_HOUSE.width),
    depth: String(DEFAULT_HOUSE.depth),
    externalThickness: String(DEFAULT_HOUSE.externalThickness),
    internalThickness: String(DEFAULT_HOUSE.internalThickness),
    wallHeight: String(DEFAULT_HOUSE.wallHeight),
  });
  const [shape, setShape] = useState<ShapePreset>("rectangle");
  const [wings, setWings] = useState<WingText>({ front: "", wing: "" });
  const [imported, setImported] = useState<ImportState>({ status: "empty" });
  const [view, setView] = useState<PreviewView>("split");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const ids = useId();

  // Next keeps this page mounted (hidden) after opening the editor; don't come back to a busy form.
  useLayoutEffect(() => () => setBusy(false), []);

  const parsedDims = useMemo(() => parseHouseValues(name, dims, shape, wings), [name, dims, shape, wings]);
  // Drawing from scratch starts from the chosen shape at its typical size.
  const scratchOutline = useMemo(() => {
    if (shape === "rectangle") return undefined;
    const { width, depth } = SHAPE_DEFAULT_SIZE[shape];
    return presetOutline(shape, defaultShapeParams(shape, width, depth));
  }, [shape]);
  const chooseShape = (next: ShapePreset) => {
    setShape(next);
    const d = shapeDefaults(next);
    setDims((v) => ({ ...v, width: d.width, depth: d.depth }));
    setWings({ front: d.front, wing: d.wing });
  };
  // What the project will start from, for the preview.
  const preview = useMemo((): { plan: PlanDocument; wallHeight: number } | null => {
    if (method === "import") {
      if (imported.status !== "ready") return null;
      const p = imported.project;
      const plan = (p.plans.find((v) => v.id === p.activePlanId) ?? p.plans[0]).document;
      return { plan, wallHeight: plan.levels[0].defaultWallHeight };
    }
    if (method === "dimensions" && !parsedDims.ok) return null;
    try {
      const values = method === "dimensions" && parsedDims.ok ? parsedDims.values : DEFAULT_HOUSE;
      const outline = method === "dimensions" && parsedDims.ok ? parsedDims.values.outline : scratchOutline;
      const plan = createPlanDocument({
        id: "preview",
        width: values.width,
        depth: values.depth,
        externalThickness: values.externalThickness,
        wallHeight: values.wallHeight,
        ...(outline ? { outline } : {}),
      });
      return { plan, wallHeight: values.wallHeight };
    } catch {
      return null;
    }
  }, [method, imported, parsedDims, scratchOutline]);

  const readFile = async (file: File) => {
    setError(null);
    setImported({ status: "reading", fileName: file.name });
    const loaded = await readProjectFile(file);
    if (!loaded.ok) {
      setImported({ status: "error", fileName: file.name, message: loaded.issues.map((i) => i.message).join(" ") });
      return;
    }
    setImported({ status: "ready", fileName: file.name, project: loaded.project });
    if (!nameTouched.current) setName(loaded.project.name || "Imported plan");
  };

  const submit = async () => {
    setError(null);
    const details: ProjectDetails = { location: location || null, type };
    const projectName = name.trim();
    if (!projectName) return setError("Give the project a name.");
    let create: () => Promise<string>;
    if (method === "dimensions") {
      if (!parsedDims.ok) return setError(parsedDims.error);
      const values = parsedDims.values;
      create = () => createProjectFromDimensions(values, details);
    } else if (method === "import") {
      if (imported.status !== "ready") return setError("Choose a project file to import.");
      const project = imported.project;
      create = () => createProjectFromImport(project, projectName, details);
    } else {
      create = () => createBlankProject(projectName, details, scratchOutline);
    }
    setBusy(true);
    try {
      const id = await create();
      router.push(editorHref(id, method === "scratch" ? "draw" : undefined));
      onCreated();
    } catch (e) {
      setBusy(false);
      setError(`The project couldn't be created: ${(e as Error).message || "unknown problem"}`);
    }
  };

  return (
    <div className="new-project" data-testid="new-project-page">
      <div className="new-top">
        <nav aria-label="Breadcrumb" className="breadcrumb">
          <Link href="/">Projects</Link>
          <span aria-hidden>›</span>
          <span aria-current="page">New project</span>
        </nav>
        <Link href="/" className="new-close" aria-label="Close and go back to projects">
          <CloseIcon width={20} height={20} />
        </Link>
      </div>

      <div className="new-layout">
        <form
          className="new-panel"
          aria-labelledby={`${ids}-title`}
          data-testid="new-project-form"
          onSubmit={(e) => {
            e.preventDefault();
            void submit();
          }}
        >
          <header className="new-head">
            <h1 id={`${ids}-title`} className="new-title">
              Start a new project
            </h1>
            <p className="new-lead">Choose how you&rsquo;d like to begin. Everything can be changed later.</p>
          </header>

          <div className="method-list" role="radiogroup" aria-label="How to start">
            {METHODS.map(({ id, title, text }) => (
              <button
                key={id}
                type="button"
                role="radio"
                aria-checked={method === id}
                className={`method-option${method === id ? " is-selected" : ""}`}
                data-testid={`method-${id}`}
                onClick={() => {
                  setMethod(id);
                  setError(null);
                }}
              >
                <MethodArt method={id} />
                <span className="method-text">
                  <span className="method-title">
                    {title}
                  </span>
                  <span className="method-desc">{text}</span>
                </span>
                <span className="choice-mark" aria-hidden>
                  {method === id && <CheckIcon width={13} height={13} />}
                </span>
              </button>
            ))}
          </div>

          <div className="new-fields">
            <div className="field">
              <label htmlFor={`${ids}-name`}>Project name</label>
              <input
                id={`${ids}-name`}
                value={name}
                maxLength={200}
                data-testid="new-project-name"
                onChange={(e) => {
                  nameTouched.current = true;
                  setName(e.target.value);
                }}
              />
            </div>

            {(method === "scratch" || method === "dimensions") && (
              <fieldset className="dims-fieldset" data-testid="new-shape">
                <legend>House shape</legend>
                <ShapePicker value={shape} onChange={chooseShape} />
                {method === "scratch" && shape !== "rectangle" && <p className="field-hint">Starts at a typical size; drag its walls or enter dimensions to change it.</p>}
              </fieldset>
            )}

            {method === "dimensions" && (
              <fieldset className="dims-fieldset">
                <legend>Outside dimensions</legend>
                <div className="dims-grid">
                  {HOUSE_FIELDS.filter((f) => f.key === "width" || f.key === "depth").map((f) => (
                    <NumberField key={f.key} id={`${ids}-${f.key}`} label={f.label} unit={f.unit} testId={`new-${f.key}`} value={dims[f.key]} onChange={(v) => setDims({ ...dims, [f.key]: v })} />
                  ))}
                  <WingFields shape={shape} idPrefix={ids} value={wings} onChange={setWings} testPrefix="new" />
                </div>
                <details className="new-more new-more-inline">
                  <summary>Wall thickness and height</summary>
                  <div className="dims-grid dims-grid-3">
                    {HOUSE_FIELDS.filter((f) => f.key !== "width" && f.key !== "depth").map((f) => (
                      <NumberField key={f.key} id={`${ids}-${f.key}`} label={f.label} unit={f.unit} testId={`new-${f.key}`} value={dims[f.key]} onChange={(v) => setDims({ ...dims, [f.key]: v })} />
                    ))}
                  </div>
                </details>
              </fieldset>
            )}

            {method === "import" && <ImportDrop state={imported} onFile={(f) => void readFile(f)} />}

            <details className="new-more" data-testid="new-more">
              <summary>
                <span>More details</span>
                <span className="new-more-hint">{moreSummary(location, type)}</span>
                <ChevronDownIcon width={16} height={16} aria-hidden />
              </summary>
              <div className="new-more-body">
                <SelectBox
                  id={`${ids}-location`}
                  label={
                    <>
                      Location / building standards
                      <span
                        className="field-help"
                        tabIndex={0}
                        role="img"
                        aria-label="Saved with the project. Plans aren't checked against building regulations yet."
                        data-tooltip="Saved with the project. Plans aren't checked against building regulations yet."
                        data-tooltip-side="top"
                      >
                        <HelpIcon width={15} height={15} />
                      </span>
                    </>
                  }
                  value={location}
                  onChange={(v) => setLocation(v as ProjectLocation | "")}
                  testId="new-project-location"
                >
                  <option value="">Not specified</option>
                  {PROJECT_LOCATIONS.map((l) => (
                    <option key={l} value={l}>
                      {PROJECT_LOCATION_LABEL[l]}
                    </option>
                  ))}
                </SelectBox>
                <fieldset className="type-fieldset">
                  <legend>Project type</legend>
                  <div className="type-chips">
                    {TYPES.map(({ id, title, text, Icon }) => (
                      <button
                        key={id}
                        type="button"
                        role="checkbox"
                        aria-checked={type === id}
                        title={text}
                        className={`type-chip${type === id ? " is-selected" : ""}`}
                        onClick={() => setType(type === id ? null : id)}
                      >
                        <Icon width={17} height={17} />
                        {title}
                      </button>
                    ))}
                  </div>
                </fieldset>
                <p className="field-hint">Plans are in metres. Choose two storeys on the Rooms step, or add a floor while you refine.</p>
              </div>
            </details>
          </div>

          <div className="new-actions">
            {error && (
              <p className="field-error" role="alert">
                {error}
              </p>
            )}
            <button type="submit" className="btn btn-primary btn-lg btn-block" disabled={busy} data-testid="new-project-submit">
              {busy ? "Creating project…" : SUBMIT_LABEL[method]}
              {!busy && <ArrowRightIcon width={18} height={18} />}
            </button>
            <Link href="/templates" className="new-alt">
              Or start from a template
              <ChevronRightIcon width={15} height={15} />
            </Link>
          </div>
        </form>

        <ProjectPreview method={method} preview={preview} view={view} onView={setView} importState={imported} dimsError={parsedDims.ok ? null : parsedDims.error} />
      </div>
    </div>
  );
}

/** "Ireland · Extension" — what the closed More details holds. */
function moreSummary(location: ProjectLocation | "", type: ProjectType | null): string {
  const parts = [location ? PROJECT_LOCATION_LABEL[location] : null, type ? TYPES.find((t) => t.id === type)!.title : null].filter(Boolean);
  return parts.length ? parts.join(" · ") : "Location, project type";
}

function NumberField({
  id,
  label,
  unit,
  value,
  onChange,
  testId,
  placeholder,
}: {
  id: string;
  label: string;
  unit: string;
  value: string;
  onChange: (value: string) => void;
  testId: string;
  placeholder?: string;
}) {
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      <div className="input-with-unit">
        <input id={id} inputMode="decimal" placeholder={placeholder} data-testid={testId} value={value} onChange={(e) => onChange(e.target.value)} />
        <span className="unit">{unit}</span>
      </div>
    </div>
  );
}

/** A small picture of each way to start. */
function MethodArt({ method }: { method: StartMethod }) {
  return (
    <span className="method-art" aria-hidden>
      <svg viewBox="0 0 80 64" width="80" height="64">
        {method === "scratch" && (
          <>
            <path d="M18 48V16h30v14" fill="none" stroke="#1c1a17" strokeWidth="3" strokeLinejoin="miter" />
            <path d="M48 30v18H18" fill="none" stroke="#2f6f5e" strokeWidth="2" strokeDasharray="3 3" />
            <circle cx="48" cy="30" r="3.2" fill="#2f6f5e" />
            <path d="m54 22 9-9 4 4-9 9-5 1z" fill="#fff" stroke="#1c1a17" strokeWidth="1.6" strokeLinejoin="round" />
          </>
        )}
        {method === "dimensions" && (
          <>
            <rect x="20" y="22" width="40" height="28" fill="#f3ead8" stroke="#1c1a17" strokeWidth="3" />
            <path d="M20 13h40M20 9v8M60 9v8" fill="none" stroke="#2f6f5e" strokeWidth="1.6" />
            <path d="M68 22v28M64 22h8M64 50h8" fill="none" stroke="#2f6f5e" strokeWidth="1.6" />
            <path d="M40 22v28M20 36h20" fill="none" stroke="#1c1a17" strokeWidth="1.4" />
          </>
        )}
        {method === "import" && (
          <>
            <path d="M24 10h22l10 10v34H24z" fill="#fff" stroke="#1c1a17" strokeWidth="1.8" strokeLinejoin="round" />
            <path d="M46 10v10h10" fill="none" stroke="#1c1a17" strokeWidth="1.8" strokeLinejoin="round" />
            <path d="M30 28h20v18H30zM40 28v9h10" fill="#f3ead8" stroke="#1c1a17" strokeWidth="1.5" />
            <circle cx="58" cy="50" r="9" fill="#2f6f5e" />
            <path d="M58 54.5v-9M54 49l4-4 4 4" fill="none" stroke="#fff" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
          </>
        )}
      </svg>
    </span>
  );
}

function SelectBox({
  id,
  label,
  value,
  onChange,
  children,
  testId,
}: {
  id: string;
  label: ReactNode;
  value: string;
  onChange: (value: string) => void;
  children: ReactNode;
  testId?: string;
}) {
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      <div className="select-box">
        <select id={id} value={value} data-testid={testId} onChange={(e) => onChange(e.target.value)}>
          {children}
        </select>
        <ChevronDownIcon width={16} height={16} aria-hidden />
      </div>
    </div>
  );
}

function ImportDrop({ state, onFile }: { state: ImportState; onFile: (file: File) => void }) {
  const [over, setOver] = useState(false);
  const id = useId();
  return (
    <div className="field">
      <span className="field-label">Project file</span>
      <label
        htmlFor={id}
        className={`drop-zone${over ? " is-over" : ""}${state.status === "error" ? " has-error" : ""}`}
        onDragOver={(e) => {
          e.preventDefault();
          setOver(true);
        }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setOver(false);
          const file = e.dataTransfer.files[0];
          if (file) onFile(file);
        }}
      >
        <UploadIcon width={22} height={22} />
        {state.status === "empty" && (
          <span>
            <span>
              <strong>Choose a file</strong> or drop it here
            </span>
            <small>A .floorplan.json project file exported from {BRAND.name}</small>
          </span>
        )}
        {state.status === "reading" && <span>Reading {state.fileName}…</span>}
        {state.status === "ready" && (
          <span>
            <strong>{state.fileName}</strong>
            <small>
              {state.project.name} · {state.project.plans.length} plan{state.project.plans.length === 1 ? "" : "s"} · choose another file to replace it
            </small>
          </span>
        )}
        {state.status === "error" && (
          <span>
            <strong>Couldn&rsquo;t open {state.fileName}</strong>
            <small>{state.message}</small>
          </span>
        )}
      </label>
      <input
        id={id}
        type="file"
        accept=".json,application/json"
        className="visually-hidden"
        data-testid="new-import-input"
        onChange={(e) => {
          const file = e.currentTarget.files?.[0];
          e.currentTarget.value = "";
          if (file) onFile(file);
        }}
      />
    </div>
  );
}

const VIEWS: ReadonlyArray<{ id: PreviewView; label: string }> = [
  { id: "2d", label: "2D" },
  { id: "split", label: "Split" },
  { id: "3d", label: "3D" },
];

function ProjectPreview({
  method,
  preview,
  view,
  onView,
  importState,
  dimsError,
}: {
  method: StartMethod;
  preview: { plan: PlanDocument; wallHeight: number } | null;
  view: PreviewView;
  onView: (v: PreviewView) => void;
  importState: ImportState;
  dimsError: string | null;
}) {
  const level = preview?.plan.levels[0];
  const env = level ? analyzeEnvelope(level) : null;
  const areaText = useAreaText();
  const size = env?.ok ? { width: env.info.width, depth: env.info.depth, area: env.info.grossArea, outline: env.info.isRectangle ? null : env.info.outsideRing, shape: env.info.isRectangle ? null : describeOutline(env.info).words } : null;
  const placeholder =
    method === "import"
      ? importState.status === "error"
        ? "That file couldn't be opened."
        : "Choose a project file to preview it here."
      : (dimsError ?? "Enter the outside dimensions to preview the outline.");
  return (
    <section className={`new-preview preview-card view-${view}`} aria-label="Preview" data-testid="new-project-preview">
      <div className="preview-head">
        <span className="preview-chip">{PREVIEW_CHIP[method]}</span>
        <span className="preview-note">Draw and edit in 2D, and see it in 3D in the editor</span>
      </div>
      {level && size ? (
        <div className="preview-panes">
          {view !== "3d" && (
            <div className="preview-pane preview-plan plan-paper">
              <PlanThumbnail level={level} palette="warm" className="preview-drawing" pad={1.2} detail />
              <span className="preview-size">
                {size.shape && `${size.shape[0].toUpperCase()}${size.shape.slice(1)} · `}
                {size.width.toFixed(2)} × {size.depth.toFixed(2)} m outside · {areaText(size.area)}
              </span>
            </div>
          )}
          {view !== "2d" && (
            <div className="preview-pane preview-massing">
              <MassingPreview width={size.width} depth={size.depth} outline={size.outline} wallHeight={preview?.wallHeight ?? DEFAULT_HOUSE.wallHeight} />
              <span className="preview-size">Massing preview</span>
            </div>
          )}
        </div>
      ) : (
        <div className="preview-empty">
          {method === "import" && <UploadIcon aria-hidden />}
          {placeholder}
        </div>
      )}
      <div className="view-switch" role="radiogroup" aria-label="Preview view">
        {VIEWS.map((v) => (
          <button key={v.id} type="button" role="radio" aria-checked={view === v.id} className={view === v.id ? "is-active" : undefined} onClick={() => onView(v.id)}>
            {v.label}
          </button>
        ))}
      </div>
    </section>
  );
}
