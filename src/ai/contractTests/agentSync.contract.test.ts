/**
 * Agent Sync with a live model as the IDE agent (Lens plan §8, `keep_lens_current`): can an agent that is handed only the
 * prompt, the tool list and a `git diff -U0` use the line-range input (`changedFiles`) so that only the card whose lines
 * changed goes stale?
 *
 * The model plays the agent over a plain JSON protocol (one `{"tool","args"}` object per turn), so any connection works —
 * no native tool calling needed. Tools run against the real MCP server and the Repo Map test world (fake canvas).
 *
 * Real network calls and real money, so it only runs when asked, never in `npm run test:contract` by default:
 *
 *   ACUTE_AGENT_SYNC=1 npx vitest run --config vitest.contract.config.ts agentSync
 *
 * Provider: the first of aicredits, openrouter, openai, anthropic, azure, gemini, neevcloud with real credentials in
 * `.env.local`; or pick one with `ACUTE_AGENT_PROVIDER=<id>` (any of those, plus `copilot` or `ollama`). The model is the
 * connection's usual `ACUTE_TEST_<ID>_MODEL`. `ACUTE_AGENT_TRIALS=<n>` repeats the run (default 1) to see how stable it is.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { parseJsonReply } from "@/ai/runtime";
import type { AIProvider } from "@/ai/types";
import { resetRepoMapState } from "@/mcp/tools/repoMap";
import { call, closeWorlds, settle, world, type World } from "@/testUtils/repoMapWorld";
import { directProvider, resolveConnection } from "./liveProvider";
import { getByokCredentials, type ByokConnectionId } from "./testEnv";

const PRIORITY: ByokConnectionId[] = ["aicredits", "openrouter", "openai", "anthropic", "azure", "gemini", "neevcloud"];
const TOOLS = ["get_map_status", "get_lens_impact", "upsert_map_section", "remove_map_nodes"];
const MAX_TURNS = 6;
const RESULT_CHARS = 3_000;
const TRIALS = Math.max(1, Number(process.env.ACUTE_AGENT_TRIALS) || 1);

function pickProvider(): { id: string; provider: AIProvider } | null {
  if (process.env.ACUTE_AGENT_SYNC !== "1") return null;
  const wanted = process.env.ACUTE_AGENT_PROVIDER;
  const id = wanted ?? PRIORITY.find((p) => getByokCredentials(p));
  if (!id) return null;
  const connection = resolveConnection(id);
  return connection ? { id, provider: directProvider(id, connection) } : null;
}

const picked = pickProvider();

// Four symbols in one file, with distinct line ranges, plus a file in another module.
const section = (commit: string) => ({
  commit,
  section: { key: "mod:payments", label: "Payments", arrangement: "grid" },
  nodes: [
    { key: "sym:src/pay.ts#charge", type: "text", title: "charge()", markdown: "Charges a card.", source: { path: "src/pay.ts", lines: [10, 30] } },
    { key: "sym:src/pay.ts#refund", type: "text", title: "refund()", markdown: "Refunds a charge.", source: { path: "src/pay.ts", lines: [40, 70] } },
    { key: "sym:src/pay.ts#void", type: "text", title: "void()", markdown: "Voids a pending charge.", source: { path: "src/pay.ts", lines: [80, 100] } },
    { key: "file:src/ledger.ts", type: "text", title: "ledger.ts", markdown: "Append-only ledger.", source: { path: "src/ledger.ts", lines: [1, 120] } },
  ],
  relationships: [{ from: "sym:src/pay.ts#refund", to: "file:src/ledger.ts", type: "depends_on" }],
});

// The agent edited only refund() (lines 45-50 of src/pay.ts).
const DIFF = [
  "diff --git a/src/pay.ts b/src/pay.ts",
  "--- a/src/pay.ts",
  "+++ b/src/pay.ts",
  "@@ -45,2 +45,6 @@ export function refund(id: string) {",
  "-  return gateway.refund(id);",
  "+  const charge = findCharge(id);",
  "+  if (!charge) throw new Error('unknown charge');",
  "+  ledger.record(charge, -charge.amount);",
  "+  return gateway.refund(id);",
].join("\n");

interface Turn {
  tool: string;
  args: Record<string, unknown>;
  result: string;
}

interface Run {
  turns: Turn[];
  done: string | null;
  error?: string;
}

async function toolList(w: World) {
  const { tools } = await w.client.listTools();
  return tools
    .filter((t) => TOOLS.includes(t.name))
    .map((t) => ({ name: t.name, description: (t.description ?? "").slice(0, 700), inputSchema: t.inputSchema }));
}

async function runAgent(w: World, provider: AIProvider): Promise<Run> {
  const prompt = await w.client.getPrompt({ name: "keep_lens_current", arguments: { repo: "org/app" } });
  const playbook = (prompt.messages[0]!.content as { text: string }).text;
  const system =
    "You are a coding agent with MCP tools for the Acute-Notes architecture map. Each turn reply with ONE JSON object and nothing else: " +
    '{"tool":"<name>","args":{...}} to call a tool, or {"done":"<one-line summary>"} when finished. No markdown fences.';
  const intro =
    `Tools (JSON Schema inputs):\n${JSON.stringify(await toolList(w))}\n\nPlaybook:\n${playbook}\n\n` +
    `The map id is "org/app". You just edited the code; this is the output of \`git diff -U0\`:\n${DIFF}\n\nThe map was built at commit c1 and your edit is on top of it.`;
  const turns: Turn[] = [];
  for (let i = 0; i < MAX_TURNS; i++) {
    const transcript = turns.map((t) => `You called ${t.tool} ${JSON.stringify(t.args)}\nResult: ${t.result}`).join("\n\n");
    const res = await provider.generate({ task: "chat", systemPrompt: system, prompt: `${intro}\n\n${transcript}\n\nYour next JSON object:`, signal: AbortSignal.timeout(120_000) });
    let reply: { tool?: string; args?: Record<string, unknown>; done?: string };
    try {
      reply = parseJsonReply(res.text) as typeof reply;
    } catch {
      return { turns, done: null, error: `unparseable reply: ${res.text.slice(0, 200)}` };
    }
    if (typeof reply.done === "string") return { turns, done: reply.done };
    if (!reply.tool || !TOOLS.includes(reply.tool)) return { turns, done: null, error: `unknown tool: ${reply.tool}` };
    const out = await call(w, reply.tool, reply.args ?? {});
    const text = JSON.stringify(out.structuredContent ?? out.content).slice(0, RESULT_CHARS);
    turns.push({ tool: reply.tool, args: reply.args ?? {}, result: out.isError ? `ERROR ${text}` : text });
  }
  return { turns, done: null, error: "ran out of turns" };
}

beforeEach(() => resetRepoMapState());
afterEach(closeWorlds);

describe.skipIf(!picked)(`agent sync with a live model as the agent (${picked?.id ?? "no provider"})`, () => {
  it.each(Array.from({ length: TRIALS }, (_, i) => i + 1))(
    "trial %i: sends the diff's line ranges, so only the card whose lines changed is stale",
    async (trial) => {
      const w = await world();
      const { mapId } = (await call(w, "begin_repo_map", { repo: "org/app", commit: "c1" })).structuredContent as { mapId: string };
      await call(w, "upsert_map_section", { mapId, ...section("c1") });
      w.canvas.accept();
      await settle();

      const run = await runAgent(w, picked!.provider);
      const statusCalls = run.turns.filter((t) => t.tool === "get_map_status");
      const usedRanges = statusCalls.some((t) => {
        const files = t.args.changedFiles as { path?: string; lines?: number[][] }[] | undefined;
        return !!files?.some((f) => f.path?.endsWith("src/pay.ts") && f.lines?.some(([a, b]) => a! <= 50 && 45 <= b!));
      });
      const lastStale = [...statusCalls].reverse().map((t) => (JSON.parse(t.result.startsWith("ERROR") ? "{}" : t.result) as { stale?: string[] }).stale).find(Boolean);
      const removed = run.turns.some((t) => t.tool === "remove_map_nodes");

      console.log(
        `[agent-sync:${picked!.id}] trial ${trial}: ${run.turns.map((t) => t.tool).join(" → ") || "(no calls)"}; ` +
          `changedFiles with lines: ${usedRanges}; stale: ${JSON.stringify(lastStale)}; removed cards: ${removed}; ${run.error ?? `done: ${run.done}`}`,
      );

      // The learning being tested: an agent handed the diff uses the line ranges, and nothing else goes stale.
      expect(statusCalls.length, "the agent never called get_map_status").toBeGreaterThan(0);
      expect(usedRanges, "get_map_status was not given the diff's line ranges in changedFiles").toBe(true);
      expect(lastStale).toEqual(["sym:src/pay.ts#refund"]);
      expect(removed, "the agent removed cards for a code edit that deleted nothing").toBe(false);
    },
    600_000,
  );
});
