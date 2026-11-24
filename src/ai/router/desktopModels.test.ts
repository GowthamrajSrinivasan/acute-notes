import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { bundleModel, DEFAULT_DESKTOP_MODEL, DESKTOP_MODELS, MANIFEST, MODEL_FILES, MODELS_FOLDER } from "../../../scripts/desktop-models.mjs";
import { embeddingConfigFrom } from "./embeddingProvider";
import { LOCAL_MODELS } from "./localModelEmbedding";

const temps: string[] = [];
const temp = () => {
  const d = mkdtempSync(join(tmpdir(), "acute-desktop-models-"));
  temps.push(d);
  return d;
};
afterEach(() => {
  for (const d of temps.splice(0)) rmSync(d, { recursive: true, force: true });
});

describe("the desktop build's bundled embedding model (scripts/desktop-models.mjs)", () => {
  it("names the same models as LOCAL_MODELS, and its manifest is a valid ACUTE_EMBEDDINGS value", () => {
    for (const [key, hub] of Object.entries(DESKTOP_MODELS)) expect(LOCAL_MODELS[key as keyof typeof LOCAL_MODELS]?.hub).toBe(hub);
    expect(DEFAULT_DESKTOP_MODEL).toBe("minilm-l6");
    expect(embeddingConfigFrom(`local-model:${DEFAULT_DESKTOP_MODEL}`)).toEqual({ provider: "local-model", model: "minilm-l6" });
  });

  it("copies only the files read offline, and writes the manifest the Electron shell reads", () => {
    const cache = temp();
    const server = temp();
    const hub = DESKTOP_MODELS["minilm-l6"]!;
    for (const f of [...MODEL_FILES, "onnx/model.onnx", "README.md"]) {
      mkdirSync(dirname(join(cache, hub, f)), { recursive: true });
      writeFileSync(join(cache, hub, f), f);
    }
    const r = bundleModel({ cacheDir: cache, serverDir: server });
    expect(r.missing).toEqual([]);
    expect(readdirSync(join(server, MODELS_FOLDER, hub), { recursive: true }).map(String).sort()).toEqual(["config.json", "onnx", join("onnx", "model_quantized.onnx"), "tokenizer.json", "tokenizer_config.json"].sort());
    expect(JSON.parse(readFileSync(join(server, MODELS_FOLDER, MANIFEST), "utf8"))).toEqual({ embeddings: "local-model:minilm-l6", hub });
  });

  it("missing weights: says which, copies nothing; an unknown model is an error", () => {
    const server = temp();
    const r = bundleModel({ cacheDir: temp(), serverDir: server });
    expect(r.missing).toHaveLength(MODEL_FILES.length);
    expect(readdirSync(server)).toEqual([]);
    expect(() => bundleModel({ key: "nope", cacheDir: temp(), serverDir: server })).toThrow(/Unknown desktop embedding model/);
  });
});
