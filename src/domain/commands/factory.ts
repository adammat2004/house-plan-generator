import { DEFAULT_HOUSE } from "../plan/defaults";
import { CURRENT_SCHEMA_VERSION } from "../plan/schema";
import type { Id, PlanDocument } from "../plan/types";
import { applyCommand } from "./apply";
import { CommandFailure } from "./ops";

export interface NewPlanOptions {
  id: Id;
  name?: string;
  width?: number;
  depth?: number;
  externalThickness?: number;
  wallHeight?: number;
  idPrefix?: string;
}

/** Creates a valid document containing a single rectangular house. */
export function createPlanDocument(options: NewPlanOptions): PlanDocument {
  const shell: PlanDocument = {
    schemaVersion: CURRENT_SCHEMA_VERSION,
    id: options.id,
    name: options.name ?? "Untitled house",
    units: "m",
    levels: [
      {
        id: options.idPrefix ? `${options.idPrefix}-level` : "level-ground",
        name: "Ground floor",
        elevation: 0,
        defaultWallHeight: options.wallHeight ?? DEFAULT_HOUSE.wallHeight,
        vertices: {},
        walls: {},
        openings: {},
        rooms: {},
        envelope: { kind: "rectangle", wallIds: ["", "", "", ""] },
        rearWallId: null,
      },
    ],
  };
  const result = applyCommand(shell, {
    type: "createFootprint",
    width: options.width ?? DEFAULT_HOUSE.width,
    depth: options.depth ?? DEFAULT_HOUSE.depth,
    externalThickness: options.externalThickness ?? DEFAULT_HOUSE.externalThickness,
    wallHeight: options.wallHeight ?? DEFAULT_HOUSE.wallHeight,
    idPrefix: options.idPrefix,
  });
  if (!result.ok) throw new CommandFailure(result.issues);
  return result.document;
}
