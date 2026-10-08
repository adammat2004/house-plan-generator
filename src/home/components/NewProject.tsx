"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useId, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  ArrowRightIcon,
  CheckIcon,
  ChevronDownIcon,
  CloseIcon,
  DimensionsIcon,
  DrawIcon,
  ExtensionIcon,
  FitIcon,
  HelpIcon,
  HouseMark,
  ImageIcon,
  MoreIcon,
  OutbuildingIcon,
  RoomIcon,
  SelectIcon,
  UploadIcon,
  WallIcon,
} from "@/components/ui/icons";
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
import { HOUSE_FIELDS, parseHouseValues, type HouseFieldKey } from "@/editor/components/CreateHouseDialog";
import { PlanThumbnail } from "@/editor/components/designer/PlanThumbnail";
import { readProjectFile } from "@/persistence/jsonFile";
import { createBlankProject, createProjectFromDimensions, createProjectFromImport, editorHref } from "../library";
import { SectionHeader, TemplateRow } from "./pages";
import { MassingPreview } from "./illustrations";

export type StartMethod = "scratch" | "dimensions" | "import";
type PreviewView = "2d" | "split" | "3d";

const METHODS: ReadonlyArray<{ id: StartMethod; title: string; text: string; Icon: typeof DrawIcon }> = [
  { id: "scratch", title: "Draw from scratch", text: "Start with a blank outline and draw your floor plan.", Icon: DrawIcon },
  { id: "dimensions", title: "Enter dimensions", text: "Create a plan using your measurements.", Icon: DimensionsIcon },
  { id: "import", title: "Import floor plan", text: "Open a floor plan project file saved from HomeDesign.", Icon: ImageIcon },
];

const TYPES: ReadonlyArray<{ id: ProjectType; title: string; text: string; Icon: typeof DrawIcon }> = [
  { id: "house", title: "House", text: "A whole home", Icon: HouseMark },
  { id: "extension", title: "Extension", text: "Add to existing home", Icon: ExtensionIcon },
  { id: "other", title: "Other", text: "Garage, studio, etc.", Icon: OutbuildingIcon },
];

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
  const [imported, setImported] = useState<ImportState>({ status: "empty" });
  const [view, setView] = useState<PreviewView>("split");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const ids = useId();

  // Next keeps this page mounted (hidden) after opening the editor; don't come back to a busy form.
  useLayoutEffect(() => () => setBusy(false), []);

  const parsedDims = useMemo(() => parseHouseValues(name, dims), [name, dims]);

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
      const plan = createPlanDocument({
        id: "preview",
        width: values.width,
        depth: values.depth,
        externalThickness: values.externalThickness,
        wallHeight: values.wallHeight,
      });
      return { plan, wallHeight: values.wallHeight };
    } catch {
      return null;
    }
  }, [method, imported, parsedDims]);

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
      create = () => createBlankProject(projectName, details);
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
          <CloseIcon width={22} height={22} />
        </Link>
      </div>
      <h1 className="new-title">Create a new project</h1>
      <p className="new-lead">Choose how you want to start and set a few details to get going.</p>

      <div className="method-grid" role="radiogroup" aria-label="How to start">
        {METHODS.map(({ id, title, text, Icon }) => (
          <button
            key={id}
            type="button"
            role="radio"
            aria-checked={method === id}
            className={`method-card${method === id ? " is-selected" : ""}`}
            data-testid={`method-${id}`}
            onClick={() => {
              setMethod(id);
              setError(null);
            }}
          >
            <span className="start-icon" aria-hidden>
              <Icon width={40} height={40} />
            </span>
            <span className="start-text">
              <span className="start-title">{title}</span>
              <span className="start-desc">{text}</span>
            </span>
            <span className="choice-mark" aria-hidden>
              {method === id && <CheckIcon width={14} height={14} />}
            </span>
          </button>
        ))}
      </div>

      <div className="new-body">
        <form
          className="home-card details-card"
          aria-labelledby={`${ids}-details`}
          data-testid="new-project-form"
          onSubmit={(e) => {
            e.preventDefault();
            void submit();
          }}
        >
          <h2 id={`${ids}-details`}>Project details</h2>
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
          <div className="field-pair">
            <SelectBox id={`${ids}-units`} label="Units" value="m" onChange={() => {}}>
              <option value="m">Metres (m)</option>
              <option value="ft" disabled>
                Feet and inches (coming soon)
              </option>
            </SelectBox>
            <SelectBox id={`${ids}-floors`} label="Number of floors" value="1" onChange={() => {}}>
              <option value="1">1</option>
              <option value="2" disabled>
                2 or more (coming soon)
              </option>
            </SelectBox>
          </div>
          <SelectBox
            id={`${ids}-location`}
            label={
              <>
                Location / building standards <span className="optional">(optional)</span>
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

          {method === "dimensions" && (
            <fieldset className="dims-fieldset">
              <legend>Outside dimensions</legend>
              <div className="dims-grid">
                {HOUSE_FIELDS.map((f) => (
                  <div className="field" key={f.key}>
                    <label htmlFor={`${ids}-${f.key}`}>{f.label}</label>
                    <div className="input-with-unit">
                      <input
                        id={`${ids}-${f.key}`}
                        inputMode="decimal"
                        data-testid={`new-${f.key}`}
                        value={dims[f.key]}
                        onChange={(e) => setDims({ ...dims, [f.key]: e.target.value })}
                      />
                      <span className="unit">{f.unit}</span>
                    </div>
                  </div>
                ))}
              </div>
            </fieldset>
          )}

          {method === "import" && <ImportDrop state={imported} onFile={(f) => void readFile(f)} />}

          <fieldset className="type-fieldset">
            <legend>
              Project type <span className="optional">(optional)</span>
            </legend>
            <div className="type-grid">
              {TYPES.map(({ id, title, text, Icon }) => (
                <button
                  key={id}
                  type="button"
                  role="checkbox"
                  aria-checked={type === id}
                  className={`type-card${type === id ? " is-selected" : ""}`}
                  onClick={() => setType(type === id ? null : id)}
                >
                  <Icon width={24} height={24} />
                  <span className="type-title">{title}</span>
                  <span className="type-desc">{text}</span>
                  <span className="choice-mark" aria-hidden>
                    {type === id && <CheckIcon width={12} height={12} />}
                  </span>
                </button>
              ))}
            </div>
          </fieldset>

          {error && (
            <p className="field-error" role="alert">
              {error}
            </p>
          )}
          <button type="submit" className="home-btn home-btn-primary home-btn-lg home-btn-block" disabled={busy} data-testid="new-project-submit">
            {busy ? "Creating project…" : "Start designing"}
            {!busy && <ArrowRightIcon width={18} height={18} />}
          </button>
        </form>

        <ProjectPreview method={method} preview={preview} view={view} onView={setView} importState={imported} dimsError={parsedDims.ok ? null : parsedDims.error} />
      </div>

      <section className="home-section">
        <SectionHeader title="Example projects to get inspired" href="/templates" linkLabel="View all templates" />
        <TemplateRow limit={4} />
      </section>
    </div>
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
            <small>A .floorplan.json project file exported from HomeDesign</small>
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
  const size = env?.ok ? { width: env.info.width, depth: env.info.depth } : null;
  const placeholder =
    method === "import"
      ? importState.status === "error"
        ? "That file couldn't be opened."
        : "Choose a project file to preview it here."
      : (dimsError ?? "Enter the outside dimensions to preview the outline.");
  return (
    <section className={`preview-card view-${view}`} aria-label="Preview" data-testid="new-project-preview">
      <div className="preview-head">
        <span className="preview-chip">{PREVIEW_CHIP[method]}</span>
        <span className="preview-note">Draw and edit in 2D · the 3D view is coming soon</span>
      </div>
      {level && size ? (
        <div className="preview-panes">
          {view !== "3d" && (
            <div className="preview-pane preview-plan plan-paper">
              <div className="preview-rail" aria-hidden>
                <SelectIcon />
                <WallIcon />
                <RoomIcon />
                <FitIcon />
                <MoreIcon />
              </div>
              <PlanThumbnail level={level} palette="warm" className="preview-drawing" pad={1.2} detail />
              <span className="preview-size">
                {size.width.toFixed(2)} × {size.depth.toFixed(2)} m outside · {(size.width * size.depth).toFixed(0)} m²
              </span>
            </div>
          )}
          {view !== "2d" && (
            <div className="preview-pane preview-massing">
              <MassingPreview width={size.width} depth={size.depth} wallHeight={preview?.wallHeight ?? DEFAULT_HOUSE.wallHeight} />
              <span className="preview-size">Massing preview</span>
            </div>
          )}
        </div>
      ) : (
        <div className="preview-empty">{placeholder}</div>
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
