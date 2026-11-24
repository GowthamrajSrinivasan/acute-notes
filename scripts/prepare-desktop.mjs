// Assembles the Next standalone server for packaging: the standalone output
// does not include `public/` or `.next/static`, so copy them alongside it.
// With semantic placement built in (NEXT_PUBLIC_SEMANTIC_PLACEMENT=on), the
// local embedding model's weights are bundled too (scripts/desktop-models.mjs).
import { cpSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { bundleModel, DEFAULT_DESKTOP_MODEL } from "./desktop-models.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const dist = join(root, process.env.ACUTE_DIST_DIR || ".next");
const standalone = join(dist, "standalone");

if (!existsSync(join(standalone, "server.js"))) {
  console.error("[desktop] .next/standalone/server.js missing - run the desktop build first (ACUTE_DESKTOP=1 next build).");
  process.exit(1);
}
cpSync(join(root, "public"), join(standalone, "public"), { recursive: true });
cpSync(join(dist, "static"), join(standalone, process.env.ACUTE_DIST_DIR || ".next", "static"), { recursive: true });
console.log("[desktop] Copied public/ and .next/static into .next/standalone");

// Next writes server.js as CommonJS, but the standalone package.json is a copy of ours, which says "type": "module", so
// Node (and Electron's utilityProcess) would load server.js as an ES module and stop at its first `require` (found
// 2026-11-24). The server's own package.json says what server.js is.
const serverPackage = join(standalone, "package.json");
const pkg = JSON.parse(readFileSync(serverPackage, "utf8"));
if (pkg.type === "module") {
  writeFileSync(serverPackage, JSON.stringify({ ...pkg, type: "commonjs" }, null, 2) + "\n");
  console.log("[desktop] Marked the standalone server as CommonJS");
}

if (process.env.NEXT_PUBLIC_SEMANTIC_PLACEMENT === "on") {
  const key = process.env.ACUTE_DESKTOP_EMBEDDING_MODEL || DEFAULT_DESKTOP_MODEL;
  const cacheDir = process.env.ACUTE_EMBEDDING_MODELS_DIR || join(root, "node_modules", ".cache", "acute-embedding-models");
  const { missing, target } = bundleModel({ key, cacheDir, serverDir: standalone });
  if (missing.length) {
    console.error(
      `[desktop] Semantic placement is on, but the "${key}" model's files are missing:\n  ${missing.join("\n  ")}\n` +
        "Fetch them once (weights only, no user text) by running the app with ACUTE_EMBEDDINGS=local-model:" +
        `${key} ACUTE_EMBEDDINGS_DOWNLOAD=on and opening "Where should this go?", or set ACUTE_EMBEDDING_MODELS_DIR.`,
    );
    process.exit(1);
  }
  console.log(`[desktop] Bundled the "${key}" embedding model into ${target}`);
}
