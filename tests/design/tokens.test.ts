import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { COLOR } from "@/design/tokens";

/** Hex colours declared in tokens.css, by token name. */
function cssColours(): Map<string, string> {
  const css = readFileSync(new URL("../../src/app/tokens.css", import.meta.url), "utf8");
  const out = new Map<string, string>();
  for (const [, name, value] of css.matchAll(/--([a-z0-9-]+):\s*(#[0-9a-fA-F]{3,8})\s*;/g)) out.set(name, value.toLowerCase());
  return out;
}

describe("design tokens", () => {
  it("the canvas and 3D colours match tokens.css", () => {
    const css = cssColours();
    for (const [name, value] of Object.entries(COLOR)) {
      expect(css.get(name), `--${name}`).toBe(value);
    }
  });

  it("every colour token in tokens.css is mirrored for canvas code", () => {
    const missing = [...cssColours().keys()].filter((name) => !(name in COLOR));
    expect(missing).toEqual([]);
  });
});
