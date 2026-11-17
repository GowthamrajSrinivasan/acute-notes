/**
 * One AI consistency-check call (intelligent-update-engine-plan Stage 4f): exactly one direct request to the user's own
 * chat-completions connection (`hostDirectJudge`). Node runtime, like the other AI host routes. **404 unless both the AI
 * feature and the server's `CONSISTENCY_AI_CHECK` switch are on** — with the switch off, no request can reach a model.
 * The caller's own key comes in the body (as a BYOK chat connection's does) and is used only for this request.
 */
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { isConsistencyAICheckEnabled } from "@/config/features";
import { directJudgeBodySchema, hostDirectJudge } from "@/ai/host/judge/directJudge";
import { errorResponse, toErrorResponse } from "../aiHost";

export async function POST(req: NextRequest): Promise<Response> {
  if (!isConsistencyAICheckEnabled()) return new Response("Not Found", { status: 404 });
  let json: unknown;
  try {
    json = await req.json();
  } catch {
    return errorResponse(400, "invalid_output", "Invalid JSON body.");
  }
  const parsed = directJudgeBodySchema.safeParse(json);
  if (!parsed.success) return errorResponse(400, "invalid_output", "The AI check request wasn't in the expected shape.");
  try {
    return NextResponse.json(await hostDirectJudge({ ...parsed.data, signal: req.signal }));
  } catch (err) {
    return toErrorResponse(err);
  }
}
