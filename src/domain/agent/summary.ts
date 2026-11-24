import type { HouseBrief } from "../brief/schema";
import { roomBounds, roomConnections, roomRegion } from "../design/analysis";
import { storeyName } from "../plan/levels";
import type { Id, PlanDocument } from "../plan/types";

const round1 = (v: number) => Math.round(v * 10) / 10;

/**
 * What the model sees of the plan each turn: rooms with ids, uses, sizes and
 * what their doors and windows lead to. No coordinates.
 */
export function planSummary(document: PlanDocument, brief: HouseBrief, selectedRoomId: Id | null = null) {
  const floors = document.levels.map((level, index) => ({
    floor: storeyName(index),
    levelId: level.id,
    rooms: Object.values(level.rooms).map((room) => {
      const region = roomRegion(level, room.id);
      const b = roomBounds(level, room.id);
      return {
        id: room.id,
        name: room.name,
        type: room.type,
        areaM2: region ? round1(region.clearArea) : null,
        widthM: b ? round1(b.maxX - b.minX) : null,
        depthM: b ? round1(b.maxY - b.minY) : null,
        ...(room.locked ? { pinned: true } : {}),
        openings: roomConnections(level, room.id).map((c) => ({
          id: c.openingId,
          kind: c.kind,
          side: c.side,
          widthM: round1(c.width),
          to: c.target.kind === "room" ? c.target.name : c.target.kind,
        })),
      };
    }),
  }));
  const selected = selectedRoomId ? floors.flatMap((f) => f.rooms).find((r) => r.id === selectedRoomId) : undefined;
  return {
    floors,
    selectedRoom: selected ? { id: selected.id, name: selected.name } : null,
    brief: { bedrooms: brief.bedrooms, bathrooms: brief.bathrooms, storeys: brief.storeys ?? 1 },
  };
}
