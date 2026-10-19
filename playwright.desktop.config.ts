import { defineConfig } from "@playwright/test";

/**
 * End-to-end tests of the real Electron desktop app (no browser, no dev server, no AI calls). They need a build:
 *   npm run desktop:pack   -> dist-desktop/win-unpacked/Acute Notes.exe   (the default target; override with ACUTE_DESKTOP_EXE)
 * or, for the unpackaged shell (`electron .`), ACUTE_DESKTOP_MODE=dev after `npm run desktop:build`.
 * Run with `npm run test:desktop-storage`.
 */
export default defineConfig({
  testDir: "e2e/desktop",
  timeout: 240_000,
  expect: { timeout: 20_000 },
  fullyParallel: false,
  workers: 1,
  reporter: [["list"]],
  use: { trace: "off" },
});
