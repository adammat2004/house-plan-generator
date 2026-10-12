import type { Metadata } from "next";
import { Suspense } from "react";
import { StartEntry } from "./StartEntry";

export const metadata: Metadata = {
  title: "Opening your layout",
};

/** Where "Send to my computer" links land: opens the layout they carry, then the editor. */
export default function StartPage() {
  return (
    <Suspense
      fallback={
        <div className="boot-screen" role="status">
          Opening your layout…
        </div>
      }
    >
      <StartEntry />
    </Suspense>
  );
}
