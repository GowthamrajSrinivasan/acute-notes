/**
 * Provider-neutral AI error taxonomy (PRD §13.15.7 point 6). Adapters map
 * vendor SDK errors to one of these kinds inside their own folder; nothing
 * else in the app inspects a vendor error shape.
 */
export const AI_ERROR_KINDS = [
  "auth",
  "quota_exhausted",
  "rate_limited",
  "model_unavailable",
  "network",
  "timeout",
  "cancelled",
  "invalid_output",
  /** AI mode is Off (PRD §6.6): the runtime refuses before any provider is touched. */
  "disabled",
] as const;

export type AIErrorKind = (typeof AI_ERROR_KINDS)[number];

export function isAIErrorKind(value: unknown): value is AIErrorKind {
  return typeof value === "string" && (AI_ERROR_KINDS as readonly string[]).includes(value);
}

export class AIError extends Error {
  override name = "AIError";
  readonly kind: AIErrorKind;

  constructor(kind: AIErrorKind, message: string, options?: ErrorOptions) {
    super(message, options);
    this.kind = kind;
  }
}

const AVAILABILITY_KINDS: readonly AIErrorKind[] = [
  "auth",
  "quota_exhausted",
  "rate_limited",
  "model_unavailable",
  "network",
  "timeout",
];

/**
 * Availability failures are the only ones that ever trigger provider
 * fallback (PRD §13.15.10) — never a schema-validation failure or cancellation.
 */
export function isAvailabilityError(err: unknown): err is AIError {
  return err instanceof AIError && AVAILABILITY_KINDS.includes(err.kind);
}
