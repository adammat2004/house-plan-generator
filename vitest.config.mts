import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
  },
  test: {
    include: ["tests/{geometry,commands,persistence,editor,design,furniture,server,home}/**/*.test.ts"],
<<<<<<< HEAD
      environment: "node",
      // The planner sweeps are CPU-bound and run past the 5 s default on shared CI runners.
      testTimeout: 30000,
=======
    environment: "node",
    // The layout-search tests sweep many outlines and take 5-20 s on a loaded runner.
    testTimeout: 30_000,
>>>>>>> origin/main
  },
});
