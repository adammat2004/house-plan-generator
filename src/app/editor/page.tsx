import type { Metadata } from "next";
import { Suspense } from "react";
import { EditorEntry } from "./EditorEntry";

export const metadata: Metadata = {
  title: "Floor plan editor",
};

export default function EditorPage() {
  return (
    <Suspense
      fallback={
        <div className="boot-screen" role="status">
          Loading floor plan editor…
        </div>
      }
    >
      <EditorEntry />
    </Suspense>
  );
}
