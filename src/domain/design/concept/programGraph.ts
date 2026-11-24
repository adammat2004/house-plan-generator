import type { RoomType } from "../../plan/types";

/**
 * The program's relationships as one graph (roadmap M2): what each kind of
 * room may open off and what that costs, and what each placement the brief
 * cares about is worth. The zone planner's day row, the bands of rooms that
 * two-storey and wing plans are built from, and the master's quiet side all
 * read their costs here, so a brief preference changes every planner the
 * same way. Costs are Infinity where a door shouldn't be.
 */

export interface GraphPrefs {
  /** `kitchen_faces_garden`: the kitchen at the garden end. */
  kitchenGarden?: boolean;
  /** `primary_bedroom_private`: the master on the quiet garden side, never by the front door. */
  primaryPrivate?: boolean;
  /** `utility_near_kitchen`: the utility reached through the kitchen. */
  utilityNearKitchen?: boolean;
}

/** A room as the graph sees it: its kind, and its key (an ensuite's names its bedroom's). */
export interface GraphRoom {
  key: string;
  type: RoomType;
}

export interface ProgramGraph {
  /** Downstairs: what it costs `child` to open off `parent` (the hall, or a room beside it); `rootTaken` once a living space opens off the hall. */
  down(parent: RoomType | "hall", child: RoomType, rootTaken?: boolean): number;
  /** Upstairs: everything off the landing, an ensuite off its own bedroom only. */
  up(parent: GraphRoom | "hall", child: GraphRoom): number;
  /** What it costs a plan when the master isn't on the quiet garden side. */
  quiet: number;
  /** ... when the room at the garden end of the living spaces isn't one to sit or eat in. */
  livingAway: number;
  /** ... when the kitchen isn't at the garden end (only if the brief asks). */
  kitchenAway: number;
  /** ... when a garage isn't at the street end. */
  garageBack: number;
}

export const LIVING: ReadonlySet<RoomType> = new Set(["living", "kitchen", "kitchen_dining", "dining"]);
const KITCHENS: ReadonlySet<RoomType> = new Set(["kitchen", "kitchen_dining"]);

/** What the utility costs reached other than through the kitchen, when the brief wants it by the kitchen. */
const UTILITY_AWAY = 2;

const graphs = new Map<string, ProgramGraph>();

export function programGraph(prefs: GraphPrefs = {}): ProgramGraph {
  const key = `${prefs.kitchenGarden ? 1 : 0}${prefs.primaryPrivate ? 1 : 0}${prefs.utilityNearKitchen ? 1 : 0}`;
  const hit = graphs.get(key);
  if (hit) return hit;
  const utilityAway = prefs.utilityNearKitchen ? UTILITY_AWAY : 0;
  const graph: ProgramGraph = {
    down(parent, child, rootTaken = false) {
      if (parent === "hall") {
        // One living space off the hall leads on to the rest; a second off the hall makes the hall a corridor.
        if (LIVING.has(child)) return rootTaken ? 2 : 0;
        return child === "office" || child === "wc" || child === "storage" ? 0.3 : child === "garage" ? 0.5 : child === "utility" ? 1 + utilityAway : 1.5;
      }
      if (parent === "utility") return child === "garage" ? 0.5 : Infinity;
      if (!LIVING.has(parent)) return Infinity;
      if (LIVING.has(child)) return 0;
      if (child === "utility") return KITCHENS.has(parent) ? 0 : 2 + utilityAway;
      if (child === "office") return 1;
      if (child === "wc") return 1.5;
      return Infinity;
    },
    up(parent, child) {
      if (parent === "hall") return child.type === "ensuite" ? Infinity : 0;
      return child.type === "ensuite" && child.key === `${parent.key}-ensuite` ? 0 : Infinity;
    },
    quiet: prefs.primaryPrivate ? 2 : 0.5,
    livingAway: 4,
    kitchenAway: prefs.kitchenGarden ? 3 : 0,
    garageBack: 1.5,
  };
  graphs.set(key, graph);
  return graph;
}
