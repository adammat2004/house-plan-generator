import type { Metadata } from "next";
import { TemplatesPage } from "@/home/components/pages";

export const metadata: Metadata = { title: "Templates" };

export default function TemplatesRoute() {
  return <TemplatesPage />;
}
