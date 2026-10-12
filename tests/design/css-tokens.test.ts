import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * Screen CSS uses the design tokens (src/app/tokens.css), never raw colours,
 * font sizes, radii or shadows, so the look stays one system. tokens.css is
 * the only place those values are written.
 */
const SHEETS = ["globals.css", "editor.css", "(home)/home.css"];

const RULES: Array<{ name: string; pattern: RegExp; allowed?: (line: string) => boolean }> = [
  { name: "hex colour", pattern: /#[0-9a-fA-F]{3,8}\b/ },
  { name: "rgb() colour", pattern: /\brgba?\(/ },
  { name: "px font-size", pattern: /font-size:\s*[0-9.]+px/ },
  { name: "px border-radius", pattern: /border-radius:[^;]*\b[0-9.]+px/, allowed: (line) => /calc\(var\(--r-[a-z]+\)/.test(line) },
  // Elevation comes from --shadow-1..3. Selection rings (no offset, no blur) are borders drawn with a colour token.
  { name: "raw box-shadow", pattern: /box-shadow:[^;]*\b[0-9.]+px/, allowed: (line) => /box-shadow:\s*(inset\s+)?0 0 0 [0-9.]+px var\(--[a-z0-9-]+\)(,\s*var\(--shadow-[123]\))?;/.test(line) },
];

function violations(sheet: string): string[] {
  const css = readFileSync(new URL(`../../src/app/${sheet}`, import.meta.url), "utf8").replace(/\/\*[\s\S]*?\*\//g, (c) => c.replace(/[^\n]/g, " "));
  const out: string[] = [];
  css.split("\n").forEach((line, i) => {
    for (const rule of RULES) {
      if (rule.pattern.test(line) && !rule.allowed?.(line)) out.push(`${sheet}:${i + 1} ${rule.name}: ${line.trim()}`);
    }
  });
  return out;
}

describe("screen CSS uses the tokens", () => {
  for (const sheet of SHEETS) {
    it(`${sheet} has no raw colours, font sizes, radii or shadows`, () => {
      expect(violations(sheet)).toEqual([]);
    });
  }
});
