import type { Metadata } from "next";
import { SettingsPage } from "@/home/components/pages";

export const metadata: Metadata = { title: "Settings" };

export default function SettingsRoute() {
  return <SettingsPage />;
}
