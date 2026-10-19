/**
 * The vendor-neutral contract every AI host implements (PRD §13.15.12 point
 * 5: "Browser ↔ AI host routes are generic ... and dispatch by connection id
 * to a HostRuntime interface"). Route handlers under `src/app/api/ai/` only
 * ever see this — never a vendor name or SDK type — so a future host (a
 * Claude Agent SDK or Codex SDK runtime, per the PRD) is a new module beside
 * `copilot/` plus one registry line, not a route-handler change.
 */
import type { AIModel, AIRequest, AIResponse, AIStreamChunk } from "@/ai/types";

export type HostAuth = { kind: "token"; gitHubToken: string } | { kind: "logged_in_user" };

/** BYOK connection info for a request — openai/azure/anthropic or an OpenAI-compatible local endpoint (Ollama and similar). */
export interface HostByokProvider {
  type: "openai" | "azure" | "anthropic";
  baseUrl: string;
  apiKey?: string;
  wireApi?: "completions" | "responses";
}

export interface HostGenerateInput {
  request: AIRequest;
  auth: HostAuth;
  provider?: HostByokProvider;
}

export interface HostRuntime {
  readonly id: string;
  generate(input: HostGenerateInput): Promise<AIResponse>;
  stream(input: HostGenerateInput): AsyncIterable<AIStreamChunk>;
  listModels(auth: HostAuth): Promise<AIModel[]>;
}
