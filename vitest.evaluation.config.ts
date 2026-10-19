import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

// The Knowledge Notes golden dataset (evaluation/knowledge-notes/README.md): offline checks of the dataset, its
// checkers and any recorded runs. Kept out of the default `npm test` until the dataset is approved (README "Review").
export default defineConfig({
  resolve: {
    alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
  },
  test: {
    include: ["evaluation/**/*.test.ts"],
    environment: "node",
    env: { NEXT_PUBLIC_AI_FEATURE: "on" },
  },
});
