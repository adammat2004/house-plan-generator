import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

/** `npm run plans:render`: renders generated plans for review (see scripts/plans/render.plans.ts). */
export default defineConfig({
  resolve: {
    alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
  },
  test: {
    include: ["scripts/plans/**/*.plans.ts"],
    environment: "node",
  },
});
