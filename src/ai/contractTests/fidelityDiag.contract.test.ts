/**
 * Content fidelity diagnostic: runs Visualize end to end against a real BYOK connection from
 * `.env.local` on the two sample documents, recording every raw model reply, so an "invalid plan" failure can be
 * traced to the task and the reason. Run explicitly: npx vitest run --config vitest.contract.config.ts fidelityDiag
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "vitest";
import { createCopilotHostRuntime } from "@/ai/host/copilot/CopilotHostRuntime";
import { AIProviderManager } from "@/ai/providerManager";
import { createAIRuntime } from "@/ai/runtime";
import { createTaskRegistry } from "@/ai/tasks";
import type { AIProvider, AIRequest, AIResponse } from "@/ai/types";
import { registerVisualizeTasks } from "@/ai/visualize/tasks";
import { visualizeContent } from "@/ai/visualize/visualize";
import { getByokCredentials } from "./testEnv";

const OUT = process.env.FIDELITY_DIAG_OUT ?? join(process.cwd(), ".ai", "docs", "fidelity-runs", "diag");
const PROVIDER = (process.env.FIDELITY_DIAG_PROVIDER ?? "openai") as "openai" | "anthropic" | "gemini" | "openrouter" | "aicredits" | "neevcloud";
const ENDPOINT = {
  openai: "https://api.openai.com/v1",
  anthropic: "https://api.anthropic.com",
  gemini: "https://generativelanguage.googleapis.com/v1beta/openai/",
  openrouter: "https://openrouter.ai/api/v1",
  aicredits: "https://api.aicredits.in/v1",
  neevcloud: "https://inference.ai.neevcloud.com/v1",
};
const TYPE = { openai: "openai", anthropic: "anthropic", gemini: "openai", openrouter: "openai", aicredits: "openai", neevcloud: "openai" } as const;

interface Call {
  n: number;
  task: string;
  ms: number;
  promptChars: number;
  replyChars: number;
  outputTokens?: number;
  json: "ok" | "fenced" | "invalid";
  head: string;
  tail: string;
}

function provider(calls: Call[], dir: string): AIProvider {
  const creds = getByokCredentials(PROVIDER)!;
  const host = createCopilotHostRuntime();
  const connection = { auth: { kind: "logged_in_user" as const }, provider: { type: TYPE[PROVIDER], baseUrl: creds.endpoint ?? ENDPOINT[PROVIDER], apiKey: creds.apiKey } };
  return {
    id: PROVIDER,
    name: PROVIDER,
    authTypes: ["api_key"],
    transport: "ai_host_local",
    capabilities: { streaming: false, structuredOutput: "json_mode", toolCalling: false, vision: false, embeddings: false, modelSelection: true },
    isConfigured: async () => true,
    testConnection: async () => ({ ok: true }),
    getUsage: async () => null,
    async generate(request: AIRequest): Promise<AIResponse> {
      const start = Date.now();
      const response = await host.generate({ request: { ...request, model: creds.model, timeoutMs: 600_000 }, ...connection });
      const text = response.text;
      let json: Call["json"] = "invalid";
      try {
        JSON.parse(text);
        json = "ok";
      } catch {
        if (/^\s*```(?:json)?\s*\n[\s\S]*\n?```\s*$/i.test(text)) json = "fenced";
      }
      const call: Call = {
        n: calls.length + 1,
        task: request.task,
        ms: Date.now() - start,
        promptChars: request.prompt.length,
        replyChars: text.length,
        outputTokens: response.usage.completionTokens,
        json,
        head: text.slice(0, 120),
        tail: text.slice(-120),
      };
      calls.push(call);
      writeFileSync(join(dir, `${String(call.n).padStart(2, "0")}-${request.task}.prompt.txt`), request.prompt);
      writeFileSync(join(dir, `${String(call.n).padStart(2, "0")}-${request.task}.reply.txt`), text);
      return response;
    },
  };
}

const FIXTURES = ["cmg-verify-cheatsheet.txt", "handoff-status.md"];

describe.skipIf(!getByokCredentials(PROVIDER))(`fidelity diagnostic (${PROVIDER})`, () => {
  for (const file of FIXTURES) {
    it(file, { timeout: 900_000 }, async () => {
      const dir = join(OUT, file.replace(/\.\w+$/, ""));
      mkdirSync(dir, { recursive: true });
      const text = readFileSync(join(process.cwd(), "src", "ai", "fidelity", "__fixtures__", file), "utf8");
      const calls: Call[] = [];
      const manager = new AIProviderManager();
      manager.registerProvider(provider(calls, dir));
      manager.setPrimary(PROVIDER);
      const registry = createTaskRegistry();
      registerVisualizeTasks(registry);
      const runtime = createAIRuntime({ manager, registry });
      let outcome: unknown;
      try {
        const result = await visualizeContent({ text, operationId: "diag", title: "Visualize", context: { existing: [], viewport: { x: 0, y: 0, width: 1600, height: 900 } } }, runtime, {
          parseMarkdown: (md) => [{ type: "paragraph", content: md }],
        });
        outcome = { ok: true, usedLocalTier: result.usedLocalTier, notices: result.notices, warnings: result.warnings, changes: result.changeSet.changes.length };
        writeFileSync(join(dir, "changeSet.json"), JSON.stringify(result.changeSet, null, 2));
      } catch (err) {
        outcome = { ok: false, error: err instanceof Error ? `${err.name}: ${err.message}` : String(err) };
      }
      writeFileSync(join(dir, "calls.json"), JSON.stringify({ outcome, calls }, null, 2));
      console.log(`\n=== ${file}`, JSON.stringify(outcome), "\n", calls.map((c) => `#${c.n} ${c.task} ${c.ms}ms prompt=${c.promptChars} reply=${c.replyChars} out=${c.outputTokens} json=${c.json} tail=${JSON.stringify(c.tail.slice(-60))}`).join("\n "));
    });
  }
});
