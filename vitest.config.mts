import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
  },
  test: {
    include: ["tests/{geometry,commands,persistence,editor,design,furniture,server,home,agent}/**/*.test.ts"],
    environment: "node",
    // The layout-search tests sweep many outlines and take 5-20 s on a loaded runner.
    testTimeout: 30_000,
  },
});
