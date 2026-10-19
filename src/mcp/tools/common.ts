/**
 * Shared pieces of the MCP tool surface (F21): the permission policy checked
 * at the tool boundary, tool annotations, and the result/error shapes every
 * tool returns.
 */
import type { CallToolResult, ToolAnnotations } from "@modelcontextprotocol/sdk/types.js";

/**
 * What an MCP client may do. Reads are always allowed (they see only this
 * workspace, bounded). Writes are never direct mutations: with `allowWrites`
 * a write tool puts a change set up for the user's review (F19); without it,
 * every write tool refuses.
 */
export interface ToolPolicy {
  allowWrites: boolean;
  /**
   * D41/D49: where a plan check would sit. Returns the refusal for a premium or limited operation, or null when it is
   * allowed. Nothing is gated in this build (`hosted-deployment-decisions`: no accounts in v1), so no policy sets it.
   */
  entitlement?(feature: string): EntitlementRequired | null;
}

/** D49: the one shape every premium or limited operation refuses with. */
export interface EntitlementRequired {
  error: "entitlement_required";
  feature: string;
  limit?: number;
  upgrade?: string;
}

/** A tool result carrying `refusal` (D49), for the day a policy returns one. */
export function entitlementResult(refusal: EntitlementRequired): CallToolResult {
  return { isError: true, content: [{ type: "text", text: `${refusal.feature} needs a plan that includes it.${refusal.upgrade ? ` ${refusal.upgrade}` : ""}` }], structuredContent: { ...refusal } };
}

export const DEFAULT_TOOL_POLICY: ToolPolicy = { allowWrites: true };

/** A fixed policy, or one read on every call (e.g. a user setting that can change while connected). */
export type ToolPolicySource = ToolPolicy | (() => ToolPolicy);

export const resolvePolicy = (source: ToolPolicySource | undefined): ToolPolicy =>
  typeof source === "function" ? source() : (source ?? DEFAULT_TOOL_POLICY);

/** Safe reads: no side effects, same answer for the same state, nothing outside this workspace. */
export const READ_ANNOTATIONS: ToolAnnotations = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false };

/** Proposals: they add a change set for review (not idempotent: each call is a new proposal) and never delete or overwrite. */
export const WRITE_ANNOTATIONS: ToolAnnotations = { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false };

/** `delete_object`: destructive, so clients ask before calling it; the user still confirms in the review. */
export const DELETE_ANNOTATIONS: ToolAnnotations = { ...WRITE_ANNOTATIONS, destructiveHint: true };

/** A failure the client should see as a tool error (`isError`), with a message meant for the model and the user. */
export class ToolFailure extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ToolFailure";
  }
}

/**
 * A tool's answer: a short human-readable summary, the same payload as JSON
 * text (for clients that ignore structured content), and the payload itself
 * as `structuredContent`.
 */
export function toolResult(summary: string, payload: object): CallToolResult {
  return {
    content: [
      { type: "text", text: summary },
      { type: "text", text: JSON.stringify(payload) },
    ],
    structuredContent: payload as Record<string, unknown>,
  };
}

export function toolError(message: string): CallToolResult {
  return { isError: true, content: [{ type: "text", text: message }] };
}

/** Runs a tool body, turning a `ToolFailure` (or any error) into a tool error result. */
export async function guarded(run: () => Promise<CallToolResult>): Promise<CallToolResult> {
  try {
    return await run();
  } catch (err) {
    if (err instanceof ToolFailure) return toolError(err.message);
    return toolError(err instanceof Error ? err.message : String(err));
  }
}

export const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
