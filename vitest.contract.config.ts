import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

/**
 * F36 contract-test suite: real network calls against real provider
 * credentials from `.env.local` (never committed). Deliberately separate
 * from vitest.config.ts so `npm run test` never makes a live API call —
 * run explicitly with `npm run test:contract`.
 */
export default defineConfig({
  resolve: {
    alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
  },
  test: {
    include: ["src/ai/contractTests/**/*.contract.test.ts"],
    environment: "node",
    // Build-level AI switch (src/config/features.ts); vitest reads no .env files. Tests of the Off build stub it.
    env: { NEXT_PUBLIC_AI_FEATURE: "on" },
    // A live model call can take a while; the default 5s hook/test timeout is too tight.
    testTimeout: 30_000,
  },
});
