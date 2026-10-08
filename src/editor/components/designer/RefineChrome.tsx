"use client";

import { roomBounds } from "@/domain/design/analysis";
import { Menu, MenuItem } from "@/components/ui/controls";
import { ArrowLeftIcon, SwapIcon, TargetIcon, VariationsIcon } from "@/components/ui/icons";
import { design, editorStores, useDocumentState, useProjectState, useSessionState } from "../../state/editor";
import { displayedDocument } from "../../state/stores";
import { toolController } from "../../tools/instance";
import { fitRect, worldToScreen } from "../../viewport/viewport";
import { showConcepts } from "../shell/tools";
import { useConcepts } from "./concepts";

const inPlanView = (s: { workspace: string; designView: string }) => s.workspace === "design" && s.designView === "plan";

/** Where you are while refining: back to all concepts, and which one this is. */
export function DesignBreadcrumb() {
  const shown = useSessionState(inPlanView);
  const activePlanId = useProjectState((s) => s.activePlanId);
  const { concepts, shells } = useConcepts();
  if (!shown) return null;
  const concept = concepts.find((c) => c.meta.id === activePlanId);
  const name = concept ? `${concept.letter}. ${concept.title}` : (shells.find((s) => s.meta.id === activePlanId)?.meta.label ?? "Plan");
  return (
    <nav className="design-crumb floating" aria-label="Design">
      <button type="button" onClick={showConcepts} data-testid="back-to-concepts">
        <ArrowLeftIcon width={16} height={16} /> All concepts
      </button>
      <span className="crumb-sep" aria-hidden>
        /
      </span>
      <span className="crumb-current" data-testid="current-concept">
        {name}
      </span>
    </nav>
  );
}

/** Quick actions floating above the selected room. */
export function RoomQuickBar() {
  const shown = useSessionState(inPlanView);
  const selection = useSessionState((s) => s.selection);
  const viewport = useSessionState((s) => s.viewport);
  const tool = useSessionState((s) => s.tool);
  const drag = useSessionState((s) => s.drag);
  const running = useSessionState((s) => s.designer.status === "running");
  const level = useDocumentState((s) => displayedDocument(s).levels[0]);
  if (!shown || selection?.kind !== "room" || tool !== "select" || drag || !level.rooms[selection.id]) return null;
  const b = roomBounds(level, selection.id);
  if (!b) return null;
  const at = worldToScreen(viewport, { x: b.minX, y: b.maxY });
  const roomId = selection.id;
  const others = Object.values(level.rooms).filter((r) => r.id !== roomId);
  return (
    <div className="room-quickbar floating" style={{ left: Math.max(8, at.x), top: Math.max(8, at.y - 64) }} role="toolbar" aria-label="Room" data-testid="room-quickbar">
      <button type="button" disabled={running} onClick={() => void design.openRoomVariations(roomId)} data-tooltip="Generate variations" data-tooltip-side="top" aria-label="Generate variations">
        <VariationsIcon width={18} height={18} />
      </button>
      <Menu label="Swap with another room" className="quick-swap" summary={<SwapIcon width={18} height={18} />}>
        {others.map((r) => (
          <MenuItem key={r.id} onSelect={() => design.swapRooms(roomId, r.id)}>
            Swap with {r.name}
          </MenuItem>
        ))}
      </Menu>
      <button
        type="button"
        onClick={() => editorStores.session.setState((s) => ({ viewport: fitRect(s.viewport, { minX: b.minX - 1, minY: b.minY - 1, maxX: b.maxX + 1, maxY: b.maxY + 1 }, { top: 120, right: 680, bottom: 200, left: 160 }) }))}
        data-tooltip="Zoom to room"
        data-tooltip-side="top"
        aria-label="Zoom to room"
      >
        <TargetIcon width={18} height={18} />
      </button>
      <button type="button" onClick={() => toolController.fitPlan()} data-tooltip="Show whole plan" data-tooltip-side="top" aria-label="Show whole plan" className="quick-text">
        Fit
      </button>
    </div>
  );
}
