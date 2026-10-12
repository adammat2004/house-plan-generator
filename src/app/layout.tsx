import type { Metadata, Viewport } from "next";
import { Inter, Newsreader } from "next/font/google";
import { BRAND } from "@/components/brand";
import "./tokens.css";
import "./globals.css";
import "./editor.css";

// Self-hosted at build time, so every visitor sees the same type (tokens.css reads these variables).
const inter = Inter({ subsets: ["latin"], variable: "--font-inter", display: "swap" });
const newsreader = Newsreader({ subsets: ["latin"], variable: "--font-newsreader", display: "swap", axes: ["opsz"] });

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
    <html lang="en-GB" className={`${inter.variable} ${newsreader.variable}`}>
      <body>{children}</body>
    </html>
  );
}
