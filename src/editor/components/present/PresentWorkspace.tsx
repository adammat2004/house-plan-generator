"use client";

import dynamic from "next/dynamic";
import { useState } from "react";
import { EyeIcon, SplitIcon } from "@/components/ui/icons";
import { useSessionState } from "../../state/editor";
import { in3d, inRefine } from "../../state/stores";
import { setSplit } from "../shell/tools";
import { set3d } from "./actions";
import { ElevationsView } from "./ElevationsView";
import { ExteriorGallery } from "./ExteriorGallery";
import { PresentPanel } from "./PresentPanel";
import { setPresentTab, usePresentTab, type PresentTab } from "./presentTabs";

const PRESENT_TABS: ReadonlyArray<readonly [PresentTab, string]> = [
  ["3d", "3D"],
  ["gallery", "Gallery"],
  ["elevations", "Elevations"],
];

/** three.js loads only when the 3D view is first opened. */
const ThreeView = dynamic(() => import("../../rendering/three/ThreeView"), {
  ssr: false,
  loading: () => <div className="three-loading">Loading 3D…</div>,
});

/**
 * The 3D view, in Refine and Review: over the plan, or beside it. Once
 * opened it stays on the page (still and hidden) while the plan is shown,
 * so going back to 3D is instant; leaving Refine and Review lets it go.
 * 2D and 3D stay in step: both draw the same document, and picking a room
 * in either picks it in the other.
 */
export function ThreeStage() {
  const where = useSessionState((s) => inRefine(s) || s.workspace === "review");
  const shown = useSessionState(in3d);
  const split = useSessionState((s) => s.view3d.split);
  const tab = usePresentTab();
  const [mounted, setMounted] = useState(false);
  if (shown && !mounted) setMounted(true);
  if (!where && mounted) setMounted(false);
  if (!mounted) return null;
  return (
    <div className={`three-pane${split ? " is-split" : ""}${shown ? "" : " is-hidden"}`} aria-hidden={!shown || undefined} data-testid="three-pane">
      <ThreeView active={shown && tab === "3d"} />
      {shown && (
        <div className="three-chrome">
          <ThreeBar split={split} tab={tab} />
          {tab === "3d" && <PresentPanel />}
        </div>
      )}
      {shown && tab !== "3d" && <div className="present-overlay">{tab === "gallery" ? <ExteriorGallery /> : <ElevationsView />}</div>}
    </div>
  );
}

/** Over the 3D view: put it beside the plan, and open its settings. */
function ThreeBar({ split, tab }: { split: boolean; tab: PresentTab }) {
  const panelOpen = useSessionState((s) => s.view3d.panelOpen);
  return (
    <div className="three-bar floating" role="toolbar" aria-label="3D view">
      <div role="tablist" aria-label="3D area" className="present-tabs">
        {PRESENT_TABS.map(([value, label]) => (
          <button key={value} type="button" role="tab" aria-selected={tab === value} className={`btn btn-ghost btn-sm${tab === value ? " is-active" : ""}`} onClick={() => setPresentTab(value)} data-testid={`present-tab-${value}`}>
            {label}
          </button>
        ))}
      </div>
      <button type="button" className={`btn btn-ghost btn-sm${split ? " is-active" : ""}`} aria-pressed={split} onClick={() => setSplit(!split)} data-testid="view-split">
        <SplitIcon width={16} height={16} /> Side by side
      </button>
      {!panelOpen && tab === "3d" && (
        <button type="button" className="btn btn-ghost btn-sm" onClick={() => set3d({ panelOpen: true })} data-testid="open-3d-panel">
          <EyeIcon width={16} height={16} /> View settings
        </button>
      )}
    </div>
  );
}
