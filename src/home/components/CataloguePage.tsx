"use client";

import { useRouter } from "next/navigation";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { CATALOGUE, catalogueAppearance, cataloguePlan, type CatalogueEntry, type CataloguePlan } from "@/domain/project/catalogue";
import { EXTERIOR_STYLE_LABEL } from "@/domain/project/schema";
import { HOUSE_SHAPE_LABEL } from "@/domain/brief/schema";
import { SegmentedControl } from "@/components/ui/controls";
import { useAreaText, useSizeText } from "@/components/units";
import { PlanThumbnail } from "@/editor/components/designer/PlanThumbnail";
import { createProjectFromCatalogue, editorHref } from "../library";
import { showHomeNotice } from "../ui";
import { PageTitle } from "./pages";

/**
 * House plans: the catalogue of named houses to browse, filter and remix.
 * Each card lays its plan out once it scrolls into view. Remix makes a new
 * project from the house's rooms, with its five layouts and its look, and
 * opens it to change anything.
 */

type Beds = "any" | "1" | "2" | "3" | "4";
type Storeys = "any" | "1" | "2";
type Shape = "any" | CatalogueEntry["shape"];

export function CataloguePage() {
  const [beds, setBeds] = useState<Beds>("any");
  const [storeys, setStoreys] = useState<Storeys>("any");
  const [shape, setShape] = useState<Shape>("any");
  const [query, setQuery] = useState("");
  const shown = CATALOGUE.filter(
    (e) =>
      (beds === "any" || (beds === "4" ? e.bedrooms >= 4 : e.bedrooms === Number(beds))) &&
      (storeys === "any" || e.storeys === Number(storeys)) &&
      (shape === "any" || e.shape === shape) &&
      (!query.trim() || `${e.name} ${e.description} ${EXTERIOR_STYLE_LABEL[e.style]}`.toLowerCase().includes(query.trim().toLowerCase())),
  );
  return (
    <>
      <PageTitle title="House plans" lead={`${CATALOGUE.length} houses to start from. Remix one and change anything.`} />
      <div className="catalogue-filters" role="group" aria-label="Filter house plans">
        <input type="search" className="catalogue-search" placeholder="Search by name or style" value={query} onChange={(e) => setQuery(e.currentTarget.value)} aria-label="Search house plans" data-testid="catalogue-search" />
        <SegmentedControl
          label="Bedrooms"
          value={beds}
          options={[
            { value: "any", label: "Any beds" },
            { value: "1", label: "1" },
            { value: "2", label: "2" },
            { value: "3", label: "3" },
            { value: "4", label: "4+" },
          ]}
          onChange={setBeds}
          testIdPrefix="catalogue-beds"
        />
        <SegmentedControl
          label="Storeys"
          value={storeys}
          options={[
            { value: "any", label: "Any storeys" },
            { value: "1", label: "1" },
            { value: "2", label: "2" },
          ]}
          onChange={setStoreys}
          testIdPrefix="catalogue-storeys"
        />
        <SegmentedControl
          label="Shape"
          value={shape}
          options={[
            { value: "any", label: "Any shape" },
            { value: "rectangle", label: HOUSE_SHAPE_LABEL.rectangle },
            { value: "L", label: "L" },
            { value: "T", label: "T" },
            { value: "U", label: "U" },
          ]}
          onChange={setShape}
          testIdPrefix="catalogue-shape"
        />
      </div>
      <p className="catalogue-count" aria-live="polite" data-testid="catalogue-count">
        {shown.length === 1 ? "1 house" : `${shown.length} houses`}
      </p>
      <ul className="catalogue-grid" data-testid="catalogue">
        {shown.map((e) => (
          <CatalogueCard key={e.id} entry={e} />
        ))}
      </ul>
    </>
  );
}

/** Lays a card's plan out once the card is on screen, a little at a time so scrolling stays smooth. */
function useLazyPlan(entry: CatalogueEntry) {
  const ref = useRef<HTMLLIElement>(null);
  const [plan, setPlan] = useState<CataloguePlan | null | undefined>(undefined);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    let cancelled = false;
    const observer = new IntersectionObserver((entries) => {
      if (!entries.some((x) => x.isIntersecting)) return;
      observer.disconnect();
      const run = () => !cancelled && setPlan(cataloguePlan(entry));
      if (typeof requestIdleCallback === "function") requestIdleCallback(run, { timeout: 600 });
      else setTimeout(run, 0);
    });
    observer.observe(el);
    return () => {
      cancelled = true;
      observer.disconnect();
    };
  }, [entry]);
  return { ref, plan };
}

function CatalogueCard({ entry }: { entry: CatalogueEntry }) {
  const router = useRouter();
  const areaText = useAreaText();
  const sizeText = useSizeText();
  const { ref, plan } = useLazyPlan(entry);
  const [busy, setBusy] = useState(false);
  // The page stays mounted (hidden) after going to the editor.
  useLayoutEffect(() => () => setBusy(false), []);
  const remix = async () => {
    setBusy(true);
    try {
      router.push(editorHref(await createProjectFromCatalogue(entry), "refine"));
    } catch (error) {
      showHomeNotice("error", `Couldn't remix ${entry.name}: ${(error as Error).message}`);
      setBusy(false);
    }
  };
  const look = catalogueAppearance(entry);
  return (
    <li ref={ref} className="home-card catalogue-card" data-testid={`catalogue-${entry.id}`}>
      <div className="catalogue-media plan-paper">
        {plan ? (
          plan.plan.levels.length > 1 ? (
            <div className="catalogue-floors">
              {plan.plan.levels.map((l) => (
                <PlanThumbnail key={l.id} level={l} plan={plan.plan} palette="schematic" className="catalogue-plan" pad={0.5} />
              ))}
            </div>
          ) : (
            <PlanThumbnail level={plan.plan.levels[0]} plan={plan.plan} palette="schematic" className="catalogue-plan" pad={0.5} />
          )
        ) : (
          <span className="catalogue-placeholder" aria-hidden>
            {plan === null ? "This one doesn't fit its shape" : ""}
          </span>
        )}
        <span className="catalogue-tag">{EXTERIOR_STYLE_LABEL[entry.style]}</span>
      </div>
      <div className="catalogue-body">
        <h2>{entry.name}</h2>
        <p className="catalogue-facts">
          {entry.bedrooms} bed · {entry.bathrooms} bath · {entry.storeys === 2 ? "2 storeys" : "1 storey"}
          {plan ? ` · ${areaText(plan.area)}` : ""}
        </p>
        <p className="catalogue-desc">{entry.description}</p>
        <div className="catalogue-foot">
          <span className="catalogue-size">
            {plan ? sizeText(plan.width, plan.depth, 1) : " "} · {look.roofForm === "gabled" ? "Gabled" : "Hipped"} roof
          </span>
          <button type="button" className="btn btn-primary btn-sm" disabled={busy || plan === null} onClick={() => void remix()} data-testid={`remix-${entry.id}`}>
            {busy ? "Remixing…" : "Remix"}
          </button>
        </div>
      </div>
    </li>
  );
}
