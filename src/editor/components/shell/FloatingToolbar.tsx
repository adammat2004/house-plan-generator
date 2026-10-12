"use client";

import { Menu, MenuItem } from "@/components/ui/controls";
import { ArmchairIcon, GridIcon, LayersIcon, MagnetIcon, MoreIcon, OutlineIcon, SparkleIcon, TrashIcon } from "@/components/ui/icons";
import { editor, useDocumentState, useSessionState } from "../../state/editor";
import { toggleSetting } from "./CanvasControls";
import { MULTI_FLOOR_TOOLS, selectTool, TOOLS, toolsFor } from "./tools";

/** Tools kept in the More menu: drawing a new outline is rare, and furniture is placed in the furnished view. */
const IN_MORE: ReadonlySet<string> = new Set(["outline"]);

/**
 * Labelled tool rail floating over the left edge of the canvas: picking,
 * rooms, walls, doors and windows, furniture while it's on show, and stairs
 * once there's a floor to go up to. The rest is under More.
 */
export function FloatingToolbar() {
  const tool = useSessionState((s) => s.tool);
  const tools = useSessionState(toolsFor);
  const furnished = useSessionState((s) => s.view === "furnished");
  const layersOpen = useSessionState((s) => s.panels.layersOpen);
  const gridVisible = useSessionState((s) => s.settings.gridVisible);
  const snapEnabled = useSessionState((s) => s.settings.snapEnabled);
  const onBoard = useSessionState((s) => s.workspace === "design" && s.designView !== "plan");
  const layouts = useSessionState((s) => s.workspace === "design" && s.designView === "board");
  const floors = useDocumentState((s) => s.history.present.levels.length);
  // Stairs need a floor to go up to.
  const available = tools.filter((t) => floors > 1 || !MULTI_FLOOR_TOOLS.has(t));
  const inRail = available.filter((t) => !IN_MORE.has(t) && (t !== "furniture" || furnished));
  // Layouts is for comparing; tools appear once a layout is open in Refine.
  if (!available.length || layouts) return null;
  return (
    <nav className="floating-toolbar floating" aria-label="Tools" data-chrome="left">
      {TOOLS.filter((t) => inRail.includes(t.id)).map(({ id, label, key, Icon }) => (
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
        <MenuItem onSelect={() => selectTool("outline")} role="menuitemcheckbox" aria-checked={tool === "outline"} data-testid="tool-outline">
          <span className="menu-item-main">
            <OutlineIcon width={16} height={16} /> Draw a new house outline
          </span>
          <small>O</small>
        </MenuItem>
        {!furnished && (
          <MenuItem onSelect={() => selectTool("furniture")} data-testid="more-furniture">
            <span className="menu-item-main">
              <ArmchairIcon width={16} height={16} /> Add furniture
            </span>
            <small>U</small>
          </MenuItem>
        )}
        <hr />
        <MenuItem onSelect={() => toggleSetting("gridVisible")} data-testid="toggle-grid">
          <span className="menu-item-main">
            <GridIcon width={16} height={16} /> {gridVisible ? "Hide grid" : "Show grid"}
          </span>
        </MenuItem>
        <MenuItem onSelect={() => toggleSetting("snapEnabled")} data-testid="toggle-snap">
          <span className="menu-item-main">
            <MagnetIcon width={16} height={16} /> {snapEnabled ? "Turn snapping off" : "Turn snapping on"}
          </span>
        </MenuItem>
        <MenuItem onSelect={() => editor.setPanels({ layersOpen: !layersOpen })} data-testid="toggle-layers">
          <span className="menu-item-main">
            <LayersIcon width={16} height={16} /> {layersOpen ? "Hide layers" : "Show layers"}
          </span>
          <small>L</small>
        </MenuItem>
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
      </Menu>
    </nav>
  );
}
