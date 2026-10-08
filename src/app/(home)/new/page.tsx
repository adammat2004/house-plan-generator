import type { Metadata } from "next";
import { Suspense } from "react";
import { NewProjectPage } from "@/home/components/NewProject";

export const metadata: Metadata = { title: "New project" };

export default function NewProjectRoute() {
  // The starting method comes from the query string, which is only known in the browser.
  return (
    <Suspense fallback={<div className="new-project" aria-busy="true" />}>
      <NewProjectPage />
    </Suspense>
  );
}
