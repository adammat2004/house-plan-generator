"use client";

import { useState } from "react";
import { ChevronDownIcon, ChevronUpIcon, PlusIcon } from "@/components/ui/icons";
import { useDocumentState } from "../../state/editor";
import { PlanThumbnail } from "../designer/PlanThumbnail";

/**
 * Floors of the house. Plans have one level today, so the first floor is a
 * placeholder that shows where additional floors will go.
 */
export function FloorsPanel() {
  const [open, setOpen] = useState(true);
  // The committed plan: the thumbnail needn't follow every drag frame.
  const level = useDocumentState((s) => s.history.present.levels[0]);
  return (
    <section className={`floors-panel floating${open ? "" : " is-collapsed"}`} aria-label="Floors" data-testid="floors-panel">
      <header className="floors-header">
        <button type="button" className="floors-toggle" aria-expanded={open} onClick={() => setOpen(!open)} data-testid="floors-toggle">
          Ground Floor {open ? <ChevronUpIcon width={16} height={16} /> : <ChevronDownIcon width={16} height={16} />}
        </button>
        <button type="button" className="btn btn-outline btn-sm" aria-disabled="true" data-tooltip="More floors are coming soon" data-tooltip-side="top">
          <PlusIcon width={15} height={15} /> Add floor
        </button>
      </header>
      {open && (
        <div className="floor-tiles">
          <button type="button" className="floor-tile is-active" aria-current="true">
            <span className="floor-thumb">
              <PlanThumbnail level={level} palette="warm" className="floor-thumb-svg" pad={0.6} />
            </span>
            <span>Ground Floor</span>
          </button>
          <button type="button" className="floor-tile" aria-disabled="true" data-tooltip="More floors are coming soon" data-tooltip-side="top">
            <span className="floor-thumb is-empty">
              <PlusIcon width={22} height={22} />
            </span>
            <span>First Floor</span>
          </button>
        </div>
      )}
    </section>
  );
}
