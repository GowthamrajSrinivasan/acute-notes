/**
 * Maps Copilot SDK failures to the neutral `AIError` taxonomy (PRD §13.15.7
 * point 6). Verified against @github/copilot-sdk@1.0.14: the SDK exports no
 * error classes. A failed run surfaces as a `session.error` event
 * (`data.errorType`/`data.statusCode`/`data.message`) while `sendAndWait`
 * itself resolves `undefined` — not as a thrown/rejected error. Only a
 * failure before that event stream exists (the CLI process itself failing to
 * start, the connection dying) throws a plain `Error` with just `.message`.
 *
 * Unrecognized error types/messages are never force-fit into a kind — they
 * propagate as-is, so `isAvailabilityError` correctly treats them as
 * non-retryable instead of silently triggering a fallback attempt.
 */
import { AIError, type AIErrorKind } from "@/ai/errors";

export interface CopilotErrorEventData {
  errorType: string;
  statusCode?: number;
  message: string;
}

const ERROR_TYPE_KIND: Readonly<Record<string, AIErrorKind>> = {
  authentication: "auth",
  authorization: "auth",
  quota: "quota_exhausted",
  rate_limit: "rate_limited",
  // Not a clean fit in the taxonomy; "the configured model can't serve this
  // request as given" is closest to model_unavailable, and it's the one kind
  // where retrying via a fallback provider (a different context window) is
  // plausibly useful.
  context_limit: "model_unavailable",
};

const STATUS_CODE_KIND: readonly (readonly [test: (status: number) => boolean, kind: AIErrorKind])[] = [
  [(status) => status === 401 || status === 403, "auth"],
  [(status) => status === 429, "rate_limited"],
  [(status) => status === 408 || status === 504, "timeout"],
  [(status) => status >= 500, "network"],
];

/** Maps a `session.error` event. Throws `AIError` when recognized, otherwise a plain `Error`. */
export function mapSessionErrorEvent(data: CopilotErrorEventData): never {
  const byType = ERROR_TYPE_KIND[data.errorType];
  if (byType) throw new AIError(byType, data.message);

  if (data.statusCode !== undefined) {
    const statusCode = data.statusCode;
    const byStatus = STATUS_CODE_KIND.find(([test]) => test(statusCode));
    if (byStatus) throw new AIError(byStatus[1], data.message);
  }

  throw new Error(data.message);
}

const MESSAGE_PATTERNS: readonly (readonly [pattern: RegExp, kind: AIErrorKind])[] = [
  [/ECONNREFUSED|ENOTFOUND|EAI_AGAIN/i, "network"],
  [/ETIMEDOUT|timed?\s*out/i, "timeout"],
  [/\b401\b|unauthorized|authentication/i, "auth"],
  [/\b429\b|rate.?limit/i, "rate_limited"],
];

/** Best-effort classification for failures that never reach a `session.error` event. */
export function mapTransportError(err: unknown): never {
  const message = err instanceof Error ? err.message : String(err);
  const match = MESSAGE_PATTERNS.find(([pattern]) => pattern.test(message));
  if (match) throw new AIError(match[1], message, { cause: err });
  throw err;
}
