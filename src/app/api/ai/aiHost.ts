/**
 * Request parsing shared by the AI host route handlers (F35). Resolves
 * per-user credentials from the request itself — F27 (credential storage)
 * doesn't exist yet, so there is nothing stored server-side to read. `
 * AI_HOST_MODE=server` is the deployment-mode gate: a request with no
 * per-user token and no BYOK connection is rejected outright rather than
 * silently falling back to the host machine's own GitHub login.
 */
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { createCopilotHostRuntime } from "@/ai/host/copilot/CopilotHostRuntime";
import type { HostAuth, HostByokProvider, HostGenerateInput, HostRuntime } from "@/ai/host/hostRuntime";
import { AIError } from "@/ai/errors";

let hostRuntime: HostRuntime | null = null;

/** The one AI host runtime this deployment uses. Becomes a lookup by connection id once a second HostRuntime exists (PRD §13.15.12 point 5). */
export function getHostRuntime(): HostRuntime {
  if (!hostRuntime) hostRuntime = createCopilotHostRuntime();
  return hostRuntime;
}

export type AIHostMode = "local" | "server";

export function getHostMode(): AIHostMode {
  return process.env.AI_HOST_MODE === "server" ? "server" : "local";
}

interface AIHostRequestBody {
  request?: {
    task?: string;
    prompt?: string;
    systemPrompt?: string;
    model?: string;
    temperature?: number;
    maxTokens?: number;
    timeoutMs?: number;
  };
  provider?: HostByokProvider;
}

export interface ResolvedHostInput {
  input: HostGenerateInput;
}

export interface HostRequestError {
  response: NextResponse;
}

export function errorResponse(status: number, kind: string, message: string): NextResponse {
  return NextResponse.json({ kind, message }, { status });
}

/**
 * Only an `AIError`'s message is ever forwarded to the client — those come
 * from `errorMapping.ts`'s own curated, safe text. Any other thrown error is
 * from a layer we don't control the shape of (the SDK, the network stack, a
 * bug), so it gets a fixed generic message instead of its raw `.message`,
 * which could in principle echo request-derived content back to the caller.
 */
export function toErrorResponse(err: unknown): NextResponse {
  if (err instanceof AIError) return errorResponse(statusForErrorKind(err.kind), err.kind, err.message);
  // Server-side only, so an unmapped failure is diagnosable at all; secrets
  // are redacted since a vendor/SDK message could in principle echo one.
  console.error("[acute-notes] AI host request failed:", redactSecrets(err instanceof Error ? (err.stack ?? err.message) : String(err)));
  return errorResponse(502, "network", "The AI request failed.");
}

function redactSecrets(text: string): string {
  return text
    .replace(/\b(gh[opusr]_|github_pat_)[A-Za-z0-9_]+/g, "$1[redacted]")
    .replace(/\b(sk-(?:ant-|proj-)?)[A-Za-z0-9_-]{8,}/g, "$1[redacted]")
    .replace(/\bAIza[0-9A-Za-z_-]{20,}/g, "AIza[redacted]")
    .replace(/(Bearer\s+)\S+/gi, "$1[redacted]");
}

export function statusForErrorKind(kind: AIError["kind"]): number {
  switch (kind) {
    case "auth":
      return 401;
    case "rate_limited":
      return 429;
    case "quota_exhausted":
      return 402;
    case "timeout":
      return 504;
    case "cancelled":
      return 499;
    case "invalid_output":
      return 502;
    case "model_unavailable":
    case "network":
    default:
      return 502;
  }
}

/** Parses and authorizes one AI host request. Never returns an input built from the host's own ambient credentials for a request that should have carried its own. */
export async function resolveHostInput(req: NextRequest, signal?: AbortSignal): Promise<ResolvedHostInput | HostRequestError> {
  let body: AIHostRequestBody;
  try {
    body = (await req.json()) as AIHostRequestBody;
  } catch {
    return { response: errorResponse(400, "invalid_output", "Invalid JSON body.") };
  }

  if (!body.request?.prompt) {
    return { response: errorResponse(400, "invalid_output", "request.prompt is required.") };
  }

  const gitHubToken = extractBearerToken(req);
  const auth = resolveAuth(gitHubToken, body.provider, getHostMode());
  if (!auth) {
    return { response: errorResponse(401, "auth", "No per-user credentials were provided.") };
  }

  return {
    input: {
      request: {
        task: body.request.task ?? "chat",
        prompt: body.request.prompt,
        systemPrompt: body.request.systemPrompt,
        model: body.request.model,
        temperature: body.request.temperature,
        maxTokens: body.request.maxTokens,
        timeoutMs: body.request.timeoutMs,
        signal,
      },
      auth,
      provider: body.provider,
    },
  };
}

function extractBearerToken(req: NextRequest): string | undefined {
  const header = req.headers.get("authorization");
  if (!header?.toLowerCase().startsWith("bearer ")) return undefined;
  const token = header.slice("bearer ".length).trim();
  return token || undefined;
}

/**
 * `"local"` mode may fall back to the host's own logged-in Copilot CLI user
 * (a developer's own machine). `"server"` mode never does — a request must
 * carry its own token or its own BYOK connection, or it is rejected.
 */
function resolveAuth(gitHubToken: string | undefined, provider: HostByokProvider | undefined, mode: AIHostMode): HostAuth | null {
  if (gitHubToken) return { kind: "token", gitHubToken };
  if (provider) return { kind: "logged_in_user" }; // ignored by CopilotHostRuntime when a BYOK provider is set
  if (mode === "local") return { kind: "logged_in_user" };
  return null;
}
