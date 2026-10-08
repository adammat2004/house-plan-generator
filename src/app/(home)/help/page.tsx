import type { Metadata } from "next";
import { HelpPage } from "@/home/components/pages";

export const metadata: Metadata = { title: "Help" };

export default function HelpRoute() {
  return <HelpPage />;
}
