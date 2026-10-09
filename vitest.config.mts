import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
  },
  test: {
    include: ["tests/{geometry,commands,persistence,editor,design,furniture,server}/**/*.test.ts"],
    environment: "node",
  },
});
