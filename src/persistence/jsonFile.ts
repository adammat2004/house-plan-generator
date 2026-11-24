import { parseProjectJson, serializeProject, type ProjectDocument, type ProjectLoadResult } from "@/domain/project/schema";
import { recordBackup } from "./backupReminder";

export const PROJECT_FILE_EXTENSION = ".floorplan.json";

export function projectFileName(name: string, extension = PROJECT_FILE_EXTENSION): string {
  const base = name.trim().replace(/[^\w\- ]+/g, "").replace(/\s+/g, "-").toLowerCase() || "floor-plan";
  return `${base}${extension}`;
}

/** Triggers a browser download of a URL or blob. */
export function downloadUrl(url: string, fileName: string): void {
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
}

/** Downloads the native JSON project file: the brief and every plan. */
export function downloadProject(project: ProjectDocument): void {
  const blob = new Blob([serializeProject(project)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  downloadUrl(url, projectFileName(project.name));
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  recordBackup();
}

const MAX_FILE_BYTES = 20 * 1024 * 1024;

/**
 * Reads and fully validates a project file (or a single-plan file from
 * before projects existed) without touching the open project.
 */
export async function readProjectFile(file: File): Promise<ProjectLoadResult> {
  if (file.size > MAX_FILE_BYTES) {
    return { ok: false, issues: [{ code: "malformed-file", message: "The file is too large to be a floor-plan project.", entityIds: [] }] };
  }
  let text: string;
  try {
    text = await file.text();
  } catch {
    return { ok: false, issues: [{ code: "malformed-file", message: "The file couldn't be read.", entityIds: [] }] };
  }
  return parseProjectJson(text, new Date().toISOString());
}
