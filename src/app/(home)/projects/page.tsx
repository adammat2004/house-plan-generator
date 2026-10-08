import type { Metadata } from "next";
import { AllProjectsPage } from "@/home/components/pages";

export const metadata: Metadata = { title: "Projects" };

export default function ProjectsPage() {
  return <AllProjectsPage />;
}
