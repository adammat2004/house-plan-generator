import type { HouseBrief } from "@/domain/brief/schema";
import { projectFromRooms } from "@/domain/project/fromRooms";
import { NEW_PROJECT_APPEARANCE } from "@/domain/project/schema";
import { newDocumentId, newIdPrefix } from "@/editor/state/ids";
import { browserLibrary } from "@/persistence/browserLibrary";

/** The name a project made from a description gets until someone renames it. */
export const DESCRIBED_NAME = "My house";

/**
 * Saves a rooms-first project holding the brief, with no layouts yet; the
 * editor opens in Explore and generates them with the planners (so progress
 * shows). Throws with a readable message if the rooms can't be laid out.
 */
export async function createProjectFromBrief(brief: HouseBrief): Promise<string> {
  const result = projectFromRooms(brief, { id: newDocumentId(), idPrefix: newIdPrefix(), now: new Date().toISOString(), count: 0, name: DESCRIBED_NAME });
  if (!result.ok) throw new Error(result.message);
  await browserLibrary().create({ appearance: NEW_PROJECT_APPEARANCE, ...result.project });
  return result.project.id;
}

export const generateHref = (id: string) => `/editor?project=${encodeURIComponent(id)}&start=generate`;
