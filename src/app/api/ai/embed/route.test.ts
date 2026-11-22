/**
 * `/api/ai/embed` (Stage 5a wiring, §18): off unless switched on; never on a public deployment; unavailable (not hashed
 * vectors) without weights; and — when the spike's cached MiniLM-L6 weights are on this machine — real vectors, offline
 * (downloads stay off: no network).
 */
import { existsSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { dequantize, similarity } from "@/ai/router/embeddingProvider";
import { resetServerEmbedding } from "@/ai/router/serverEmbedding";
import { GET, POST } from "./route";

const CACHE = path.join(process.cwd(), "node_modules", ".cache", "acute-embedding-models");
const cached = existsSync(path.join(CACHE, "Xenova", "all-MiniLM-L6-v2"));

const post = (body: unknown) => new NextRequest("http://localhost:3000/api/ai/embed", { method: "POST", headers: { host: "localhost:3000", "content-type": "application/json" }, body: JSON.stringify(body) });

function switchOn(dir?: string) {
  vi.stubEnv("NEXT_PUBLIC_AI_FEATURE", "on");
  vi.stubEnv("ACUTE_EMBEDDINGS", "local-model:minilm-l6");
  vi.stubEnv("ACUTE_EMBEDDINGS_DOWNLOAD", "off");
  if (dir) vi.stubEnv("ACUTE_EMBEDDING_MODELS_DIR", dir);
}

afterEach(() => {
  vi.unstubAllEnvs();
  resetServerEmbedding();
});

describe("/api/ai/embed", () => {
  it("404 while off: no switch, AI off, or a public deployment", async () => {
    vi.stubEnv("NEXT_PUBLIC_AI_FEATURE", "on");
    vi.stubEnv("ACUTE_EMBEDDINGS", "");
    expect((await GET()).status).toBe(404);
    expect((await POST(post({ texts: ["x"] }))).status).toBe(404);
    switchOn();
    vi.stubEnv("NEXT_PUBLIC_AI_FEATURE", "off");
    expect((await GET()).status).toBe(404);
    switchOn();
    vi.stubEnv("ACUTE_HTTP_EXPOSURE", "public");
    expect((await GET()).status).toBe(404);
  });

  it("503 without weights (downloads off) — never the hashed fallback's vectors", async () => {
    switchOn(mkdtempSync(path.join(tmpdir(), "acute-no-weights-")));
    const res = await GET();
    expect(res.status).toBe(503);
    expect((await POST(post({ texts: ["x"] }))).status).toBe(503);
  }, 60_000);

  it("400 on a malformed body", async () => {
    switchOn(mkdtempSync(path.join(tmpdir(), "acute-no-weights-")));
    expect((await POST(post({ texts: "x" }))).status).toBe(400);
    expect((await POST(post({ texts: ["x"], extra: 1 }))).status).toBe(400);
  });

  it.runIf(cached)("with the cached MiniLM-L6 weights: the model's id, and quantised vectors that rank a paraphrase above an unrelated line", async () => {
    switchOn(CACHE);
    const info = (await (await GET()).json()) as { embedder: string; dims: number };
    expect(info).toMatchObject({ embedder: "local-minilm-l6-q8-v1", dims: 384 });
    const res = await POST(post({ texts: ["Requests are retried up to five times.", "A failed call is attempted again five times.", "The office closes at six."] }));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { embedder: string; vectors: { q: string; scale: number }[] };
    const vs = body.vectors.map((v) => dequantize({ embedder: body.embedder, q: new Int8Array(Buffer.from(v.q, "base64")), scale: v.scale }));
    expect(vs[0]!.dense).toHaveLength(384);
    expect(similarity(vs[0]!, vs[1]!)).toBeGreaterThan(similarity(vs[0]!, vs[2]!) + 0.2);
  }, 120_000);
});
