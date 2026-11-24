import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
  },
  test: {
    include: ["tests/{geometry,commands,persistence,editor,design,furniture,server,home}/**/*.test.ts"],
    environment: "node",
    // The planner sweeps are CPU-bound and run past the 5 s default on shared CI runners.
    testTimeout: 30000,
  },
});
