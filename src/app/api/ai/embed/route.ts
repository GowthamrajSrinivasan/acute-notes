/**
 * The local embedding model for semantic placement (intelligent-update-engine-plan Stage 5, §18). Node runtime, like the
 * other AI host routes. **404 unless the AI feature is on, `ACUTE_EMBEDDINGS` names a local model, and the server isn't
 * publicly exposed** (`ACUTE_HTTP_EXPOSURE=public`): the text is embedded on the user's own machine, never elsewhere.
 * No model API is called and nothing is spent: the model runs in this process (`serverEmbedding.ts`).
 *
 * - GET: 200 `{ embedder, dims, related, claim? }` (`claim`: the same-claim thresholds, #14) when the model is loaded, 503 when it can't be (no weights), 404 when off.
 * - POST `{ texts: string[] }`: 200 `{ embedder, dims, related, vectors: [{ q, scale }] }` — one quantised vector per text.
 */
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { z } from "zod";
import { isLocalEmbeddingsEnabled } from "@/config/features";
import { isPublicExposure } from "@/config/httpExposure";
import { EMBED_LIMITS, serverEmbedding } from "@/ai/router/serverEmbedding";
import { errorResponse } from "../aiHost";

const switchedOn = () => isLocalEmbeddingsEnabled() && !isPublicExposure();
const notFound = () => new Response("Not Found", { status: 404 });
const noStore = { "cache-control": "no-store" };

const bodySchema = z.object({ texts: z.array(z.string().max(EMBED_LIMITS.charsPerText * 4)).max(EMBED_LIMITS.texts) }).strict();

export async function GET(): Promise<Response> {
  if (!switchedOn()) return notFound();
  const model = await serverEmbedding();
  if (model.state !== "ready") return NextResponse.json({ kind: "unavailable", message: model.reason }, { status: 503, headers: noStore });
  return NextResponse.json(model.info, { headers: noStore });
}

export async function POST(req: NextRequest): Promise<Response> {
  if (!switchedOn()) return notFound();
  let json: unknown;
  try {
    json = await req.json();
  } catch {
    return errorResponse(400, "invalid_output", "Invalid JSON body.");
  }
  const parsed = bodySchema.safeParse(json);
  if (!parsed.success) return errorResponse(400, "invalid_output", "The embedding request wasn't in the expected shape.");
  const texts = parsed.data.texts;
  if (texts.reduce((n, t) => n + Math.min(t.length, EMBED_LIMITS.charsPerText), 0) > EMBED_LIMITS.totalChars) return errorResponse(413, "too_large", "Too much text in one embedding request.");
  const model = await serverEmbedding();
  if (model.state !== "ready") return NextResponse.json({ kind: "unavailable", message: model.reason }, { status: 503, headers: noStore });
  try {
    return NextResponse.json(await model.embed(texts), { headers: noStore });
  } catch {
    return errorResponse(500, "embedding_failed", "The local embedding model failed on this request.");
  }
}
