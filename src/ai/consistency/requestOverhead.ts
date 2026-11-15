/**
 * Transport-specific request overhead for consistency-check reservations (plan §12.32; review 2026-11-15: "include the
 * SDK system prompt in reservations"). Version 1.
 *
 * **UNUSED, DOCUMENTED PROTOTYPE — NOT WIRED INTO STAGE 4f.** Decision 2026-11-16: Stage 4f consistency judgments use the
 * dedicated direct HTTP path only, not the Copilot SDK. Nothing imports this module except its test; it is kept for the
 * day the SDK route is reconsidered. Wiring it would change `judgeCall.ts`/`candidates.ts` (frozen for unseen5).
 *
 * `callTokens(input)` reserves our own system prompt + prompt (characters ÷ 4) + the output budget. It misses what the
 * layer below adds to the provider-bound request:
 * - direct HTTP (chat completions): the chat template. Measured: reported prompt tokens exceeded the estimate by 6–39 on
 *   all 6 calls of the reliability run (2026-11-15);
 * - Copilot SDK (BYOK): the runtime's own system prompt. Measured 2026-11-15, SDK 1.0.14: the SDK request for a one-pair
 *   check is 9,844 bytes against 2,912 bytes for the same check sent directly — 6,932 bytes added. Live: the app reserved
 *   1,424 tokens for that call and the provider reported 2,201 used.
 *
 * Bounds are conservative (bytes ÷ 3 for the SDK prompt, whose tokenizer count isn't available offline).
 */

export const REQUEST_OVERHEAD_VERSION = 1;

export interface RequestOverhead {
  /** Input tokens the transport adds to every request, beyond what `callTokens` counts. */
  inputTokens: number;
  basis: string;
}

export const REQUEST_OVERHEAD = Object.freeze({
  direct_http: Object.freeze({ inputTokens: 64, basis: "chat template; measured excess 6–39 tokens over 6 calls, rounded up with margin" }),
  copilot_sdk_byok: Object.freeze({ inputTokens: Math.ceil(6_932 / 3), basis: "Copilot SDK 1.0.14 system prompt: 6,932 bytes measured 2026-11-15, bytes ÷ 3" }),
} satisfies Record<string, RequestOverhead>);

export type TransportKind = keyof typeof REQUEST_OVERHEAD;

/** The tokens a call must reserve on this transport: our estimate plus the transport's own additions. */
export function reservationWithOverhead(callTokens: number, kind: TransportKind): number {
  return callTokens + REQUEST_OVERHEAD[kind].inputTokens;
}

/**
 * Can any check fit one call under `ceiling` on this transport? The smallest call is one pair: its answer allowance plus
 * the reasoning reserve, plus our prompt, plus the overhead.
 */
export function smallestCallFits(kind: TransportKind, ceiling: number, oneCallTokens: number): boolean {
  return reservationWithOverhead(oneCallTokens, kind) <= ceiling;
}
