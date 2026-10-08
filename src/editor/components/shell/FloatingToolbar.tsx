"use client";

import { Menu, MenuItem } from "@/components/ui/controls";
import { ArmchairIcon, ColumnIcon, LayersIcon, MoreIcon, StairsIcon } from "@/components/ui/icons";
import { editor, useSessionState } from "../../state/editor";
import { selectTool, TOOLS, WORKSPACE_TOOLS } from "./tools";

/** Elements the toolbar shows so the full kit is visible; they can't be placed yet. */
const COMING_SOON = [
  { id: "furniture", label: "Furniture", Icon: ArmchairIcon, workspaces: ["design"] },
  { id: "stairs", label: "Stairs", Icon: StairsIcon, workspaces: ["structure", "design"] },
  { id: "column", label: "Column", Icon: ColumnIcon, workspaces: ["structure", "design"] },
] as const;

/** Labelled tool rail floating over the left edge of the canvas. */
export function FloatingToolbar() {
  const tool = useSessionState((s) => s.tool);
  const workspace = useSessionState((s) => s.workspace);
  const layersOpen = useSessionState((s) => s.panels.layersOpen);
  const onBoard = useSessionState((s) => s.workspace === "design" && s.designView !== "plan");
  const available = WORKSPACE_TOOLS[workspace];
  if (!available.length) return null;
  return (
    <nav className="floating-toolbar floating" aria-label="Tools">
      {TOOLS.filter((t) => available.includes(t.id)).map(({ id, label, key, Icon }) => (
        <button
          key={id}
          type="button"
          className={`tool-btn${tool === id ? " is-active" : ""}`}
          aria-pressed={tool === id}
          data-tooltip-side="right"
          onClick={() => selectTool(id)}
          data-tooltip={onBoard ? `${label}: opens the plan` : `${label}  ${key}`}
          data-testid={`tool-${id}`}
        >
          <Icon width={20} height={20} />
          <span>{label}</span>
        </button>
      ))}
      {!onBoard &&
        COMING_SOON.filter((t) => (t.workspaces as readonly string[]).includes(workspace)).map(({ id, label, Icon }) => (
          <button key={id} type="button" className="tool-btn" aria-disabled="true" data-tooltip={`${label} ${id === "furniture" ? "is" : "are"} coming soon`} data-tooltip-side="right" data-testid={`tool-${id}`}>
            <Icon width={20} height={20} />
            <span>{label}</span>
          </button>
        ))}
      <Menu
        label="More tools"
        testId="tool-more"
        className="tool-more"
        summary={
          <span className={`tool-btn${layersOpen ? " is-active" : ""}`}>
            <MoreIcon width={20} height={20} />
            <span>More</span>
          </span>
        }
      >
        <MenuItem onSelect={() => editor.setPanels({ layersOpen: !layersOpen })} data-testid="toggle-layers">
          <span className="menu-item-main">
            <LayersIcon width={16} height={16} /> {layersOpen ? "Hide layers" : "Show layers"}
          </span>
          <small>L</small>
        </MenuItem>
      </Menu>
    </nav>
  );
}
