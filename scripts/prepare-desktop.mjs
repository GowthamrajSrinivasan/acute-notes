// Assembles the Next standalone server for packaging: the standalone output
// does not include `public/` or `.next/static`, so copy them alongside it.
import { cpSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const standalone = join(root, ".next", "standalone");

if (!existsSync(join(standalone, "server.js"))) {
  console.error("[desktop] .next/standalone/server.js missing - run the desktop build first (ACUTE_DESKTOP=1 next build).");
  process.exit(1);
}
cpSync(join(root, "public"), join(standalone, "public"), { recursive: true });
cpSync(join(root, ".next", "static"), join(standalone, ".next", "static"), { recursive: true });
console.log("[desktop] Copied public/ and .next/static into .next/standalone");
