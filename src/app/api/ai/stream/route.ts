/**
 * Streaming AI generate (F35). Node runtime (see run/route.ts for why).
 * Body is newline-delimited JSON `AIStreamChunk`s — not `text/event-stream`,
 * so the client (`copilotProvider.ts`) needs no SSE parser, just a line
 * reader. A final chunk with `kind`/`message` fields (not part of
 * `AIStreamChunk`) reports a failure that happened mid-stream, since HTTP
 * headers are already committed by the time a Copilot session error arrives.
 */
import type { NextRequest } from "next/server";
import { aiFeatureDisabledResponse } from "@/config/features";
import { AIError } from "@/ai/errors";
import { getHostRuntime, resolveHostInput } from "../aiHost";

export async function POST(req: NextRequest): Promise<Response> {
  const disabled = aiFeatureDisabledResponse();
  if (disabled) return disabled;
  const controller = new AbortController();
  req.signal.addEventListener("abort", () => controller.abort(), { once: true });

  const resolved = await resolveHostInput(req, controller.signal);
  if ("response" in resolved) return resolved.response;

  const encoder = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({
    async start(streamController) {
      try {
        for await (const chunk of getHostRuntime().stream(resolved.input)) {
          streamController.enqueue(encoder.encode(`${JSON.stringify(chunk)}\n`));
        }
      } catch (err) {
        // Only an AIError's message is ever forwarded — see toErrorResponse
        // in aiHost.ts for why an unmapped error gets a generic one instead.
        const { kind, message } = err instanceof AIError ? { kind: err.kind, message: err.message } : { kind: "network" as const, message: "The AI stream failed." };
        streamController.enqueue(encoder.encode(`${JSON.stringify({ delta: "", done: true, kind, message })}\n`));
      } finally {
        streamController.close();
      }
    },
    cancel() {
      controller.abort();
    },
  });

  return new Response(body, { headers: { "content-type": "application/x-ndjson; charset=utf-8" } });
}
