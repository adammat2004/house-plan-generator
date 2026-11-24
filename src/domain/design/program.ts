import { picksFromCounts, type RoomPick, type RoomPicks } from "../brief/rooms";
import { ROOM_SIZE_FACTOR, roomSizeOf, type HouseBrief, type PreferenceId, type SizedRoom } from "../brief/schema";
import type { FloorMaterial, RoomType } from "../plan/types";
import { ENSUITE_TARGET, OPEN_PLAN_MIN_SLOT, OPEN_PLAN_SHARE, ROOM_KINDS, ROOM_RULES, type RoomKind, type WindowSize } from "./roomRules";

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

/**
 * The name the nth room of a pick (counting from 1) gets in a generated plan.
 * The one source of room names: placement hints find their room by it.
 * Bedrooms count on from 2 (the master is the first, picked or not), singles after the doubles.
 */
export function pickRoomName(pick: RoomPick, n: number, picks: RoomPicks): string {
  switch (pick) {
    case "open_plan":
      return "Kitchen / Living / Dining";
    case "kitchen_dining":
      return "Kitchen / Dining";
    case "kitchen":
      return "Kitchen";
    case "dining_room":
      return "Dining Room";
    case "living_room":
      return n === 1 ? "Living Room" : "Snug";
    case "utility":
      return "Utility";
    case "office":
      return n === 1 ? "Office" : "Office 2";
    case "garage":
      return "Garage";
    case "master_bedroom":
      return "Master Bedroom";
    case "ensuite":
      return "Ensuite";
    case "double_bedroom":
      return `Bedroom ${n + 1}`;
    case "single_bedroom":
      return `Bedroom ${n + 1 + (picks.double_bedroom ?? 0)}`;
    case "family_bathroom":
      return n === 1 ? "Bathroom" : `Bathroom ${n}`;
    case "wc":
      return n === 1 ? "WC" : "WC 2";
  }
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
    push("kitchen_dining", pickRoomName("open_plan", 1, picks), Math.round(parts * OPEN_PLAN_SHARE), OPEN_PLAN_MIN_SLOT);
  }
  const name = (pick: RoomPick, n = 1) => pickRoomName(pick, n, picks);
  if (kitchenDining) add("kitchen_dining", name("kitchen_dining"), { scale: scale.kitchen });
  if (kitchen) add("kitchen", name("kitchen"), { scale: scale.kitchen });
  if (dining) add("dining", name("dining_room"));
  for (let i = 0; i < livingRooms; i++) add(i === 0 ? "living" : "snug", name("living_room", i + 1), { scale: scale.living });
  if (count("utility")) add("utility", name("utility"));
  for (let i = 0; i < count("office"); i++) add("office", name("office", i + 1));
  if (count("garage")) add("garage", name("garage"));

  if (count("master_bedroom")) {
    const ensuite = count("ensuite") > 0;
    add(ensuite ? "master_with_ensuite" : "master", name("master_bedroom"), { scale: scale.bedrooms, ensuite });
  }
  for (let i = 0; i < count("double_bedroom"); i++) add("double", name("double_bedroom", i + 1), { scale: scale.bedrooms });
  for (let i = 0; i < count("single_bedroom"); i++) add("single", name("single_bedroom", i + 1), { scale: scale.bedrooms });
  for (let i = 0; i < count("family_bathroom"); i++) add(i === 0 ? "bathroom" : "extra_bathroom", name("family_bathroom", i + 1));
  for (let i = 0; i < count("wc"); i++) add("wc", name("wc", i + 1));
  if (brief.targetArea) {
    const fit = fitToTarget(spaces, brief.targetArea);
    for (const s of spaces) s.target = Math.round(s.target * fit.scale * 10) / 10;
    notes.push(fit.message);
  }
  return { spaces, preferences: prefs, notes };
}

/** Walls, circulation and the odd awkward corner on top of the rooms' clear areas; matches the footprint's allowance. */
const GROSS_ALLOWANCE = 1.12;
/** How far rooms may be scaled to approach a target area before they stop being sensible rooms. */
const TARGET_SCALE = { min: 0.85, max: 1.8 } as const;

const grossOf = (spaces: SpaceSpec[]) => spaces.reduce((sum, s) => sum + s.target + (s.ensuite ? ENSUITE_TARGET : 0), 0) * GROSS_ALLOWANCE;
const roundTo5 = (v: number) => Math.round(v / 5) * 5;

export interface TargetAreaFit {
  /** The factor applied to every room's target area. */
  scale: number;
  /** Whether the house can reach the target. */
  met: boolean;
  /** About how large a house these rooms make, at the smallest and largest sensible room sizes, m². */
  range: { min: number; max: number };
  /** What to tell the user, plainly. */
  message: string;
}

function fitToTarget(spaces: SpaceSpec[], target: number): TargetAreaFit {
  const base = grossOf(spaces);
  const range = { min: roundTo5(base * TARGET_SCALE.min), max: roundTo5(base * TARGET_SCALE.max) };
  const wanted = target / base;
  const scale = Math.min(TARGET_SCALE.max, Math.max(TARGET_SCALE.min, wanted));
  const met = Math.abs(wanted / scale - 1) < 0.03;
  const message = met
    ? `Rooms are sized to make a house of about ${Math.round(target)} m².`
    : `These rooms make a house of about ${range.min} to ${range.max} m², so ${Math.round(target)} m² can't be reached. Layouts are sized to about ${roundTo5(base * scale)} m²; add or remove rooms to get closer.`;
  return { scale, met, range, message };
}

/** Whether the brief's target area can be met by its rooms, and what to say if not. Null when the brief has no target. */
export function targetAreaFit(brief: HouseBrief): TargetAreaFit | null {
  if (!brief.targetArea) return null;
  const { targetArea, ...rest } = brief;
  const plain = programFromBrief(rest);
  return fitToTarget(plain.spaces, targetArea);
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
 * office goes up as a study when the ground floor would be much the bigger,
 * unless the house has single-storey wings to put it in.
 */
export function storeyPrograms(brief: HouseBrief, relax: Relaxation = 0, opts: { wings?: boolean } = {}): StoreyPrograms {
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
  if (office && !opts.wings && areaOf(ground) > areaOf(upper) * 1.25) {
    ground.splice(ground.indexOf(office), 1);
    upper.push({ ...office, name: office.name.replace("Office", "Study"), zone: "night" });
    notes.push("The study is upstairs, which keeps the two floors about the same size.");
  }
  return { ground: { ...all, spaces: ground, notes: [] }, upper: { ...all, spaces: upper, notes: [] }, notes };
}
