import { ROOM_SIZE_FACTOR, roomSizeOf, type HouseBrief, type PreferenceId, type SizedRoom } from "../brief/schema";
import type { RoomType } from "../plan/types";

/**
 * The space program: which rooms a brief asks for, with target areas and
 * minimum widths. Planners lay programs out; they never read the brief's
 * free text.
 */

export type WindowSize = "large" | "standard" | "small" | "none";

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

export function programFromBrief(brief: HouseBrief, relax: Relaxation = 0): Program {
  const prefs = new Set(brief.preferences);
  const wants = new Set<string>(brief.requiredSpaces);
  if (prefs.has("home_office")) wants.add("office");
  const notes: string[] = [];
  const spaces: SpaceSpec[] = [];
  const add = (s: Omit<SpaceSpec, "key" | "ensuite"> & { ensuite?: boolean }) =>
    spaces.push({ key: `s${spaces.length + 1}`, ensuite: false, ...s });

  const size = (group: SizedRoom) => ROOM_SIZE_FACTOR[roomSizeOf(brief, group)];
  const kitchenScale = (prefs.has("large_kitchen") ? 1.3 : 1) * size("kitchen");
  const living = 18 * size("living");
  const bedroom = size("bedrooms");
  const [k, l, d] = [wants.has("kitchen"), wants.has("living"), wants.has("dining")];
  const askedOpen = prefs.has("open_plan") && !prefs.has("separate_living_room");
  const mergeLiving = l && (k || d) && (askedOpen || relax >= 2);
  const mergeKD = k && d && (prefs.has("open_plan") || mergeLiving || relax >= 1);
  if (mergeLiving && !askedOpen) notes.push("Living, kitchen and dining share one open-plan space so the brief fits this footprint.");
  else if (mergeKD && !prefs.has("open_plan")) notes.push("Kitchen and dining are combined so the brief fits this footprint.");

  if (mergeLiving) {
    const name = k && d ? "Kitchen / Living / Dining" : k ? "Kitchen / Living" : "Living / Dining";
    const target = (l ? living : 0) + (k ? 11 * kitchenScale : 0) + (d ? 10 : 0);
    add({ type: k ? "kitchen_dining" : "living", name, target: Math.round(target * 0.9), minWidth: 3.6, zone: "day", window: "large" });
  } else {
    if (l) add({ type: "living", name: "Living Room", target: Math.round(living), minWidth: 3, zone: "day", window: "large" });
    if (mergeKD) add({ type: "kitchen_dining", name: "Kitchen / Dining", target: Math.round(18 * kitchenScale), minWidth: 2.8, zone: "day", window: "large" });
    else {
      if (k) add({ type: "kitchen", name: "Kitchen", target: Math.round(11 * kitchenScale), minWidth: 2.4, zone: "day", window: "standard" });
      if (d) add({ type: "dining", name: "Dining Room", target: 10, minWidth: 2.4, zone: "day", window: "standard" });
    }
  }
  if (wants.has("utility")) add({ type: "utility", name: "Utility", target: 4.5, minWidth: 1.8, zone: "day", window: "small" });
  if (wants.has("office")) add({ type: "office", name: "Office", target: 8, minWidth: 2.4, zone: "day", window: "standard" });
  if (wants.has("garage")) add({ type: "garage", name: "Garage", target: 18, minWidth: 3, zone: "day", window: "none" });

  const ensuite = brief.bedrooms >= 1 && brief.bathrooms >= 2;
  for (let i = 0; i < brief.bedrooms; i++) {
    if (i === 0) {
      add({ type: "primary_bedroom", name: "Primary Bedroom", target: Math.round(14 * bedroom), minWidth: ensuite ? 3.3 : 2.9, zone: "night", window: "standard", ensuite });
    } else {
      add({ type: "bedroom", name: `Bedroom ${i + 1}`, target: Math.round((i >= 3 ? 10 : 11) * bedroom), minWidth: 2.5, zone: "night", window: "standard" });
    }
  }
  const baths = brief.bathrooms - (ensuite ? 1 : 0);
  for (let i = 0; i < baths; i++) {
    if (i === 1) add({ type: "wc", name: "WC", target: 2, minWidth: 1.2, zone: "night", window: "small" });
    else add({ type: "bathroom", name: i === 0 ? "Bathroom" : `Bathroom ${i}`, target: i === 0 ? 5 : 4.5, minWidth: 1.7, zone: "night", window: "small" });
  }
  return { spaces, preferences: prefs, notes };
}
