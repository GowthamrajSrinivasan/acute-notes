/**
 * Distil quality fix 3 of 2026-10-20 (2), through the section pipeline with a mock AI (no model is called): a condition
 * or caveat the cards drop is named verbatim, with the card it belongs on, in the section's one retry; if the retry still
 * drops it, it goes on that card as a "Limit:" line from the source and the unit is `restored`. With the model check on
 * (the default, OD5b), the line goes back only on a card the check didn't call "supported" (a supported card's
 * rewording is a paraphrase the word rule missed, live 2026-10-20), and that card is checked again with its line. Run with
 * the mock distiller and with the live replies recorded on 2026-10-20 (fixture 8, run 2: the recorded first reply and
 * the recorded retry, then a mocked second reply that keeps the caveat).
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { distiller, outlineReply, type DistillerOptions } from "@/ai/fidelity/__fixtures__/knowledge/mockDistiller";
import { knowledgeRunOf } from "@/ai/fidelity/knowledgeRun";
import { AIProviderManager } from "@/ai/providerManager";
import { createMockProvider } from "@/ai/providers/mock/mockProvider";
import { createAIRuntime } from "@/ai/runtime";
import { createTaskRegistry } from "@/ai/tasks";
import type { AIRequest, AIResponse } from "@/ai/types";
import { FIDELITY_CONFIG } from "@/config/fidelity";
import { visualizeOutlined } from "./outlined";
import { registerVisualizeTasks } from "./tasks";
import { visualizeContent } from "./visualize";

const RETRY_MARK = "An earlier plan of this section had these problems";
const DOC = `# Caching notes

## Retries

Retries can improve reliability when the cache holds a valid result. They must stop after 3 attempts, however short the outage.

## Limits

The cache keeps at most 500 entries per tenant. Entries expire after 30 minutes. Thanks for reading.
`;
const units = [{ key: "u1", text: "## Retries\n\nRetries can improve reliability when the cache holds a valid result. Thanks for reading.", span: { start: 0, end: 1 } }];

function runtimeOf(respond: (req: AIRequest) => AIResponse) {
  const manager = new AIProviderManager();
  const registry = createTaskRegistry();
  registerVisualizeTasks(registry);
  const spy = vi.fn(respond);
  manager.registerProvider(createMockProvider({ id: "mock", respond: spy }));
  manager.setPrimary("mock");
  const calls = (task: string) => spy.mock.calls.map((c) => c[0] as AIRequest).filter((r) => r.task === task);
  return { runtime: createAIRuntime({ manager, registry }), calls };
}
const mock = (options: DistillerOptions, check?: Parameters<typeof distiller>[1]) => runtimeOf(distiller(options, check));

describe("dropped conditions: the retry names them, the \"Limit:\" line is the fallback (mock AI)", () => {
  const initial = FIDELITY_CONFIG.noteModel;
  beforeEach(() => {
    FIDELITY_CONFIG.noteModel = "distil";
  });
  afterEach(() => {
    FIDELITY_CONFIG.noteModel = initial;
  });

  it("the one retry asks for the dropped condition word for word, on its card, and a faithful retry is kept", async () => {
    const { runtime, calls } = mock({ dropConditionIn: /when the cache holds/ });
    const result = await visualizeOutlined(units, runtime);
    const retry = calls("generate_visual_plan").find((r) => r.prompt.includes(RETRY_MARK))!;
    expect(retry.prompt).toContain(`- Put "when the cache holds a valid result" (P1.1) on card "Retries can improve reliability": it is the condition of that card's claim`);
    const k = result.knowledge!.sections[0]!;
    expect(k.retry).toEqual({ kind: "full", kept: true });
    expect(k.restored.limits).toBeUndefined();
    expect(k.flags).toEqual([]);
    expect(JSON.stringify(result.raw)).not.toContain("Limit:");
  });

  it("a retry that still drops it, on a card the check calls partly supported: the condition goes on the card as a \"Limit:\" line, the unit is restored, the card is checked again with it", async () => {
    // "Partly" while the card lacks the condition; "supported" once it carries it.
    const { runtime, calls } = mock({ dropConditionIn: /when the cache holds/, persistent: true }, (item) =>
      item.card.includes("improve reliability") && !/when the cache holds/i.test(item.card) ? { verdict: "partly", reason: "The source limits it to a valid cached result." } : { verdict: "supported", reason: "" },
    );
    const { changeSet } = await visualizeContent({ text: DOC, operationId: "op_limit", title: "Visualize", context, forceAI: true }, runtime, { parseMarkdown: parse });
    expect(JSON.stringify(changeSet)).toContain("**Limit:** When the cache holds a valid result");
    const run = knowledgeRunOf(changeSet.contentSource!.sourceId)!;
    const u = run.units!.units.find((x) => x.text.startsWith("Retries can improve"))!;
    expect(run.accounting!.state[u.id]).toBe("restored");
    expect(run.accounting!.outcome[u.id]).toBe("represented");
    expect(run.flags!.filter((f) => f.code === "critical_dropped")).toEqual([]);
    expect(changeSet.knowledge!.report!.restored).toMatchObject({ limits: 1 });
    // The model check judged the card the reader sees: with its "Limit:" line (asked again about that card only).
    const checks = calls("check_card_meaning");
    expect(checks.some((r) => r.prompt.includes("**Limit:** When the cache holds a valid result"))).toBe(true);
    expect(checks.at(-1)!.prompt.match(/^ITEM c\d+$/gm)).toHaveLength(1);
    expect(changeSet.knowledge!.report!.cards.needsReview).toBe(0);
  });

  it("a retry that still drops it, on a card the check calls supported: no \"Limit:\" line (a paraphrase the word rule missed); the unit is Represented", async () => {
    const { runtime } = mock({ dropConditionIn: /when the cache holds/, persistent: true });
    const { changeSet } = await visualizeContent({ text: DOC, operationId: "op_limit_ok", title: "Visualize", context, forceAI: true }, runtime, { parseMarkdown: parse });
    expect(JSON.stringify(changeSet)).not.toContain("Limit:");
    const run = knowledgeRunOf(changeSet.contentSource!.sourceId)!;
    const u = run.units!.units.find((x) => x.text.startsWith("Retries can improve"))!;
    expect(run.accounting!.outcome[u.id]).toBe("represented");
    expect(run.flags!.filter((f) => f.code === "critical_dropped")).toEqual([]);
    expect(changeSet.knowledge!.report!.restored.limits ?? 0).toBe(0);
  });

  it("with the model check off, the \"Limit:\" line goes back as before", async () => {
    const saved = { ...FIDELITY_CONFIG.semanticCheck };
    FIDELITY_CONFIG.semanticCheck = { ...saved, enabled: false };
    try {
      const { runtime, calls } = mock({ dropConditionIn: /when the cache holds/, persistent: true });
      const { changeSet } = await visualizeContent({ text: DOC, operationId: "op_limit_off", title: "Visualize", context, forceAI: true }, runtime, { parseMarkdown: parse });
      expect(JSON.stringify(changeSet)).toContain("**Limit:** When the cache holds a valid result");
      expect(calls("check_card_meaning")).toHaveLength(0);
    } finally {
      FIDELITY_CONFIG.semanticCheck = saved;
    }
  });
});

const context = { existing: [], viewport: { x: 0, y: 0, width: 1600, height: 900 } };
const parse = (md: string) => [{ type: "paragraph" as const, content: md }];

describe("replayed live replies (fixture 8, run 2, 2026-10-20): the recorded first reply, then the recorded retry or a mocked one", () => {
  const FX = JSON.parse(readFileSync(join(fileURLToPath(new URL(".", import.meta.url)), "../fidelity/__fixtures__/knowledge/live/f08-run2-limitations.json"), "utf8")) as {
    section: string;
    reply: unknown;
    retryReply: unknown;
    recordedRetryReasons: string;
  };
  /** The model check's verdict per card text (default: every card "supported", as the live check answered these cards). */
  type Verdict = (card: string) => { verdict: string; reason: string };
  const supported: Verdict = () => ({ verdict: "supported", reason: "" });
  const respondWith = (second: unknown, verdictOf: Verdict = supported) => (req: AIRequest): AIResponse => {
    const text = (v: unknown) => ({ text: typeof v === "string" ? v : JSON.stringify(v), model: "replay", finishReason: "stop" as const, usage: { provider: "mock", model: "replay", promptTokens: 1, completionTokens: 1 } });
    if (req.task === "outline_document") return text(outlineReply(req.prompt));
    if (req.task === "generate_visual_plan") return text(req.prompt.includes(RETRY_MARK) ? second : FX.reply);
    if (req.task === "check_card_meaning") {
      const items = [...req.prompt.matchAll(/ITEM (c\d+)\nSOURCE: [\s\S]*?\nCARD: ([\s\S]*?)(?=\n\nITEM c\d+\n|$)/g)].map((m) => ({ ref: m[1]!, card: m[2]! }));
      return text({ results: items.map((i) => ({ ref: i.ref, ...verdictOf(i.card) })) });
    }
    if (req.task === "find_revisions") return text({ revisions: [] });
    return text({ takeaway: "Limits of the analysis", nodes: [], relationships: [] });
  };
  const section = [{ key: "u1", text: "", span: { start: 0, end: 1 } }];
  const initial = FIDELITY_CONFIG.noteModel;
  beforeEach(() => {
    FIDELITY_CONFIG.noteModel = "distil";
    section[0]!.text = FX.section;
  });
  afterEach(() => {
    FIDELITY_CONFIG.noteModel = initial;
  });

  it("the retry now names the caveat in full, on its card by title (the recorded retry named node ids and cut the clause)", async () => {
    expect(FX.recordedRetryReasons).toContain('Node "n2" cites P1.2, but drops the caveat "However the caching argument only applies if the CI runners keep a shared cache, which ours do not');
    const { runtime, calls } = runtimeOf(respondWith(FX.retryReply));
    await visualizeOutlined(section, runtime);
    const retry = calls("generate_visual_plan").find((r) => r.prompt.includes(RETRY_MARK))!;
    expect(retry.prompt).toContain(
      `- Put "However the caching argument only applies if the CI runners keep a shared cache, which ours do not today" (P1.2) on card "CI Caching Limitation": it is the caveat of that card's claim`,
    );
    expect(retry.prompt).toContain(`- Put "does not hold for libraries that ship on their own schedule" (P1.1) on card "Release Schedule Assumption"`);
    // The nested "do not" is part of the caveat, not a clause of its own.
    expect(retry.prompt).not.toMatch(/Put "do not today"/);
  });

  it("the recorded retry words the caveat its own way, and the check calls it supported (as live): no \"Limit:\" line, nothing in review", async () => {
    const { runtime } = runtimeOf(respondWith(FX.retryReply));
    const result = await visualizeOutlined(section, runtime);
    const k = result.knowledge!.sections[0]!;
    expect(k.retry?.kind).toBe("full");
    expect(k.restored.limits).toBeUndefined();
    expect(JSON.stringify(result.raw)).not.toContain("Limit:");
    expect(k.flags.filter((f) => f.code === "critical_dropped")).toEqual([]);
    expect(k.needsReview).toBe(0);
  });

  it("the same, with the check calling the caching card partly supported: the caveat goes back on it as a \"Limit:\" line, and it is checked again", async () => {
    const partlyUntilLimit: Verdict = (card) =>
      /shared cache/i.test(card) && !card.includes("Limit:") ? { verdict: "partly", reason: "It drops that the argument depends on a shared cache." } : { verdict: "supported", reason: "" };
    const { runtime, calls } = runtimeOf(respondWith(FX.retryReply, partlyUntilLimit));
    const result = await visualizeOutlined(section, runtime);
    const k = result.knowledge!.sections[0]!;
    expect(k.restored.limits?.length).toBeGreaterThan(0);
    expect(JSON.stringify(result.raw)).toContain("**Limit:** However the caching argument only applies if the CI runners keep a shared cache, which ours do not today");
    expect(calls("check_card_meaning").at(-1)!.prompt).toContain("**Limit:** However the caching argument");
    expect(k.flags.filter((f) => f.code === "critical_dropped")).toEqual([]);
    expect(k.needsReview).toBe(0);
  });

  it("a mocked second reply that keeps both caveats: kept, nothing put back", async () => {
    const fixed = {
      version: 1,
      template: "sectioned",
      nodes: [
        { id: "n1", type: "text", title: "Assumes a joint release", content: { markdown: "The comparison assumes the packages are released together; it does not hold for libraries that ship on their own schedule." }, cites: ["P1.1"] },
        { id: "n2", type: "text", title: "Caching needs a shared CI cache", content: { markdown: "The caching argument only applies if the CI runners keep a shared cache, which ours do not today." }, cites: ["P1.2"] },
        { id: "a1", type: "text", origin: "analysis", title: "What limits the analysis", content: { markdown: "Both limits narrow where the monorepo case holds." } },
      ],
      relationships: [],
      metadata: { takeaway: "The case holds for jointly released packages, and caching only helps with a shared CI cache.", omitted: [] },
    };
    const { runtime } = runtimeOf(respondWith(fixed));
    const result = await visualizeOutlined(section, runtime);
    const k = result.knowledge!.sections[0]!;
    expect(k.retry).toEqual({ kind: "full", kept: true });
    expect(k.restored.limits).toBeUndefined();
    expect(k.flags).toEqual([]);
    expect(JSON.stringify(result.raw)).not.toContain("Limit:");
  });
});
