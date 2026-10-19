/**
 * One-shot AI generate (F35). Node runtime — this Next.js version's default
 * (the Edge Runtime is deprecated; see
 * node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/02-route-segment-config/runtime.md,
 * read before writing this file per AGENTS.md) — required anyway since the
 * Copilot SDK spawns a CLI process and cannot run on Edge.
 */
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { aiFeatureDisabledResponse } from "@/config/features";
import { getHostRuntime, resolveHostInput, toErrorResponse } from "../aiHost";

export async function POST(req: NextRequest): Promise<Response> {
  const disabled = aiFeatureDisabledResponse();
  if (disabled) return disabled;
  const resolved = await resolveHostInput(req);
  if ("response" in resolved) return resolved.response;

  try {
    const response = await getHostRuntime().generate(resolved.input);
    return NextResponse.json(response);
  } catch (err) {
    return toErrorResponse(err);
  }
}
