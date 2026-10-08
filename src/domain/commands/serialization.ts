import { migrateToCurrent } from "../plan/migrations";
import { planDocumentSchema } from "../plan/schema";
import type { PlanDocument } from "../plan/types";
import type { PlanIssue } from "./types";
import { validateDocument } from "./validate";

export type LoadResult = { ok: true; document: PlanDocument } | { ok: false; issues: PlanIssue[] };

/** Serialises a document to the native JSON project format. */
export function serializePlanDocument(document: PlanDocument): string {
  return `${JSON.stringify(document, null, 2)}\n`;
}

/**
 * Migrates, structurally parses and geometrically validates an unknown value.
 * Nothing is repaired: invalid input is reported, never partially accepted.
 */
export function loadPlanDocument(raw: unknown): LoadResult {
  const migrated = migrateToCurrent(raw);
  if (!migrated.ok) return { ok: false, issues: [{ code: migrated.code, message: migrated.message, entityIds: [] }] };
  const parsed = planDocumentSchema.safeParse(migrated.value);
  if (!parsed.success) {
    const issues: PlanIssue[] = parsed.error.issues.slice(0, 5).map((issue) => ({
      code: "malformed-file",
      message: `Invalid ${issue.path.length ? issue.path.join(".") : "document"}: ${issue.message}`,
      entityIds: [],
    }));
    return { ok: false, issues };
  }
  const issues = validateDocument(parsed.data);
  if (issues.length) return { ok: false, issues };
  return { ok: true, document: parsed.data };
}

export function parsePlanDocumentJson(text: string): LoadResult {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return { ok: false, issues: [{ code: "malformed-file", message: "The file is not valid JSON.", entityIds: [] }] };
  }
  return loadPlanDocument(raw);
}
