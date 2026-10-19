// Self-hosts Excalidraw fonts so the canvas works fully offline (local-first).
// Excalidraw resolves fonts as `${window.EXCALIDRAW_ASSET_PATH}fonts/...`.
import { cpSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const src = join(root, "node_modules/@excalidraw/excalidraw/dist/prod/fonts");
const dest = join(root, "public/fonts");

if (!existsSync(src)) {
  console.warn("[acute-notes] Excalidraw fonts not found; skipping copy.");
} else if (!existsSync(dest)) {
  cpSync(src, dest, { recursive: true });
  console.log("[acute-notes] Copied Excalidraw fonts to public/fonts");
}
