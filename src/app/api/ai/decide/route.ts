/**
 * One typed decision (decision models: a vendor's decisions API, e.g. Jev on OpenRouter). Node runtime, like the other AI host routes.
 * The caller's own vendor key comes in the body (as a BYOK chat connection's does) and is used only for this request; there
 * is no ambient key to fall back on, so a request without one is rejected.
 */
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { aiFeatureDisabledResponse } from "@/config/features";
import { decisionHostBodySchema } from "@/ai/decisions/types";
import { hostDecide } from "@/ai/host/decisions/hostDecide";
import { errorResponse, toErrorResponse } from "../aiHost";

export async function POST(req: NextRequest): Promise<Response> {
  const disabled = aiFeatureDisabledResponse();
  if (disabled) return disabled;
  let json: unknown;
  try {
    json = await req.json();
  } catch {
    return errorResponse(400, "invalid_output", "Invalid JSON body.");
  }
  const parsed = decisionHostBodySchema.safeParse(json);
  if (!parsed.success) {
    const missingKey = parsed.error.issues.some((i) => i.path[0] === "apiKey");
    return missingKey ? errorResponse(401, "auth", "No per-user credentials were provided.") : errorResponse(400, "invalid_output", "The decision request wasn't in the expected shape.");
  }
  try {
    const result = await hostDecide({ ...parsed.data, signal: req.signal });
    return NextResponse.json(result);
  } catch (err) {
    return toErrorResponse(err);
  }
}
