import type { Metadata, Viewport } from "next";
import { DM_Serif_Display, DM_Serif_Text, Inter } from "next/font/google";
import { BRAND } from "@/components/brand";
import "./tokens.css";
import "./globals.css";
import "./editor.css";

// Self-hosted at build time, so every visitor sees the same type (tokens.css reads these variables).
const inter = Inter({ subsets: ["latin"], variable: "--font-inter", display: "swap" });
const serifDisplay = DM_Serif_Display({ subsets: ["latin"], weight: "400", variable: "--font-dm-serif-display", display: "swap" });
// The same family drawn for small sizes: plan labels and card titles.
const serifText = DM_Serif_Text({ subsets: ["latin"], weight: "400", variable: "--font-dm-serif-text", display: "swap" });

export const metadata: Metadata = {
  title: { default: BRAND.name, template: `%s · ${BRAND.name}` },
  description: "Choose your rooms and get floor plans in seconds, then move walls, furnish and walk round your home in 3D.",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#f8f7f3",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en-GB" className={`${inter.variable} ${serifDisplay.variable} ${serifText.variable}`}>
      <body>{children}</body>
    </html>
  );
}
