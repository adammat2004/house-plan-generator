"use client";

import { Menu, MenuItem } from "@/components/ui/controls";
import { ArmchairIcon, ColumnIcon, LayersIcon, MoreIcon, SparkleIcon, StairsIcon, TrashIcon } from "@/components/ui/icons";
import { editor, useSessionState } from "../../state/editor";
import { selectTool, TOOLS, WORKSPACE_TOOLS } from "./tools";

/** Elements the More menu lists so the full kit is visible; they can't be placed yet. */
const COMING_SOON = [
  { id: "stairs", label: "Stairs", soon: "Stairs are coming soon", Icon: StairsIcon, workspaces: ["structure", "design"] },
  { id: "column", label: "Column", soon: "Columns are coming soon", Icon: ColumnIcon, workspaces: ["structure", "design"] },
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
        {!onBoard &&
          COMING_SOON.filter((t) => (t.workspaces as readonly string[]).includes(workspace)).map(({ id, label, soon, Icon }) => (
            <MenuItem key={id} onSelect={() => {}} disabled title={soon} data-testid={`tool-${id}`}>
              <span className="menu-item-main">
                <Icon width={16} height={16} /> {label}
              </span>
              <small>Soon</small>
            </MenuItem>
          ))}
        <MenuItem onSelect={() => editor.setPanels({ layersOpen: !layersOpen })} data-testid="toggle-layers">
          <span className="menu-item-main">
            <LayersIcon width={16} height={16} /> {layersOpen ? "Hide layers" : "Show layers"}
          </span>
          <small>L</small>
        </MenuItem>
        {workspace === "design" && (
          <>
            <MenuItem onSelect={() => editor.furnishAll(false)} data-testid="furnish-empty-rooms">
              <span className="menu-item-main">
                <ArmchairIcon width={16} height={16} /> Furnish empty rooms
              </span>
            </MenuItem>
            <MenuItem onSelect={() => editor.furnishAll(true)} data-testid="furnish-all-rooms">
              <span className="menu-item-main">
                <SparkleIcon width={16} height={16} /> Lay out every room again
              </span>
            </MenuItem>
            <MenuItem onSelect={() => editor.clearFurniture()} data-testid="clear-furniture">
              <span className="menu-item-main">
                <TrashIcon width={16} height={16} /> Remove all furniture
              </span>
            </MenuItem>
          </>
        )}
      </Menu>
    </nav>
  );
}
