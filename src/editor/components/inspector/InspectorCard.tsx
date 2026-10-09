"use client";

import { useDocumentState, useSessionState } from "../../state/editor";
import { displayedDocument } from "../../state/stores";
import { FurnitureInspector } from "./FurnitureInspector";
import { HouseInspector } from "./HouseInspector";
import { OpeningInspector } from "./OpeningInspector";
import { RoomInspector } from "./RoomInspector";
import { WallInspector } from "./WallInspector";

/** Contextual floating inspector: present only while something is selected. */
export function InspectorCard({ roomFocusKey }: { roomFocusKey: number | null }) {
  const doc = useDocumentState(displayedDocument);
  const selection = useSessionState((s) => s.selection);
  const collapsed = useSessionState((s) => s.panels.inspectorCollapsed);
  const level = doc.levels[0];

  let body: React.ReactNode = null;
  if (selection?.kind === "wall" && level.walls[selection.id]) body = <WallInspector level={level} wallId={selection.id} />;
  else if (selection?.kind === "opening" && level.openings[selection.id]) body = <OpeningInspector level={level} opening={level.openings[selection.id]} />;
  else if (selection?.kind === "room" && level.rooms[selection.id]) body = <RoomInspector key={selection.id} level={level} roomId={selection.id} focusKey={roomFocusKey} />;
  else if (selection?.kind === "house" && selection.id === level.id) body = <HouseInspector level={level} />;
  else if (selection?.kind === "furniture" && level.furniture[selection.id]) body = <FurnitureInspector level={level} item={level.furniture[selection.id]} />;
  if (!body) return null;

  return (
    <aside className={`inspector-card floating${collapsed ? " is-collapsed" : ""}`} aria-label="Inspector" data-testid="inspector">
      {body}
    </aside>
  );
}
