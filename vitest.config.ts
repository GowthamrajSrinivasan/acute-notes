import { configDefaults, defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

export default defineConfig({
  resolve: {
    alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
  },
  test: {
    include: ["src/**/*.test.ts"],
    // Contract tests make real network calls against live provider
    // credentials (F36) — never part of the default run. See
    // vitest.contract.config.ts / `npm run test:contract`.
    exclude: [...configDefaults.exclude, "**/*.contract.test.ts"],
    environment: "node",
    // Build-level AI switch (src/config/features.ts); vitest reads no .env files. Tests of the Off build stub it.
    // MCP has its own switches (MCP_FEATURE is server-enforced; MCP_OAUTH_FEATURE stays off unless a test turns it on).
    env: { NEXT_PUBLIC_AI_FEATURE: "on", MCP_FEATURE: "on", NEXT_PUBLIC_MCP_FEATURE: "on" },
  },
});
