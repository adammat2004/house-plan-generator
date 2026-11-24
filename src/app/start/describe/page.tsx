import type { Metadata } from "next";
import { DescribeHome } from "./DescribeHome";

export const metadata: Metadata = { title: "Describe your dream home" };

/** The prompt-first way in: describe the home, check the brief, get layouts. */
export default function DescribePage() {
  return <DescribeHome />;
}
