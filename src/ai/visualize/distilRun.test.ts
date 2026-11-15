/**
 * Knowledge Notes WP1.10–1.11 with a mock AI: in distil mode (`FIDELITY_CONFIG.noteModel`, a developer setting until
 * R1) each section is labelled with the whole document's units, its reply's citations and omissions are read, the
 * checks run (accounting, exactness; the meaning rules as hints only), ONE retry per section merges their reasons, the
 * better reply is kept, the safety net attaches nothing, and the run's knowledge reaches the change set, the objects'
 * metadata and the dev hook. The model check runs on every citing card while `FIDELITY_CONFIG.semanticCheck` is on (OD5b).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { knowledgeOf, parseChangeSet } from "@/ai/changes/changeSet";
import { cardNeedsReview } from "@/ai/fidelity/contracts";
import { knowledgeRunOf } from "@/ai/fidelity/knowledgeRun";
import { distiller, type DistillerOptions } from "@/ai/fidelity/__fixtures__/knowledge/mockDistiller";
import { AIProviderManager } from "@/ai/providerManager";
import { createMockProvider } from "@/ai/providers/mock/mockProvider";
import { createAIRuntime } from "@/ai/runtime";
import { createTaskRegistry } from "@/ai/tasks";
import type { AIRequest } from "@/ai/types";
import { FIDELITY_CONFIG } from "@/config/fidelity";
import { visualizeOutlined } from "./outlined";
import { registerVisualizeTasks } from "./tasks";
import { visualizeContent } from "./visualize";

const context = { existing: [], viewport: { x: 0, y: 0, width: 1600, height: 900 } };
const parse = (md: string) => [{ type: "paragraph" as const, content: md }];

const DOC = `# Caching notes

## Retries

Retries can improve reliability when the cache holds a valid result. They must stop after 3 attempts, however short the outage.

## Limits

The cache keeps at most 500 entries per tenant. Entries expire after 30 minutes. Thanks for reading.
`;

function runtimeWith(options: DistillerOptions = {}, check?: Parameters<typeof distiller>[1]) {
  const manager = new AIProviderManager();
  const registry = createTaskRegistry();
  registerVisualizeTasks(registry);
  const spy = vi.fn(distiller(options, check));
  manager.registerProvider(createMockProvider({ id: "mock", respond: spy }));
  manager.setPrimary("mock");
  const calls = (task: string) => spy.mock.calls.map((c) => c[0] as AIRequest).filter((r) => r.task === task);
  return { runtime: createAIRuntime({ manager, registry }), calls };
}

const units = [
  { key: "u1", text: "## Retries\n\nRetries can improve reliability when the cache holds a valid result. They must stop after 3 attempts, however short the outage.", span: { start: 0, end: 1 } },
  { key: "u2", text: "## Limits\n\nThe cache keeps at most 500 entries per tenant. Entries expire after 30 minutes. Thanks for reading.", span: { start: 1, end: 2 } },
];

describe("distil runs (WP1.10–1.11, mock AI)", () => {
  const initial = { noteModel: FIDELITY_CONFIG.noteModel, semanticCheck: { ...FIDELITY_CONFIG.semanticCheck } };
  beforeEach(() => {
    FIDELITY_CONFIG.noteModel = "distil";
  });
  afterEach(() => {
    FIDELITY_CONFIG.noteModel = initial.noteModel;
    FIDELITY_CONFIG.semanticCheck = { ...initial.semanticCheck };
  });

  it("labels every section with the whole document's unit ids, reads citations and omissions, and attaches no source copies", async () => {
    const { runtime, calls } = runtimeWith();
    const result = await visualizeOutlined(units, runtime);
    // Two sections, one set of ids: the second section's first unit is u3, not a section-local u1.
    const k = result.knowledge!;
    expect(k.units.units.map((u) => u.id)).toEqual(["u1", "u2", "u3", "u4", "u5"]);
    expect(k.sections.map((s) => s.units)).toEqual([
      ["u1", "u2"],
      ["u3", "u4", "u5"],
    ]);
    // Node ids as the merged plan has them, citations already unit ids.
    expect(k.sections[1]!.ideas.find((i) => i.cites.includes("u3"))!.id).toMatch(/^u1_n\d+$/);
    expect(k.sections[1]!.omitted).toEqual([{ unit: "u5", reason: "filler" }]);
    // No retry needed, no source copies (the safety net is off in distil), coverage still measured as a diagnostic.
    expect(calls("generate_visual_plan")).toHaveLength(2);
    expect(JSON.stringify(result.raw)).not.toMatch(/Also in the source|Source details/);
    expect(result.fidelity.addedFromSource).toBe(0);
    expect(result.fidelity.units).toBeGreaterThan(0);
    expect(k.sections.every((s) => s.needsReview === 0)).toBe(true);
    // The model check runs on every citing card in distil mode (OD5b): one batched call per section.
    expect(calls("check_card_meaning")).toHaveLength(2);
  });

  it("one retry per section merges the exactness and coverage reasons, and keeps the better reply", async () => {
    // First attempt: the caveat is omitted ("must stop after 3 attempts…") and "500" is written wrong; the retry is faithful.
    const { runtime, calls } = runtimeWith({ omitCritical: /must stop/, changeNumberIn: /at most 500/ });
    const result = await visualizeOutlined(units, runtime);
    const plans = calls("generate_visual_plan");
    expect(plans).toHaveLength(4); // two sections, one retry each
    const retries = plans.filter((r) => r.prompt.includes("An earlier plan of this section had these problems"));
    expect(retries).toHaveLength(2);
    // "They must stop after 3 attempts…" is a requirement with a protected detail: omitted, it would be put back, so it is asked for.
    expect(retries.some((r) => /P1\.2 was omitted, but it holds details that must stay exact \("3"\)/.test(r.prompt))).toBe(true);
    expect(retries.some((r) => /"500" \(P1\.1\) is missing/.test(r.prompt))).toBe(true);
    // The meaning hints ride along on a retry that happens anyway.
    expect(retries.some((r) => /Check node "n1" against the passages it cites \(an automatic check suggests/.test(r.prompt))).toBe(true);
    const k = result.knowledge!;
    expect(k.sections.map((s) => s.retry)).toEqual([
      { kind: "full", kept: true },
      { kind: "full", kept: true },
    ]);
    expect(k.sections.every((s) => s.needsReview === 0 && s.restored.items.length === 0)).toBe(true);
  });

  it("a retry that is no better is dropped; a protected detail still missing goes back as a \"From the source\" line", async () => {
    const { runtime, calls } = runtimeWith({ changeNumberIn: /at most 500/, persistent: true });
    const result = await visualizeOutlined(units, runtime);
    expect(calls("generate_visual_plan")).toHaveLength(3); // only the Limits section retries, once
    const limits = result.knowledge!.sections[1]!;
    expect(limits.retry).toEqual({ kind: "full", kept: false });
    expect(limits.restored.items).toEqual(["500"]);
    expect(JSON.stringify(result.raw)).toContain("**From the source:** 500");
    // Restored, so nothing protected is missing at the end, and nothing is left for review.
    expect(limits.needsReview).toBe(0);
  });

  it("the meaning rules are hints only: they never cost a retry or put a card in Needs review on their own", async () => {
    const { runtime, calls } = runtimeWith({ addAbsoluteIn: /expire after/ });
    const result = await visualizeOutlined(units, runtime);
    expect(calls("generate_visual_plan")).toHaveLength(2);
    const limits = result.knowledge!.sections[1]!;
    expect(limits.hints.map((h) => h.code)).toContain("absolute_added");
    expect(limits.needsReview).toBe(0);
    expect(Object.values(limits.reviews).some(cardNeedsReview)).toBe(false);
  });

  it("a card citing nothing is Needs review; the retry asks for its citations", async () => {
    const { runtime, calls } = runtimeWith({ uncitedIn: /expire after/, persistent: true });
    const result = await visualizeOutlined(units, runtime);
    expect(calls("generate_visual_plan").filter((r) => /Node "n2" cites no source unit/.test(r.prompt))).toHaveLength(1);
    const limits = result.knowledge!.sections[1]!;
    expect(limits.flags.map((f) => f.code)).toContain("uncited_card");
    expect(Object.values(limits.reviews).filter(cardNeedsReview)).toHaveLength(1);
  });

  describe("the model check (FIDELITY_CONFIG.semanticCheck, OD5 / OD5b)", () => {
    it("is on by default for every citing card (OD5b, approved 2026-10-20); off, no call whatever the hints", async () => {
      expect(FIDELITY_CONFIG.semanticCheck).toEqual({ enabled: true, cards: "all" });
      FIDELITY_CONFIG.semanticCheck = { enabled: false, cards: "all" };
      const { runtime, calls } = runtimeWith({ addAbsoluteIn: /expire after/ });
      await visualizeOutlined(units, runtime);
      expect(calls("check_card_meaning")).toHaveLength(0);
    });

    it("on: one batched call per section with hinted cards; \"supported\" reads checked by AI, the rest stay in Needs review", async () => {
      FIDELITY_CONFIG.semanticCheck = { enabled: true, cards: "flagged" };
      // `persistent`: the retry keeps the planted absolutes, so its cards are the same and the check isn't asked again.
      const { runtime, calls } = runtimeWith({ addAbsoluteIn: /expire after|keeps at most/, persistent: true }, (item) =>
        item.card.includes("expire") ? { verdict: "not_supported", reason: "The source does not say it always holds." } : { verdict: "supported", reason: "" },
      );
      const result = await visualizeOutlined(units, runtime);
      const checks = calls("check_card_meaning");
      expect(checks).toHaveLength(1); // only the Limits section has hinted cards; the unchanged retry is never re-checked
      expect(checks[0]!.prompt.match(/^ITEM c\d+$/gm)).toHaveLength(2);
      // The check runs before the one retry: its finding is one of the retry's reasons.
      const retry = calls("generate_visual_plan").find((r) => r.prompt.includes("An earlier plan of this section had these problems"))!;
      expect(retry.prompt).toContain("is not supported by the passages it cites: The source does not say it always holds.");
      const reviews = Object.values(result.knowledge!.sections[1]!.reviews);
      const supported = reviews.find((r) => r.checked?.verdict === "supported")!;
      expect(cardNeedsReview(supported)).toBe(false);
      expect(supported.hints?.length).toBeGreaterThan(0);
      const not = reviews.find((r) => r.checked?.verdict === "not_supported")!;
      expect(cardNeedsReview(not)).toBe(true);
      expect(not.reasons.join(" ")).toMatch(/^checked by AI: not supported: The source does not say it always holds\./);
      // Never "verified" or "correct" (§3.4).
      expect(JSON.stringify(result.knowledge)).not.toMatch(/verified|correct\b/i);
      expect(result.knowledge!.sections[1]!.checked).toEqual({ cards: 2, supported: 1, partly: 0, notSupported: 1, unanswered: 0 });
    });

    it("a retry that fixes what the check found is kept; only the cards it changed are checked again", async () => {
      FIDELITY_CONFIG.semanticCheck = { enabled: true, cards: "all" };
      const { runtime, calls } = runtimeWith({ addAbsoluteIn: /expire after/ }, (item) =>
        /always holds/i.test(item.card) ? { verdict: "not_supported", reason: "The source does not say it always holds." } : { verdict: "supported", reason: "" },
      );
      const result = await visualizeOutlined(units, runtime);
      const limits = result.knowledge!.sections[1]!;
      expect(limits.retry).toEqual({ kind: "full", kept: true });
      expect(limits.needsReview).toBe(0);
      expect(JSON.stringify(result.raw)).not.toMatch(/always holds/i);
      // One check per section before the retry, then the Limits section's changed card alone.
      const checks = calls("check_card_meaning");
      expect(checks).toHaveLength(3);
      expect(checks.at(-1)!.prompt.match(/^ITEM c\d+$/gm)).toHaveLength(1);
      expect(checks.at(-1)!.prompt).toContain("expire after 30 minutes");
    });

    it("an unanswered card is never supported; \"all\" checks every citing card (OD5b)", async () => {
      FIDELITY_CONFIG.semanticCheck = { enabled: true, cards: "all" };
      const { runtime, calls } = runtimeWith({}, () => ({ verdict: "maybe" }));
      const result = await visualizeOutlined(units, runtime);
      expect(calls("check_card_meaning")).toHaveLength(2);
      const reviews = result.knowledge!.sections.flatMap((s) => Object.values(s.reviews));
      expect(reviews.length).toBeGreaterThan(0);
      expect(reviews.every((r) => cardNeedsReview(r) && r.reasons.includes("checked by AI: no answer for this card"))).toBe(true);
    });
  });

  it("the analysis patch prompt drops \"in its own words, nothing left out\" in distil", async () => {
    const manager = new AIProviderManager();
    const registry = createTaskRegistry();
    registerVisualizeTasks(registry);
    const base = distiller();
    const spy = vi.fn((req: AIRequest) => {
      // A reply with no takeaway: the analysis check asks the small patch call for one.
      if (req.task === "generate_visual_plan") {
        const reply = JSON.parse(base(req).text) as { metadata: Record<string, unknown> };
        delete reply.metadata.takeaway;
        return { ...base(req), text: JSON.stringify(reply) };
      }
      return base(req);
    });
    manager.registerProvider(createMockProvider({ id: "mock", respond: spy }));
    manager.setPrimary("mock");
    await visualizeOutlined([units[0]!], createAIRuntime({ manager, registry }));
    const patch = spy.mock.calls.map((c) => c[0] as AIRequest).find((r) => r.task === "generate_section_analysis")!;
    expect(patch.prompt).toContain("The content's ideas stay on their cards above.");
    expect(patch.prompt).not.toContain("in its own words, nothing left out");
  });

  it("visualizeContent: noteModel on the set, the version's units on its source, citations and reviews by stable key, and the run for the dev hook", async () => {
    const { runtime } = runtimeWith({ uncitedIn: /expire after/, persistent: true });
    const { changeSet } = await visualizeContent({ text: DOC, operationId: "op_distil", title: "Visualize", context, forceAI: true }, runtime, { parseMarkdown: parse });
    expect(changeSet.metadata.noteModel).toBe("distil");
    const units = changeSet.contentSource!.units!;
    expect(units.units.length).toBe(5);
    const cards = changeSet.knowledge!.cards;
    const cited = Object.values(cards).flatMap((c) => c.sourceUnits);
    // u4's card cites nothing (planted), so u4 is cited by no card.
    expect(new Set(cited)).toEqual(new Set(["u1", "u2", "u3"]));
    // Every key names a change the writer stamps.
    const keys = new Set(changeSet.changes.flatMap((c) => ("stableNodeKey" in c && c.stableNodeKey ? [c.stableNodeKey] : [])));
    for (const key of Object.keys(cards)) expect(keys.has(key)).toBe(true);
    // (Cards the model check answered "supported" carry a review too, with no reasons: "checked by AI".)
    const flagged = Object.entries(cards).find(([, c]) => c.review?.reasons.length);
    expect(flagged![1].review!.reasons).toEqual(["the card cites no passage of the source"]);
    expect(knowledgeOf(changeSet, flagged![0])).toEqual({ review: flagged![1].review });
    // Report v2 rides along; the set survives validation with it.
    expect(changeSet.knowledge!.report).toMatchObject({ units: 5, outcomes: { omitted: 1 }, cards: { needsReview: 1 } });
    const parsed = parseChangeSet(changeSet);
    expect(parsed.knowledge).toEqual(changeSet.knowledge);
    expect(parsed.metadata.noteModel).toBe("distil");
    // The dev hook's output: the run without its plan.
    const run = knowledgeRunOf(changeSet.contentSource!.sourceId)!;
    expect(run).not.toHaveProperty("plan");
    expect(run.noteModel).toBe("distil");
    expect(run.units).toEqual(units);
    const planIds = new Set((changeSet.contentSource!.plan as { nodes: { id: string }[] }).nodes.map((n) => n.id));
    for (const id of Object.keys(run.cites!)) expect(planIds.has(id)).toBe(true);
    expect(run.accounting!.outcome.u5).toBe("omitted");
    expect(run.flags!.some((f) => f.code === "uncited_card")).toBe(true);
  });

  it("preserve (the default) is untouched: no knowledge, no noteModel, the safety net attaches, and no run for the hook", async () => {
    FIDELITY_CONFIG.noteModel = "preserve";
    const { runtime } = runtimeWith();
    const { changeSet } = await visualizeContent({ text: DOC, operationId: "op_preserve", title: "Visualize", context, forceAI: true }, runtime, { parseMarkdown: parse });
    expect(changeSet.knowledge).toBeUndefined();
    expect(changeSet.metadata).not.toHaveProperty("noteModel");
    expect(changeSet.contentSource!.units).toBeUndefined();
    expect(knowledgeRunOf(changeSet.contentSource!.sourceId)).toBeNull();
  });
});
