"use client";

import { IconButton } from "@/components/ui/controls";
import { CloseIcon } from "@/components/ui/icons";
import { editor, useSessionState } from "../../state/editor";
import { EntityList } from "../EntityList";

/** Everything on the plan as a list: keyboard access to every wall, opening and room. */
export function LayersPanel() {
  const open = useSessionState((s) => s.panels.layersOpen);
  if (!open) return null;
  return (
    <section className="layers-panel floating" aria-label="Layers">
      <header className="card-header card-header-plain">
        <h2 className="card-kicker">Layers</h2>
        <IconButton label="Close layers" tooltipSide="bottom" onClick={() => editor.setPanels({ layersOpen: false })}>
          <CloseIcon width={16} height={16} />
        </IconButton>
      </header>
      <div className="card-scroll">
        <EntityList />
      </div>
    </section>
  );
}
