import type { BriefSpace } from "./schema";

/**
 * Rooms picked one by one ("2 double bedrooms, an ensuite, a WC…"), the
 * finer-grained way to say what a house needs. The brief's counts and spaces
 * are kept in step with the picks, so planners, assessments and the AI reader
 * work the same either way.
 */

export const ROOM_PICKS = [
  "master_bedroom",
  "double_bedroom",
  "single_bedroom",
  "ensuite",
  "family_bathroom",
  "wc",
  "open_plan",
  "kitchen",
  "kitchen_dining",
  "living_room",
  "dining_room",
  "office",
  "utility",
  "garage",
] as const;

export type RoomPick = (typeof ROOM_PICKS)[number];
export type RoomPicks = Partial<Record<RoomPick, number>>;

export type RoomPickGroup = "bedrooms" | "bathrooms" | "living" | "other";

export interface RoomPickSpec {
  id: RoomPick;
  label: string;
  hint: string;
  group: RoomPickGroup;
  max: number;
}

export const ROOM_PICK_GROUP_LABEL: Record<RoomPickGroup, string> = {
  bedrooms: "Bedrooms",
  bathrooms: "Bathrooms",
  living: "Living spaces",
  other: "Other spaces",
};

export const ROOM_PICK_SPECS: Record<RoomPick, RoomPickSpec> = {
  master_bedroom: { id: "master_bedroom", label: "Master bedroom", hint: "With ensuite (optional)", group: "bedrooms", max: 1 },
  double_bedroom: { id: "double_bedroom", label: "Double bedroom", hint: "Standard size", group: "bedrooms", max: 7 },
  single_bedroom: { id: "single_bedroom", label: "Single bedroom", hint: "Ideal for guests or office", group: "bedrooms", max: 7 },
  ensuite: { id: "ensuite", label: "Ensuite", hint: "Attached to the master bedroom", group: "bathrooms", max: 1 },
  family_bathroom: { id: "family_bathroom", label: "Family bathroom", hint: "Full bathroom", group: "bathrooms", max: 4 },
  wc: { id: "wc", label: "WC", hint: "Small toilet room", group: "bathrooms", max: 2 },
  open_plan: { id: "open_plan", label: "Open plan kitchen / dining / living", hint: "Large combined space", group: "living", max: 1 },
  kitchen: { id: "kitchen", label: "Kitchen", hint: "A separate kitchen", group: "living", max: 1 },
  kitchen_dining: { id: "kitchen_dining", label: "Kitchen / dining", hint: "Kitchen with a dining table", group: "living", max: 1 },
  living_room: { id: "living_room", label: "Separate living room", hint: "Cosy lounge space", group: "living", max: 2 },
  dining_room: { id: "dining_room", label: "Dining room", hint: "Formal dining", group: "living", max: 1 },
  office: { id: "office", label: "Home office", hint: "A quiet place to work", group: "other", max: 2 },
  utility: { id: "utility", label: "Utility room", hint: "Laundry and storage", group: "other", max: 1 },
  garage: { id: "garage", label: "Garage", hint: "Single garage", group: "other", max: 1 },
};

export const ROOM_PICK_GROUPS: ReadonlyArray<{ group: RoomPickGroup; picks: RoomPick[] }> = (["bedrooms", "bathrooms", "living", "other"] as const).map((group) => ({
  group,
  picks: ROOM_PICKS.filter((p) => ROOM_PICK_SPECS[p].group === group),
}));

const n = (picks: RoomPicks, id: RoomPick) => picks[id] ?? 0;

export const pickedBedrooms = (p: RoomPicks) => n(p, "master_bedroom") + n(p, "double_bedroom") + n(p, "single_bedroom");
export const pickedBathrooms = (p: RoomPicks) => Math.min(n(p, "ensuite"), n(p, "master_bedroom")) + n(p, "family_bathroom") + n(p, "wc");

/** The brief's spaces that a set of picks provides. */
export function pickedSpaces(p: RoomPicks): BriefSpace[] {
  const open = n(p, "open_plan") > 0;
  const spaces = new Set<BriefSpace>();
  if (open || n(p, "kitchen") || n(p, "kitchen_dining")) spaces.add("kitchen");
  if (open || n(p, "living_room")) spaces.add("living");
  if (open || n(p, "kitchen_dining") || n(p, "dining_room")) spaces.add("dining");
  if (n(p, "office")) spaces.add("office");
  if (n(p, "utility")) spaces.add("utility");
  if (n(p, "garage")) spaces.add("garage");
  return [...spaces];
}

/** Clamps counts to each pick's range and drops zeros; an ensuite needs a master bedroom. */
export function cleanPicks(p: RoomPicks): RoomPicks {
  const out: RoomPicks = {};
  for (const id of ROOM_PICKS) {
    const v = Math.max(0, Math.min(ROOM_PICK_SPECS[id].max, Math.round(p[id] ?? 0)));
    if (v) out[id] = v;
  }
  if (out.ensuite && !out.master_bedroom) delete out.ensuite;
  return out;
}

/**
 * Brings picks in line with counts and spaces changed some other way (the AI
 * reader, or an older brief): bedrooms and bathrooms are added or removed as
 * doubles and family bathrooms first, and spaces as their own rooms.
 */
export function reconcilePicks(p: RoomPicks, target: { bedrooms: number; bathrooms: number; spaces: readonly BriefSpace[] }): RoomPicks {
  const picks = { ...cleanPicks(p) };
  const adjust = (order: RoomPick[], delta: number) => {
    for (const id of order) {
      while (delta > 0 && (picks[id] ?? 0) < ROOM_PICK_SPECS[id].max) {
        picks[id] = (picks[id] ?? 0) + 1;
        delta--;
      }
      while (delta < 0 && (picks[id] ?? 0) > 0) {
        picks[id] = (picks[id] ?? 0) - 1;
        delta++;
      }
    }
  };
  const bedDelta = target.bedrooms - pickedBedrooms(picks);
  adjust(bedDelta > 0 ? ["master_bedroom", "double_bedroom", "single_bedroom"] : ["single_bedroom", "double_bedroom", "master_bedroom"], bedDelta);
  const bathDelta = target.bathrooms - pickedBathrooms(cleanPicks(picks));
  adjust(bathDelta > 0 ? ["family_bathroom", "wc"] : ["wc", "family_bathroom", "ensuite"], bathDelta);

  const have = new Set(pickedSpaces(picks));
  const want = new Set(target.spaces);
  const add = (id: RoomPick) => (picks[id] = Math.max(picks[id] ?? 0, 1));
  for (const space of want) {
    if (have.has(space)) continue;
    if (space === "kitchen") add(picks.dining_room ? "kitchen" : "kitchen_dining");
    else if (space === "living") add("living_room");
    else if (space === "dining") add(picks.kitchen ? "dining_room" : "kitchen_dining");
    else add(space);
  }
  for (const space of have) {
    if (want.has(space)) continue;
    // Removing a space the open plan provides splits the open plan into what's still wanted.
    if (picks.open_plan && (space === "kitchen" || space === "living" || space === "dining")) {
      delete picks.open_plan;
      if (want.has("kitchen")) add(want.has("dining") ? "kitchen_dining" : "kitchen");
      else if (want.has("dining")) add("dining_room");
      if (want.has("living")) add("living_room");
      continue;
    }
    if (space === "kitchen") {
      delete picks.kitchen;
      if (picks.kitchen_dining) {
        delete picks.kitchen_dining;
        if (want.has("dining")) add("dining_room");
      }
    } else if (space === "living") delete picks.living_room;
    else if (space === "dining") {
      delete picks.dining_room;
      if (picks.kitchen_dining) {
        delete picks.kitchen_dining;
        add("kitchen");
      }
    } else delete picks[space];
  }
  return cleanPicks(picks);
}

/** Picks matching an older brief that only had counts and spaces. */
export function picksFromCounts(bedrooms: number, bathrooms: number, spaces: readonly BriefSpace[], openPlan: boolean): RoomPicks {
  const picks: RoomPicks = {};
  if (bedrooms > 0) picks.master_bedroom = 1;
  if (bedrooms > 1) picks.double_bedroom = Math.min(bedrooms - 1, 7);
  if (bedrooms >= 1 && bathrooms >= 2) picks.ensuite = 1;
  const rest = bathrooms - (picks.ensuite ?? 0);
  if (rest >= 3) picks.wc = 1;
  if (rest > 0) picks.family_bathroom = rest - (picks.wc ?? 0);
  const has = (s: BriefSpace) => spaces.includes(s);
  if (openPlan && has("kitchen") && has("living")) picks.open_plan = 1;
  else {
    if (has("kitchen") && has("dining")) picks.kitchen_dining = 1;
    else if (has("kitchen")) picks.kitchen = 1;
    else if (has("dining")) picks.dining_room = 1;
    if (has("living")) picks.living_room = 1;
  }
  for (const s of ["office", "utility", "garage"] as const) if (has(s)) picks[s] = 1;
  return cleanPicks(picks);
}

export interface BriefPreset {
  id: string;
  label: string;
  description: string;
  picks: RoomPicks;
}

/** Common starting points for the Presets tab. */
export const BRIEF_PRESETS: readonly BriefPreset[] = [
  { id: "starter", label: "Starter home", description: "2 bedrooms, open plan living", picks: { master_bedroom: 1, double_bedroom: 1, family_bathroom: 1, open_plan: 1 } },
  { id: "family-3", label: "Family home", description: "3 bedrooms, ensuite, separate living room", picks: { master_bedroom: 1, double_bedroom: 2, ensuite: 1, family_bathroom: 1, kitchen_dining: 1, living_room: 1, utility: 1 } },
  { id: "family-4", label: "Large family home", description: "4 bedrooms, office, open plan and a snug", picks: { master_bedroom: 1, double_bedroom: 2, single_bedroom: 1, ensuite: 1, family_bathroom: 1, wc: 1, open_plan: 1, living_room: 1, office: 1, utility: 1 } },
  { id: "bungalow", label: "Bungalow", description: "3 bedrooms on one level, separate rooms", picks: { master_bedroom: 1, double_bedroom: 1, single_bedroom: 1, ensuite: 1, family_bathroom: 1, kitchen: 1, dining_room: 1, living_room: 1 } },
  { id: "work-from-home", label: "Work from home", description: "2 bedrooms and two offices", picks: { master_bedroom: 1, double_bedroom: 1, ensuite: 1, family_bathroom: 1, open_plan: 1, office: 2 } },
  { id: "annexe", label: "Annexe", description: "1 bedroom with a compact living space", picks: { master_bedroom: 1, ensuite: 1, open_plan: 1 } },
];
