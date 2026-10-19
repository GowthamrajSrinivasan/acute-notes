import { defineConfig, devices } from "@playwright/test";

/**
 * End-to-end tests against the real app. Two suites:
 *
 * - `e2e/local` — no AI calls; run any time with `npm run test:e2e`.
 * - `e2e/ai` — real GitHub Copilot calls with the account signed in to the
 *   Copilot CLI on this machine. Only included when `ACUTE_AI_E2E=1`, which
 *   `npm run test:e2e:ai` sets after asking you to confirm — so a plain
 *   `npx playwright test` can never spend AI requests by accident.
 */
const includeAI = process.env.ACUTE_AI_E2E === "1";
const desktop = { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 } };
/** `npm run test:e2e:ai -- --demo` (ACUTE_DEMO=1): every browser action slowed so a headed run can be watched like a demo. */
const demo = process.env.ACUTE_DEMO === "1";
const aiUse = demo ? { ...desktop, launchOptions: { slowMo: Number(process.env.ACUTE_SLOWMO ?? 350) } } : desktop;

export default defineConfig({
  timeout: 180_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  reporter: [["list"]],
  use: {
    baseURL: "http://localhost:3000",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [
    { name: "local", testDir: "e2e/local", use: desktop },
    ...(includeAI
      ? [
          { name: "ai-preflight", testDir: "e2e/ai", testMatch: /preflight\.setup\.ts/ },
          { name: "ai", testDir: "e2e/ai", testMatch: /\.spec\.ts$/, dependencies: ["ai-preflight"], use: aiUse },
        ]
      : []),
  ],
  webServer: {
    command: "npm run dev",
    url: "http://localhost:3000",
    reuseExistingServer: true,
    timeout: 180_000,
  },
});
