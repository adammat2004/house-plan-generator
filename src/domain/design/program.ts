import { picksFromCounts, type RoomPick, type RoomPicks } from "../brief/rooms";
import { ROOM_SIZE_FACTOR, roomSizeOf, type HouseBrief, type PreferenceId, type SizedRoom } from "../brief/schema";
import type { FloorMaterial, RoomType } from "../plan/types";
import { OPEN_PLAN_MIN_SLOT, OPEN_PLAN_SHARE, ROOM_KINDS, ROOM_RULES, type RoomKind, type WindowSize } from "./roomRules";

export type { WindowSize } from "./roomRules";

/**
 * The space program: which rooms a brief asks for, with target areas and
 * minimum widths. Planners lay programs out; they never read the brief's
 * free text. Sizes and rules come from roomRules.
 */

const FLOOR_FOR: Partial<Record<RoomType, FloorMaterial>> = { bathroom: "tile", ensuite: "tile", wc: "tile", utility: "tile", garage: "concrete" };

/** The floor a generated room starts with: tiles where it gets wet, concrete in the garage, timber elsewhere. */
export const floorFor = (type: RoomType): FloorMaterial => FLOOR_FOR[type] ?? "timber";

export interface SpaceSpec {
  /** Stable within one program. */
  key: string;
  type: RoomType;
  name: string;
  /** Target clear floor area, m². */
  target: number;
  /** Minimum width of the room's slot along its band, wall centre to wall centre, m. */
  minWidth: number;
  zone: "day" | "night";
  window: WindowSize;
  /** A primary bedroom whose slot also holds its ensuite. */
  ensuite: boolean;
}

export interface Program {
  spaces: SpaceSpec[];
  preferences: ReadonlySet<PreferenceId>;
  /** Compromises made relative to the brief. */
  notes: string[];
}

/**
 * How far the program may depart from the brief to fit a footprint:
 * 0 exactly as asked, 1 kitchen and dining combined, 2 also open-plan living.
 */
export type Relaxation = 0 | 1 | 2;

/**
 * The rooms a brief asks for. A brief with rooms picked one by one is laid
 * out exactly; an older brief with only counts and spaces is read as the
 * picks it implies. To fit a footprint, separate kitchen and dining rooms
 * may combine (relax 1), and the living room may join them (relax 2).
 */
export function programFromBrief(brief: HouseBrief, relax: Relaxation = 0): Program {
  return programFromPicks(brief, brief.rooms ?? picksOf(brief), relax);
}

/** The picks a counts-only brief implies: an office if it asks for one, open plan unless it wants a separate living room. */
function picksOf(brief: HouseBrief): RoomPicks {
  const prefs = new Set(brief.preferences);
  const spaces = prefs.has("home_office") && !brief.requiredSpaces.includes("office") ? [...brief.requiredSpaces, "office" as const] : brief.requiredSpaces;
  return picksFromCounts(brief.bedrooms, brief.bathrooms, spaces, prefs.has("open_plan") && !prefs.has("separate_living_room"));
}

function programFromPicks(brief: HouseBrief, picks: RoomPicks, relax: Relaxation): Program {
  const prefs = new Set(brief.preferences);
  const notes: string[] = [];
  const spaces: SpaceSpec[] = [];
  const size = (group: SizedRoom) => ROOM_SIZE_FACTOR[roomSizeOf(brief, group)];
  const scale: Record<"kitchen" | "living" | "bedrooms", number> = {
    kitchen: (prefs.has("large_kitchen") ? 1.3 : 1) * size("kitchen"),
    living: size("living"),
    bedrooms: size("bedrooms"),
  };
  const push = (type: RoomType, name: string, target: number, minWidth: number, ensuite = false) =>
    spaces.push({ key: `s${spaces.length + 1}`, type, name, target, minWidth, zone: ROOM_RULES[type].zone, window: ROOM_RULES[type].window, ensuite });
  /** A room of a kind; scaled targets are rounded to whole square metres. */
  const add = (kind: RoomKind, name: string, options: { scale?: number; ensuite?: boolean } = {}) => {
    const { type, target, minSlot } = ROOM_KINDS[kind];
    push(type, name, options.scale === undefined ? target : Math.round(target * options.scale), minSlot, options.ensuite);
  };
  const count = (id: RoomPick) => picks[id] ?? 0;

  let openPlan = count("open_plan") > 0;
  let kitchen = count("kitchen") > 0;
  let kitchenDining = count("kitchen_dining") > 0;
  let dining = count("dining_room") > 0;
  let livingRooms = count("living_room");
  if (relax >= 1 && kitchen && dining) {
    [kitchen, dining, kitchenDining] = [false, false, true];
    notes.push("Kitchen and dining are combined so the rooms fit this footprint.");
  }
  if (relax >= 2 && !openPlan && livingRooms && (kitchen || kitchenDining)) {
    [openPlan, kitchen, kitchenDining] = [true, false, false];
    livingRooms--;
    notes.push("Living, kitchen and dining share one open-plan space so the rooms fit this footprint.");
  }
  if (openPlan) {
    const parts = ROOM_KINDS.living.target * scale.living + ROOM_KINDS.kitchen.target * scale.kitchen + ROOM_KINDS.dining.target;
    push("kitchen_dining", "Kitchen / Living / Dining", Math.round(parts * OPEN_PLAN_SHARE), OPEN_PLAN_MIN_SLOT);
  }
  if (kitchenDining) add("kitchen_dining", "Kitchen / Dining", { scale: scale.kitchen });
  if (kitchen) add("kitchen", "Kitchen", { scale: scale.kitchen });
  if (dining) add("dining", "Dining Room");
  for (let i = 0; i < livingRooms; i++) add(i === 0 ? "living" : "snug", i === 0 ? "Living Room" : "Snug", { scale: scale.living });
  if (count("utility")) add("utility", "Utility");
  for (let i = 0; i < count("office"); i++) add("office", i === 0 ? "Office" : "Office 2");
  if (count("garage")) add("garage", "Garage");

  let number = 1;
  if (count("master_bedroom")) {
    const ensuite = count("ensuite") > 0;
    add(ensuite ? "master_with_ensuite" : "master", "Master Bedroom", { scale: scale.bedrooms, ensuite });
  }
  for (let i = 0; i < count("double_bedroom"); i++) add("double", `Bedroom ${++number}`, { scale: scale.bedrooms });
  for (let i = 0; i < count("single_bedroom"); i++) add("single", `Bedroom ${++number}`, { scale: scale.bedrooms });
  for (let i = 0; i < count("family_bathroom"); i++) add(i === 0 ? "bathroom" : "extra_bathroom", i === 0 ? "Bathroom" : `Bathroom ${i + 1}`);
  for (let i = 0; i < count("wc"); i++) add("wc", i === 0 ? "WC" : "WC 2");
  return { spaces, preferences: prefs, notes };
}

/** A two-storey house's rooms, floor by floor. */
export interface StoreyPrograms {
  ground: Program;
  upper: Program;
  notes: string[];
}

const areaOf = (spaces: SpaceSpec[]) => spaces.reduce((sum, s) => sum + s.target, 0);

/**
 * The rooms of a two-storey house: the living spaces, utility, garage and a
 * WC downstairs (one is added if none was picked: a convenience, not a
 * regulation); bedrooms, ensuites, bathrooms and any other WCs upstairs. An
 * office goes up as a study when the ground floor would be much the bigger.
 */
export function storeyPrograms(brief: HouseBrief, relax: Relaxation = 0): StoreyPrograms {
  const all = programFromBrief(brief, relax);
  const notes = [...all.notes];
  const ground: SpaceSpec[] = [];
  const upper: SpaceSpec[] = [];
  for (const s of all.spaces) {
    if (s.zone === "day") ground.push(s);
    else if (s.type === "wc" && !ground.some((g) => g.type === "wc")) ground.push({ ...s, zone: "day" });
    else upper.push(s);
  }
  if (!ground.some((s) => s.type === "wc")) {
    const { type, target, minSlot } = ROOM_KINDS.wc;
    ground.push({ key: "s-wc", type, name: "WC", target, minWidth: minSlot, zone: "day", window: ROOM_RULES.wc.window, ensuite: false });
    notes.push("A WC is added downstairs, as two-storey houses usually have one.");
  }
  const office = ground.find((s) => s.type === "office");
  if (office && areaOf(ground) > areaOf(upper) * 1.25) {
    ground.splice(ground.indexOf(office), 1);
    upper.push({ ...office, name: office.name.replace("Office", "Study"), zone: "night" });
    notes.push("The study is upstairs, which keeps the two floors about the same size.");
  }
  return { ground: { ...all, spaces: ground, notes: [] }, upper: { ...all, spaces: upper, notes: [] }, notes };
}
