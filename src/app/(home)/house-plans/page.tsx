import type { Metadata } from "next";
import { CataloguePage } from "@/home/components/CataloguePage";

export const metadata: Metadata = { title: "House plans" };

export default function HousePlansRoute() {
  return <CataloguePage />;
}
