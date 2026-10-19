/**
 * `POST /api/import/chat-share` `{ url }` → `{ transcript }`: fetches one shared chat (ChatGPT for now) and returns
 * its visible turns (chat-share plan C1). One link per request, so the dialog can show per-link progress and errors.
 * Node runtime (this Next.js version's default; see
 * node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/route.md). Fetched text is untrusted input to
 * later prompts, so credential-shaped strings are redacted before it leaves here.
 */
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { redactSecrets } from "@/ai/context/redact";
import { ChatShareError } from "@/ai/import/chatShare/chatgpt";
import { fetchChatShare } from "@/ai/import/chatShare/fetchShare";
import { aiFeatureDisabledResponse } from "@/config/features";

const STATUS = { not_found: 404, unreadable: 502, empty: 422 } as const;

export async function POST(req: NextRequest): Promise<Response> {
  const disabled = aiFeatureDisabledResponse();
  if (disabled) return disabled;

  let url: unknown;
  try {
    url = ((await req.json()) as { url?: unknown }).url;
  } catch {
    url = undefined;
  }
  if (typeof url !== "string" || url.length > 2048) return NextResponse.json({ error: "Expected a share link." }, { status: 400 });

  try {
    const transcript = await fetchChatShare(url);
    return NextResponse.json({
      transcript: { ...transcript, turns: transcript.turns.map((t) => ({ ...t, markdown: redactSecrets(t.markdown) })) },
    });
  } catch (err) {
    if (err instanceof ChatShareError) return NextResponse.json({ error: err.message, code: err.code }, { status: STATUS[err.code] });
    return NextResponse.json({ error: "Could not import that chat." }, { status: 500 });
  }
}
