// The local embedding models the desktop build can bundle for semantic placement (intelligent-update-engine-plan §18,
// 2026-11-24). Keys and hub ids mirror LOCAL_MODELS in src/ai/router/localModelEmbedding.ts (a test checks they agree);
// only the files transformers.js reads offline are copied.
import { cpSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

export const DESKTOP_MODELS = {
  "minilm-l6": "Xenova/all-MiniLM-L6-v2",
};
export const DEFAULT_DESKTOP_MODEL = "minilm-l6";
export const MODEL_FILES = ["config.json", "tokenizer.json", "tokenizer_config.json", "onnx/model_quantized.onnx"];
/** Folder name inside the server, and the manifest the Electron shell reads. */
export const MODELS_FOLDER = "embedding-models";
export const MANIFEST = "acute-model.json";

/**
 * Copies one model's files from `cacheDir/<hub>` into `<serverDir>/embedding-models/<hub>` and writes the manifest.
 * Returns the missing files (nothing is copied then).
 */
export function bundleModel({ key = DEFAULT_DESKTOP_MODEL, cacheDir, serverDir }) {
  const hub = DESKTOP_MODELS[key];
  if (!hub) throw new Error(`Unknown desktop embedding model "${key}" (known: ${Object.keys(DESKTOP_MODELS).join(", ")})`);
  const missing = MODEL_FILES.filter((f) => !existsSync(join(cacheDir, hub, f)));
  if (missing.length) return { missing: missing.map((f) => join(cacheDir, hub, f)) };
  const target = join(serverDir, MODELS_FOLDER);
  for (const f of MODEL_FILES) {
    mkdirSync(dirname(join(target, hub, f)), { recursive: true });
    cpSync(join(cacheDir, hub, f), join(target, hub, f));
  }
  writeFileSync(join(target, MANIFEST), JSON.stringify({ embeddings: `local-model:${key}`, hub }, null, 2) + "\n");
  return { missing: [], target };
}
