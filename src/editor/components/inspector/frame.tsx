"use client";

import type { ReactNode } from "react";
import type { PlanCommand } from "@/domain/commands";
import { IconButton, Menu, MenuItem } from "@/components/ui/controls";
import { ChevronDownIcon, CloseIcon, MoreIcon } from "@/components/ui/icons";
import { editor, useSessionState } from "../../state/editor";

/** Dispatches and returns true, or the failure message for inline display. */
export function run(command: PlanCommand): true | string {
  const result = editor.dispatch(command);
  return result.ok ? true : (result.issues[0]?.message ?? "Not valid");
}

export const mm = (metres: number) => `${Math.round(metres * 1000)}`;

/** Common props for fields shown in millimetres. */
export const MM_FIELD = { unit: "mm", decimals: 0, scale: 1000 } as const;

/** "West external wall" → "west external wall", for use mid-sentence. */
export const lowerFirst = (text: string) => text.charAt(0).toLowerCase() + text.slice(1);

/**
 * Card chrome shared by every inspector: name and a one-line summary, an
 * overflow menu, then the body, which collapses to keep the plan visible.
 */
export function InspectorFrame({
  title,
  summary,
  menu,
  icon,
  actions,
  children,
}: {
  title: string;
  summary?: ReactNode;
  menu?: ReactNode;
  /** A picture of the thing, beside its name. */
  icon?: ReactNode;
  /** Buttons beside the menu, such as the room's pin. */
  actions?: ReactNode;
  children: ReactNode;
}) {
  const collapsed = useSessionState((s) => s.panels.inspectorCollapsed);
  return (
    <>
      <header className="card-header">
        {icon && <span className="card-icon">{icon}</span>}
        <div className="card-title">
          <h2>{title}</h2>
          {summary && (
            <p className="card-summary" data-testid="inspector-summary">
              {summary}
            </p>
          )}
        </div>
        <div className="card-actions">
          {actions}
          <Menu label="More actions" align="right" testId="inspector-menu" className="inspector-menu" summary={<MoreIcon width={18} height={18} />}>
            {menu}
            <MenuItem onSelect={() => editor.setPanels({ inspectorCollapsed: !collapsed })} data-testid="inspector-collapse">
              {collapsed ? "Expand panel" : "Collapse panel"}
            </MenuItem>
          </Menu>
          <IconButton label="Close" tooltipSide="bottom" onClick={() => editor.select(null)} data-testid="inspector-close">
            <CloseIcon width={18} height={18} />
          </IconButton>
        </div>
      </header>
      {!collapsed && <div className="card-body">{children}</div>}
    </>
  );
}

export function Section({ title, children }: { title?: string; children: ReactNode }) {
  return (
    <div className="card-section">
      {title && <h3>{title}</h3>}
      {children}
    </div>
  );
}

/** Precision controls, kept out of the way until asked for. */
export function MoreSettings({ children }: { children: ReactNode }) {
  return (
    <details className="more-settings">
      <summary data-testid="more-settings">
        More settings <ChevronDownIcon width={16} height={16} />
      </summary>
      <div className="more-settings-body">{children}</div>
    </details>
  );
}
