import type { ComponentType } from "react";
import type { RoomPick } from "@/domain/brief/rooms";
import type { RoomType } from "@/domain/plan/types";
import { roomColour } from "@/design/roomColours";
import { ArmchairIcon, BathIcon, BedIcon, DeskIcon, RoomIcon, SofaIcon, type IconProps } from "@/components/ui/icons";

/** The room each pick becomes, for its colour and icon. */
export const PICK_ROOM_TYPE: Record<RoomPick, RoomType> = {
  master_bedroom: "primary_bedroom",
  double_bedroom: "bedroom",
  single_bedroom: "bedroom",
  ensuite: "ensuite",
  family_bathroom: "bathroom",
  wc: "wc",
  open_plan: "kitchen_dining",
  kitchen: "kitchen",
  kitchen_dining: "kitchen_dining",
  living_room: "living",
  dining_room: "dining",
  office: "office",
  utility: "utility",
  garage: "garage",
};

const ICON: Partial<Record<RoomType, ComponentType<IconProps>>> = {
  bedroom: BedIcon,
  primary_bedroom: BedIcon,
  bathroom: BathIcon,
  ensuite: BathIcon,
  wc: BathIcon,
  living: SofaIcon,
  kitchen: ArmchairIcon,
  kitchen_dining: ArmchairIcon,
  dining: ArmchairIcon,
  office: DeskIcon,
};

/** A room's colour from the 2D plan with a line icon of its use: the same key wherever rooms are listed. */
export function RoomTile({ type, size = 40, className }: { type: RoomType; size?: number; className?: string }) {
  const Icon = ICON[type] ?? RoomIcon;
  return (
    <span className={`room-tile${className ? ` ${className}` : ""}`} style={{ width: size, height: size, background: roomColour(type) }} aria-hidden>
      <Icon width={Math.round(size * 0.5)} height={Math.round(size * 0.5)} />
    </span>
  );
}
