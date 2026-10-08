"use client";

import { useState, type ReactNode } from "react";
import { PLAN_FEATURE_LABEL, type PlanFeature } from "@/domain/design/analysis";
import { formatArea } from "@/domain/geometry/numeric";
import { ROOM_TYPE_LABEL } from "@/domain/plan/rooms";
import { IconButton } from "@/components/ui/controls";
import {
  AreaIcon,
  ArrowRightIcon,
  BathIcon,
  BedIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  CloseIcon,
  DeskIcon,
  DoorIcon,
  LeafIcon,
  SofaIcon,
  SunIcon,
} from "@/components/ui/icons";
import { openConcept } from "../shell/tools";
import { ConceptPreview } from "./ConceptPreview";
import type { Concept } from "./concepts";
import type { PlanPalette } from "./PlanThumbnail";

const VIEWS: ReadonlyArray<{ id: string; label: string; palette: PlanPalette }> = [
  { id: "plan", label: "Plan", palette: "warm" },
  { id: "uses", label: "Room uses", palette: "type" },
  { id: "zones", label: "Day and night", palette: "zones" },
];

const FEATURE_ICON: Record<PlanFeature, ReactNode> = {
  open_plan: <SofaIcon width={18} height={18} />,
  kitchen_diner: <SofaIcon width={18} height={18} />,
  separate_living: <SofaIcon width={18} height={18} />,
  kitchen_faces_garden: <LeafIcon width={18} height={18} />,
  garden_access: <DoorIcon width={18} height={18} />,
  natural_light: <SunIcon width={18} height={18} />,
  utility_room: <AreaIcon width={18} height={18} />,
  home_office: <DeskIcon width={18} height={18} />,
  ensuite: <BathIcon width={18} height={18} />,
  dining_room: <AreaIcon width={18} height={18} />,
  garage: <AreaIcon width={18} height={18} />,
};

type Tab = "overview" | "rooms" | "dimensions";

/** The focused concept in depth, with the way into refining it. */
export function ConceptDetail({ concept, onClose }: { concept: Concept; onClose: () => void }) {
  const [tab, setTab] = useState<Tab>("overview");
  const [view, setView] = useState(0);
  const a = concept.assessment;
  const shown = a.rooms.slice(0, 4);
  const other = a.rooms.slice(4).reduce((sum, r) => sum + r.area, 0);
  const hall = a.rooms.filter((r) => r.type === "hall").reduce((sum, r) => sum + r.area, 0);
  return (
    <aside className="concept-detail floating" aria-label="Concept details" data-testid="concept-detail">
      <header className="concept-detail-header">
        <h2>
          {concept.letter}. {concept.title}
        </h2>
        <IconButton label="Close details" onClick={onClose}>
          <CloseIcon width={18} height={18} />
        </IconButton>
      </header>
      <div className="panel-tabs" role="tablist">
        {(["overview", "rooms", "dimensions"] as Tab[]).map((t) => (
          <button key={t} type="button" role="tab" aria-selected={tab === t} className={tab === t ? "is-active" : undefined} onClick={() => setTab(t)} data-testid={`detail-tab-${t}`}>
            {t[0].toUpperCase() + t.slice(1)}
          </button>
        ))}
      </div>
      <div className="concept-detail-body">
        {tab === "overview" && (
          <>
            <div className="viewer">
              <ConceptPreview level={concept.level} palette={VIEWS[view].palette} className="viewer-main" />
              <span className="viewer-caption">{VIEWS[view].label}</span>
              <button type="button" className="viewer-arrow is-prev" aria-label="Previous view" onClick={() => setView((view + VIEWS.length - 1) % VIEWS.length)}>
                <ChevronLeftIcon width={18} height={18} />
              </button>
              <button type="button" className="viewer-arrow is-next" aria-label="Next view" onClick={() => setView((view + 1) % VIEWS.length)}>
                <ChevronRightIcon width={18} height={18} />
              </button>
            </div>
            <div className="viewer-thumbs" role="tablist" aria-label="Views">
              {VIEWS.map((v, i) => (
                <button key={v.id} type="button" role="tab" aria-selected={view === i} aria-label={v.label} className={view === i ? "is-active" : undefined} onClick={() => setView(i)}>
                  <ConceptPreview level={concept.level} palette={v.palette} labels={false} className="viewer-thumb" />
                </button>
              ))}
            </div>
            <h3 className="detail-heading">Key features</h3>
            {a.features.length ? (
              <ul className="feature-list">
                {a.features.map((f) => (
                  <li key={f}>
                    {FEATURE_ICON[f]}
                    {PLAN_FEATURE_LABEL[f]}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="field-hint">No standout features yet.</p>
            )}
            <h3 className="detail-heading">Area breakdown</h3>
            <dl className="area-list">
              {shown.map((r) => (
                <div key={r.id}>
                  <dt>{r.name}</dt>
                  <dd>{r.area.toFixed(1)} m²</dd>
                </div>
              ))}
              {other > 0 && (
                <div>
                  <dt>Other rooms</dt>
                  <dd>{other.toFixed(1)} m²</dd>
                </div>
              )}
              <div className="is-total">
                <dt>Total floor area</dt>
                <dd data-testid="detail-total-area">{a.totalArea.toFixed(1)} m²</dd>
              </div>
            </dl>
          </>
        )}
        {tab === "rooms" && (
          <ul className="room-list">
            {a.rooms.map((r) => (
              <li key={r.id}>
                <span className="room-list-icon">{r.type === "bedroom" || r.type === "primary_bedroom" ? <BedIcon width={16} height={16} /> : r.type === "bathroom" || r.type === "ensuite" || r.type === "wc" ? <BathIcon width={16} height={16} /> : <AreaIcon width={16} height={16} />}</span>
                <span>
                  <strong>{r.name}</strong>
                  <small>{r.type === "unspecified" ? "Room" : ROOM_TYPE_LABEL[r.type]}</small>
                </span>
                <span className="room-list-area">{formatArea(r.area)}</span>
              </li>
            ))}
          </ul>
        )}
        {tab === "dimensions" && (
          <dl className="area-list">
            {a.outside && (
              <div>
                <dt>Outside size</dt>
                <dd>
                  {a.outside.width.toFixed(2)} × {a.outside.depth.toFixed(2)} m
                </dd>
              </div>
            )}
            <div>
              <dt>Floor area (inside walls)</dt>
              <dd>{a.totalArea.toFixed(1)} m²</dd>
            </div>
            <div>
              <dt>Living spaces</dt>
              <dd>{a.dayArea.toFixed(1)} m²</dd>
            </div>
            <div>
              <dt>Hallway share</dt>
              <dd>{a.totalArea ? Math.round((hall / a.totalArea) * 100) : 0}%</dd>
            </div>
            <div>
              <dt>Window area per m² floor</dt>
              <dd>{a.glazingRatio.toFixed(2)}</dd>
            </div>
            <div>
              <dt>Rooms</dt>
              <dd>{a.rooms.length}</dd>
            </div>
          </dl>
        )}
      </div>
      <footer className="concept-detail-footer">
        <button type="button" className="btn btn-primary btn-block btn-lg" onClick={() => openConcept(concept.meta.id)} data-testid="use-design">
          Use this design <ArrowRightIcon width={16} height={16} />
        </button>
      </footer>
    </aside>
  );
}
