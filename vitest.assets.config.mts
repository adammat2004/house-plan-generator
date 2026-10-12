import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

/** `npm run assets:build`: makes the furniture asset library (see scripts/assets/build.assets.ts). Paid calls; skips itself without keys. */
export default defineConfig({
  resolve: {
    alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
  },
  test: {
    include: ["scripts/assets/**/*.assets.ts"],
    environment: "node",
    // A 3D model can sit in a queue for minutes.
    testTimeout: 20 * 60_000,
    hookTimeout: 60_000,
    maxConcurrency: 4,
  },
});
