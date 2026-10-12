import { defineConfig, devices } from "@playwright/test";

const PORT = Number(process.env.E2E_PORT ?? 3110);

export default defineConfig({
  testDir: "tests/e2e",
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: [["list"]],
  timeout: 60_000,
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: "retain-on-failure",
    // Allow software WebGL as a fallback, so the 3D view renders on machines without a GPU.
    launchOptions: { args: ["--enable-unsafe-swiftshader"] },
  },
  projects: [
    {
      name: "desktop",
      testIgnore: /(phone|screens)\.spec\.ts/,
      use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 } },
    },
    {
      // Pixel baselines, Linux only: npm run test:screens runs them in the Playwright Docker image.
      name: "screens",
      testMatch: /screens\.spec\.ts/,
      use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 } },
    },
    {
      // A touch-only phone: one column, and Refine and 3D read-only.
      name: "phone",
      testMatch: /phone\.spec\.ts/,
      use: { ...devices["Desktop Chrome"], viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true },
    },
  ],
  expect: {
    toHaveScreenshot: { maxDiffPixelRatio: 0.01, animations: "disabled", caret: "hide", stylePath: "tests/e2e/screens.css" },
  },
  webServer: {
    command: `npx next start --port ${PORT}`,
    url: `http://localhost:${PORT}`,
    reuseExistingServer: false,
    // Tests never make paid calls: empty keys (which .env.local can't override) keep Claude and Gemini off.
    env: { ANTHROPIC_API_KEY: "", GEMINI_API_KEY: "" },
    timeout: 120_000,
  },
});
