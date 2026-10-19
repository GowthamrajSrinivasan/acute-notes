/**
 * Model listing (F35). Node runtime (see run/route.ts for why). GET, not
 * POST — no prompt/BYOK body, just the caller's credentials.
 */
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { aiFeatureDisabledResponse } from "@/config/features";
import { errorResponse, getHostMode, getHostRuntime, toErrorResponse } from "../aiHost";

export async function GET(req: NextRequest): Promise<Response> {
  const disabled = aiFeatureDisabledResponse();
  if (disabled) return disabled;
  const header = req.headers.get("authorization");
  const gitHubToken = header?.toLowerCase().startsWith("bearer ") ? header.slice(7).trim() || undefined : undefined;

  if (!gitHubToken && getHostMode() === "server") {
    return errorResponse(401, "auth", "No per-user credentials were provided.");
  }

  try {
    const models = await getHostRuntime().listModels(gitHubToken ? { kind: "token", gitHubToken } : { kind: "logged_in_user" });
    return NextResponse.json(models);
  } catch (err) {
    return toErrorResponse(err);
  }
}
