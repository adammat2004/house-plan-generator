"use client";

import { describeEntity } from "@/domain/commands";
import { deriveLevelGeometry, deriveRoomRegions, roomFaceIndices } from "@/domain/geometry/derive";
import { formatArea } from "@/domain/geometry/numeric";
import { editor, editorStores, useDocumentState, useSessionState } from "../state/editor";
import type { EntityKind } from "../state/stores";

/** Keyboard-accessible list of everything on the plan; selecting here equals selecting on the canvas. */
export function EntityList() {
  const level = useDocumentState((s) => s.history.present.levels[0]);
  const selection = useSessionState((s) => s.selection);
  const geometry = deriveLevelGeometry(level);
  const regions = deriveRoomRegions(level);
  const faces = roomFaceIndices(level);

  const item = (kind: EntityKind, id: string, label: string, meta: string) => {
    const active = selection?.kind === kind && selection.id === id;
    return (
      <li key={id}>
        <button
          type="button"
          className={`entity${active ? " is-active" : ""}`}
          aria-pressed={active}
          onClick={() => editor.select(active ? null : { kind, id })}
          onMouseEnter={() => editorStores.session.setState({ hover: { kind, id } })}
          onMouseLeave={() => editorStores.session.setState({ hover: null })}
        >
          <span>{label}</span>
          <small>{meta}</small>
        </button>
      </li>
    );
  };

  const rooms = Object.values(level.rooms).sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
  const walls = Object.values(level.walls);
  const openings = Object.values(level.openings);

  return (
    <nav className="entity-list" aria-label="Plan contents">
      <details open>
        <summary>
          Rooms <span className="count">{rooms.length}</span>
        </summary>
        <ul>
          {rooms.map((room) => {
            const region = regions[faces.get(room.id) ?? -1];
            return item("room", room.id, room.name, region ? formatArea(region.clearArea) : "");
          })}
        </ul>
      </details>
      <details>
        <summary>
          Walls <span className="count">{walls.length}</span>
        </summary>
        <ul>
          {walls.map((wall) =>
            item(
              "wall",
              wall.id,
              `${describeEntity(level, wall.id)}${level.rearWallId === wall.id ? " · rear" : ""}`,
              `${(geometry.axes.get(wall.id)?.length ?? 0).toFixed(3)} m`,
            ),
          )}
        </ul>
      </details>
      <details>
        <summary>
          Doors &amp; windows <span className="count">{openings.length}</span>
        </summary>
        <ul>
          {openings.length === 0 && <li className="empty">None yet — use the Door or Window tool.</li>}
          {openings.map((o) => item("opening", o.id, describeEntity(level, o.id), `${o.width.toFixed(3)} m · ${describeEntity(level, o.wallId)}`))}
        </ul>
      </details>
    </nav>
  );
}
