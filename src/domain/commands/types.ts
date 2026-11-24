import type { Circulation, Door, ExternalWallPreference, FloorMaterial, Furniture, Id, Opening, PlanDocument, Point2, RoomType, Staircase, Window } from "../plan/types";

export type IssueCode =
  | "not-found"
  | "invalid-value"
  | "invalid-structure"
  | "unsupported-version"
  | "malformed-file"
  | "zero-length-wall"
  | "non-orthogonal-wall"
  | "wall-overlap"
  | "wall-clash"
  | "duplicate-vertex"
  | "outside-envelope"
  | "envelope-invalid"
  | "envelope-locked"
  | "move-disconnects"
  | "move-collapses-wall"
  | "move-blocked"
  | "shrink-conflict"
  | "opening-out-of-bounds"
  | "opening-crosses-junction"
  | "opening-overlap"
  | "opening-too-tall"
  | "room-unmatched"
  | "room-duplicate"
  | "rear-wall-invalid"
  | "room-pinned"
  | "read-only"
  | "level-limit"
  | "level-overhang"
  | "level-stack"
  | "stairs-blocked"
  | "stairs-invalid";

/** A structured validation or command failure. */
export interface PlanIssue {
  code: IssueCode;
  message: string;
  entityIds: Id[];
}

export type CommandResult =
  | { ok: true; document: PlanDocument; createdIds: Id[]; changed: boolean }
  | { ok: false; issues: PlanIssue[] };

type OpeningCommon = Pick<Opening, "offset" | "width" | "height">;

export type OpeningChanges = Partial<OpeningCommon> &
  Partial<Pick<Door, "hinge" | "swingSide">> &
  Partial<Pick<Window, "sillHeight">> & { wallId?: Id };

/** Room metadata edits. `null` clears an optional program field. */
export interface RoomChanges {
  name?: string;
  type?: RoomType;
  targetArea?: number | null;
  minArea?: number | null;
  maxArea?: number | null;
  floorMaterial?: FloorMaterial | null;
  externalWall?: ExternalWallPreference | null;
  /** Pins the room; `false` or `null` unpins it. */
  locked?: boolean | null;
  /** What a hall is for; `null` clears it. */
  circulation?: Circulation | null;
}

export type FurnitureChanges = Partial<Pick<Furniture, "position" | "rotation" | "width" | "depth" | "height">>;

/** Stairs edits. `turn: null` goes back to the default (right). */
export type StairChanges = Partial<Pick<Staircase, "foot" | "rotation" | "shape" | "width" | "going" | "fromLevelId" | "toLevelId">> & {
  turn?: Staircase["turn"] | null;
};

/**
 * Optional `idPrefix` lets the caller supply entropy for any IDs a command
 * creates (vertices, rooms after a split). IDs are generated outside the
 * transformation; without a prefix a deterministic, collision-free scheme
 * based on the document's existing IDs is used.
 *
 * `levelId` names the floor a command acts on. Without it, a command acts on
 * the floor holding the wall, opening, room or piece it names, and otherwise
 * on the ground floor.
 */
interface CommandBase {
  idPrefix?: string;
  levelId?: Id;
}

export type PlanCommand = CommandBase &
  (
    | {
        type: "createFootprint";
        width: number;
        depth: number;
        externalThickness: number;
        wallHeight: number;
        name?: string;
      }
    | {
        type: "createOutline";
        /** Outside-face corners of a right-angle outline, in either direction, from any corner. */
        outline: Point2[];
        externalThickness: number;
        wallHeight: number;
        name?: string;
      }
    | { type: "resizeFootprint"; width?: number; depth?: number }
    | {
        type: "moveOutlineEdge";
        wallId: Id;
        /** How far to push the stretch out of the house (negative pulls it in), m. */
        outward: number;
        /** The stretch, measured along the wall from its start like opening offsets; the whole wall by default. */
        from?: number;
        to?: number;
      }
    | { type: "addWall"; wallId?: Id; start: Point2; end: Point2; thickness: number; height?: number }
    | {
        type: "moveWall";
        wallId: Id;
        /** Perpendicular displacement: Δy for horizontal walls, Δx for vertical walls. */
        delta: number;
      }
    | {
        type: "moveWallEndpoint";
        wallId: Id;
        end: "start" | "end";
        /** New varying coordinate of that end: x for horizontal walls, y for vertical walls. */
        position: number;
      }
    | { type: "updateWall"; wallId: Id; thickness?: number; height?: number }
    | { type: "deleteWall"; wallId: Id }
    | { type: "addOpening"; opening: Opening }
    | { type: "updateOpening"; openingId: Id; changes: OpeningChanges }
    | { type: "deleteOpening"; openingId: Id }
    | { type: "updateRoom"; roomId: Id; changes: RoomChanges }
    | { type: "addFurniture"; item: Furniture }
    | { type: "updateFurniture"; furnitureId: Id; changes: FurnitureChanges }
    | { type: "deleteFurniture"; furnitureId: Id }
    | { type: "replaceFurniture"; remove: Id[]; add: Furniture[] }
    | { type: "setRearWall"; wallId: Id | null }
    | {
        /** A new top floor whose outline copies the floor below's, with nothing inside yet. */
        type: "addLevel";
        name?: string;
        /** Ceiling height; the floor below's by default. */
        wallHeight?: number;
        floorThickness?: number;
      }
    | { type: "removeLevel"; levelId: Id }
    | { type: "addStairs"; staircase: Staircase }
    | { type: "updateStairs"; staircaseId: Id; changes: StairChanges }
    | { type: "deleteStairs"; staircaseId: Id }
    | {
        /** Renames the floor, or sets its ceiling height (every wall on it) or the depth of the floor it stands on. */
        type: "updateLevel";
        name?: string;
        wallHeight?: number;
        floorThickness?: number;
      }
    | { type: "renameDocument"; name: string }
    | { type: "replaceDocument"; document: unknown }
  );

export type PlanCommandType = PlanCommand["type"];
