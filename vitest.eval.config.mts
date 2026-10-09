import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

/** `npm run eval`: scores Claude's reading of example requests. Paid calls, so it skips itself without ANTHROPIC_API_KEY. */
export default defineConfig({
  resolve: {
    alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
  },
  test: {
    include: ["tests/eval/**/*.eval.ts"],
    environment: "node",
    // A call may take two 20 s attempts; a few run at once to stay clear of the API's rate limits.
    testTimeout: 60_000,
    maxConcurrency: 4,
  },
});
