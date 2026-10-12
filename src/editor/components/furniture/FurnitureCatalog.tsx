"use client";

import { useState } from "react";
import { roomAtPoint } from "@/domain/design/analysis";
import { FURNITURE_BY_CATEGORY, FURNITURE_CATALOG, FURNITURE_CATEGORY_LABEL, ROOM_FURNITURE, type FurnitureCategory } from "@/domain/furniture/catalog";
import { ROOM_TYPE_LABEL } from "@/domain/plan/rooms";
import type { FurnitureKind, Level } from "@/domain/plan/types";
import { editor, useActiveLevel, useSessionState } from "../../state/editor";
import type { Selection } from "../../state/stores";
import { FurnitureArt } from "./FurnitureArt";

type Tab = FurnitureCategory | "suggested";

const mm = (m: number) => Math.round(m * 1000);

/** The room the user is working in: the selected room, or the room of the selected piece. */
function workingRoom(level: Level, selection: Selection): string | null {
  if (selection?.kind === "room" && level.rooms[selection.id]) return selection.id;
  if (selection?.kind === "furniture" && level.furniture[selection.id]) return roomAtPoint(level, level.furniture[selection.id].position);
  return null;
}

/** The Furniture tool's options: what to place, grouped by room, with the working room's usual pieces first. */
export function FurnitureCatalog() {
  const level = useActiveLevel();
  const selection = useSessionState((s) => s.selection);
  const chosen = useSessionState((s) => s.settings.furniture.kind);
  const roomId = workingRoom(level, selection);
  const room = roomId ? level.rooms[roomId] : null;
  const suggested = (room && ROOM_FURNITURE[room.type]) ?? null;
  const [picked, setTab] = useState<Tab | null>(null);
  const tab: Tab = picked === "suggested" && !suggested ? FURNITURE_CATALOG[chosen].category : (picked ?? (suggested ? "suggested" : FURNITURE_CATALOG[chosen].category));
  const kinds: FurnitureKind[] = tab === "suggested" ? (suggested ?? []) : (FURNITURE_BY_CATEGORY.find((c) => c.category === tab)?.kinds ?? []);
  return (
    <div className="tool-options floating furniture-catalog" role="group" aria-label="Furniture" data-testid="furniture-catalog">
      <div className="catalog-tabs" role="tablist" aria-label="Furniture groups">
        {suggested && room && (
          <button type="button" role="tab" aria-selected={tab === "suggested"} className={`chip${tab === "suggested" ? " is-on" : ""}`} onClick={() => setTab("suggested")}>
            For {room.type === "unspecified" ? room.name : ROOM_TYPE_LABEL[room.type]}
          </button>
        )}
        {FURNITURE_BY_CATEGORY.map(({ category }) => (
          <button
            key={category}
            type="button"
            role="tab"
            aria-selected={tab === category}
            className={`chip${tab === category ? " is-on" : ""}`}
            onClick={() => setTab(category)}
            data-testid={`catalog-${category}`}
          >
            {FURNITURE_CATEGORY_LABEL[category]}
          </button>
        ))}
      </div>
      <div className="catalog-grid" role="radiogroup" aria-label="Piece to place">
        {kinds.map((kind) => {
          const spec = FURNITURE_CATALOG[kind];
          return (
            <button
              key={kind}
              type="button"
              role="radio"
              aria-checked={chosen === kind}
              className={`catalog-item${chosen === kind ? " is-active" : ""}`}
              onClick={() => editor.chooseFurniture(kind)}
              data-testid={`catalog-item-${kind}`}
            >
              <FurnitureArt kind={kind} size={44} />
              <span className="catalog-label">{spec.label}</span>
              <small>
                {mm(spec.width)} × {mm(spec.depth)}
              </small>
            </button>
          );
        })}
      </div>
      <p className="field-hint">Click in a room to place it. Shift+R turns it; hold Alt to place it without snapping.</p>
    </div>
  );
}
