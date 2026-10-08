import { createProjectLibrary, type ProjectLibrary } from "./planStorage";

let library: ProjectLibrary | null = null;

/** The project library in this browser's IndexedDB, shared by the home screen and the editor. */
export function browserLibrary(): ProjectLibrary {
  library ??= createProjectLibrary();
  return library;
}
