"use client";

import { useState, type ReactNode } from "react";
import { PLAN_FEATURE_LABEL, type PlanFeature } from "@/domain/design/analysis";
import { formatArea } from "@/domain/geometry/numeric";
import { ROOM_TYPE_LABEL } from "@/domain/plan/rooms";
import {
  AreaIcon,
  ArrowRightIcon,
  BathIcon,
  BedIcon,
  CheckIcon,
  ChevronDownIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  ChevronUpIcon,
  DeskIcon,
  DoorIcon,
  LeafIcon,
  SofaIcon,
  SunIcon,
  WarningIcon,
} from "@/components/ui/icons";
import type { PlanDocument } from "@/domain/plan/types";
import { areaLabel, sizeText, useAreaText } from "@/components/units";
import { usePhoneLayout } from "../shell/phone";
import { SendToComputer } from "../shell/SendToComputer";
import { openConcept } from "../shell/tools";
import { ConceptPreview, HousePreview } from "./ConceptPreview";
import { ExteriorPicture } from "./ExteriorPicture";
import { checkPlacements } from "@/domain/design/placement";
import { useProjectState } from "../../state/editor";
import { RoomGallery } from "./RoomGallery";
import type { Concept } from "./concepts";
import type { PlanPalette } from "./PlanThumbnail";

const VIEWS: ReadonlyArray<{ id: string; label: string; palette: PlanPalette }> = [
  { id: "plan", label: "Plan", palette: "finish" },
  { id: "uses", label: "Room uses", palette: "schematic" },
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
export function ConceptDetail({ concept }: { concept: Concept }) {
  const [tab, setTab] = useState<Tab>("overview");
  const [view, setView] = useState(0);
  // Phones show this panel as a sheet over the cards: the name and actions, with the details on request.
  const phone = usePhoneLayout();
  const [sheetOpen, setSheetOpen] = useState(false);
  const areaText = useAreaText();
  const a = concept.assessment;
  const shown = a.rooms.slice(0, 4);
  const other = a.rooms.slice(4).reduce((sum, r) => sum + r.area, 0);
  const hall = a.rooms.filter((r) => r.type === "hall").reduce((sum, r) => sum + r.area, 0);
  return (
    <aside className={`concept-detail layout-detail${sheetOpen ? " is-open" : ""}`} aria-label="Layout details" data-testid="concept-detail">
      <header className="concept-detail-header">
        <div>
          {concept.letter && <span className="concept-detail-kicker">Layout {concept.letter}</span>}
          <h2>{concept.title}</h2>
        </div>
        {phone && (
          <button type="button" className="btn btn-ghost sheet-toggle" aria-expanded={sheetOpen} onClick={() => setSheetOpen(!sheetOpen)} data-testid="layout-sheet-toggle">
            {sheetOpen ? "Less" : "Details"} {sheetOpen ? <ChevronDownIcon width={16} height={16} /> : <ChevronUpIcon width={16} height={16} />}
          </button>
        )}
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
            <ExteriorPicture planId={concept.meta.id} level={concept.plan} />
            <div className="viewer">
              <HousePreview plan={concept.plan} palette={VIEWS[view].palette} className="viewer-main" />
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
                  <ConceptPreview level={concept.level} plan={concept.plan} palette={v.palette} labels={false} className="viewer-thumb" />
                </button>
              ))}
            </div>
            <PlacedRooms plan={concept.plan} />
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
            <h3 className="detail-heading">Things to check</h3>
            {concept.sense.findings.length ? (
              <ul className="feature-list check-list" data-testid="detail-checks">
                {concept.sense.findings.map((f, i) => (
                  <li key={i}>
                    <WarningIcon width={18} height={18} />
                    {f.message}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="field-hint">Nothing obvious to fix.</p>
            )}
            <h3 className="detail-heading">Area breakdown</h3>
            <dl className="area-list">
              {shown.map((r) => (
                <div key={r.id}>
                  <dt>{r.name}</dt>
                  <dd>{areaLabel(r.area, 1)}</dd>
                </div>
              ))}
              {other > 0 && (
                <div>
                  <dt>Other rooms</dt>
                  <dd>{areaLabel(other, 1)}</dd>
                </div>
              )}
              <div className="is-total">
                <dt>Total floor area</dt>
                <dd data-testid="detail-total-area">{areaText(a.totalArea, 1)}</dd>
              </div>
            </dl>
          </>
        )}
        {tab === "rooms" && (
          <>
          <RoomGallery planId={concept.meta.id} level={concept.plan} />
          <h3 className="detail-heading">All rooms</h3>
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
          </>
        )}
        {tab === "dimensions" && (
          <dl className="area-list">
            {a.outside && (
              <div>
                <dt>Outside size</dt>
                <dd>
                  {sizeText(a.outside.width, a.outside.depth)}
                </dd>
              </div>
            )}
            {a.storeys && (
              <div>
                <dt>Storeys</dt>
                <dd>{a.storeys}</dd>
              </div>
            )}
            <div>
              <dt>Floor area (inside walls{a.storeys ? ", every floor" : ""})</dt>
              <dd>{areaText(a.totalArea, 1)}</dd>
            </div>
            <div>
              <dt>Living spaces</dt>
              <dd>{areaText(a.dayArea, 1)}</dd>
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
        <button type="button" className="btn btn-primary btn-block btn-lg" onClick={() => openConcept(concept.meta.id)} data-testid={`open-concept-${concept.meta.label}`}>
          Refine this layout <ArrowRightIcon width={16} height={16} />
        </button>
        {phone && <SendToComputer planId={concept.meta.id} className="btn btn-secondary btn-block btn-md" />}
      </footer>
    </aside>
  );
}

/** Where the rooms placed on the house ended up in this layout: each one met, or where it went instead. */
function PlacedRooms({ plan }: { plan: PlanDocument }) {
  const brief = useProjectState((s) => s.brief);
  if (!brief.placements || !brief.rooms) return null;
  const checks = checkPlacements(plan, brief.placements, brief.rooms);
  return (
    <>
      <h3 className="detail-heading">Rooms you placed</h3>
      <ul className="placed-list" data-testid="placed-list">
        {checks.map((c) => (
          <li key={c.key} className={c.honoured ? "is-met" : "is-missed"}>
            {c.honoured ? <CheckIcon width={14} height={14} /> : <WarningIcon width={14} height={14} />}
            <span>
              {c.name}: {c.honoured ? `at the ${c.wanted}, as placed` : c.at ? `at the ${c.at}, not the ${c.wanted}` : "not in this layout"}
            </span>
          </li>
        ))}
      </ul>
    </>
  );
}
