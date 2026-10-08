"use client";

import dynamic from "next/dynamic";
import { useSearchParams } from "next/navigation";

/** The editor is browser-only: it relies on canvas, pointer input and IndexedDB. */
const EditorApp = dynamic(() => import("@/editor/components/EditorApp"), {
  ssr: false,
  loading: () => (
    <div className="boot-screen" role="status">
      Loading floor plan editor…
    </div>
  ),
});

export function EditorEntry() {
  const params = useSearchParams();
  const projectId = params.get("project");
  // Keyed so switching projects remounts the editor with fresh state.
  return <EditorApp key={projectId ?? ""} projectId={projectId} start={params.get("start")} />;
}
