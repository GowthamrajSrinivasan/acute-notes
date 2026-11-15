/**
 * The citation-driven update wired into "Update from new content" (knowledge-notes-plan §6.1, WP3.1–3.3; lanes request
 * from Lane G) and the distil update's knowledge (WP1.10's request), with a mock AI. The switch stays off by default:
 * these tests turn it on through `UpdateOptions.citationUpdates` only.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ChangeSet } from "@/ai/changes/changeSet";
import { distiller } from "@/ai/fidelity/__fixtures__/knowledge/mockDistiller";
import { AIProviderManager } from "@/ai/providerManager";
import { createMockProvider } from "@/ai/providers/mock/mockProvider";
import { createAIRuntime } from "@/ai/runtime";
import { createTaskRegistry } from "@/ai/tasks";
import type { AIRequest, AIResponse } from "@/ai/types";
import { registerVisualizeTasks, resendCardsInput, resendCardsTask } from "@/ai/visualize/tasks";
import { visualizeContent } from "@/ai/visualize/visualize";
import { FIDELITY_CONFIG } from "@/config/fidelity";
import { accepted, context, parse, response, type Accepted } from "@/testUtils/reconcileHarness";
import type { UnitSet } from "@/ai/fidelity/contracts";
import { CARD_RESEND_RULE, CITATION_UPDATE_CONFIG, cardResendInput, type CardDecision } from "./citations";
import { sectionOfTopic } from "./citationUpdate";
import { updateFromNewContent, type UpdateOptions } from "./update";

const DOC = `# Caching notes

## Retries

Retries can improve reliability when the cache holds a valid result. They must stop after 3 attempts, however short the outage.

## Limits

The cache keeps at most 500 entries per tenant. Entries expire after 30 minutes. Thanks for reading.
`;

function runtimeWith(respond: (req: AIRequest) => AIResponse) {
  const manager = new AIProviderManager();
  const registry = createTaskRegistry();
  registerVisualizeTasks(registry);
  const spy = vi.fn(respond);
  manager.registerProvider(createMockProvider({ id: "mock", respond: spy }));
  manager.setPrimary("mock");
  const calls = (task: string) => spy.mock.calls.map((c) => c[0] as AIRequest).filter((r) => r.task === task);
  return { runtime: createAIRuntime({ manager, registry }), calls, spy };
}

/** A distil first run, accepted as the writer would: each card stamped with its citations, review and note model; the version with its units. */
async function distilCanvas(): Promise<{ a: Accepted; set: ChangeSet }> {
  const { runtime } = runtimeWith(distiller());
  const { changeSet } = await visualizeContent({ text: DOC, operationId: "op_1", title: "Visualize", context }, runtime, { parseMarkdown: parse });
  const a = accepted(changeSet);
  const cards = changeSet.knowledge?.cards ?? {};
  const existing = a.existing.map((o) => {
    const k = cards[o.stableNodeKey];
    return { ...o, noteModel: "distil" as const, ...(k?.sourceUnits.length ? { sourceUnits: k.sourceUnits } : {}), ...(k?.review ? { review: k.review } : {}) };
  });
  return { a: { ...a, existing, previous: { ...a.previous, units: changeSet.contentSource!.units as UnitSet } }, set: changeSet };
}

const run = (a: Accepted, text: string, respond: (req: AIRequest) => AIResponse, options: UpdateOptions = {}) => {
  const r = runtimeWith(respond);
  return { ...r, result: updateFromNewContent({ ...a, text, operationId: "op_2", title: "Update from new content", context }, r.runtime, { parseMarkdown: parse, ...options }) };
};

/** A resend reply rewriting every card it is sent (the changed passage's new wording as its body). */
const rewriteAll = (req: AIRequest): AIResponse => {
  if (req.task !== "resend_cards") return distiller()(req);
  const ids = [...req.prompt.matchAll(/^Card (c\d+)$/gm)].map((m) => m[1]!);
  const after = [...req.prompt.matchAll(/^ {2}after: (.+)$/gm)].map((m) => m[1]!);
  return response(JSON.stringify({ cards: ids.map((id, i) => ({ id, title: "Retries stop after 5 attempts", body: after[i] ?? after[0] ?? "" })) }));
};

describe("citation-driven updates (§6.1), wired behind the switch", () => {
  const initial = FIDELITY_CONFIG.noteModel;
  beforeEach(() => {
    FIDELITY_CONFIG.noteModel = "distil";
  });
  afterEach(() => {
    FIDELITY_CONFIG.noteModel = initial;
  });

  it("is off by default (R2): the section path, nothing card-level", async () => {
    expect(CITATION_UPDATE_CONFIG.enabled).toBe(false);
    const { a } = await distilCanvas();
    const { result, calls } = run(a, DOC.replace("3 attempts", "5 attempts"), rewriteAll);
    const r = await result;
    expect(r.citations).toBeUndefined();
    expect(calls("resend_cards")).toHaveLength(0);
    expect(calls("generate_visual_plan").length).toBeGreaterThan(0);
  });

  it("a changed passage: only the card citing it is resent (one call, no unit ids), the others kept without a call", async () => {
    const { a } = await distilCanvas();
    const { result, calls } = run(a, DOC.replace("3 attempts", "5 attempts"), rewriteAll, { citationUpdates: true });
    const r = await result;
    expect(r.citations).toMatchObject({ resend: 1, remove: 0 });
    expect(r.citations!.keep).toBeGreaterThan(0);
    expect(calls("generate_visual_plan")).toHaveLength(0);
    expect(calls("outline_document")).toHaveLength(0);
    const sent = calls("resend_cards");
    expect(sent).toHaveLength(1);
    expect(sent[0]!.prompt).toContain("after: They must stop after 5 attempts");
    expect(sent[0]!.prompt).not.toMatch(/\bu\d+\b/);
    const set = r.changeSet!;
    const updates = set.changes.filter((c) => c.kind === "update_block");
    expect(updates).toHaveLength(1);
    expect(set.changes.filter((c) => c.kind === "remove" || c.kind === "create_block")).toEqual([]);
    // The version records the units and lineage the cards cite; the rewritten card carries its citations after the update.
    expect(set.contentSource!.units).toBeDefined();
    expect(set.contentSource!.lineage).toMatchObject({ fromVersion: 1, toVersion: 2 });
    const key = (updates[0] as { stableNodeKey?: string }).stableNodeKey!;
    expect(set.knowledge!.cards[key]!.sourceUnits.length).toBeGreaterThan(0);
    expect(set.metadata.noteModel).toBe("distil");
  });

  it("a passage removed: the card citing only it is proposed for removal, with no model call", async () => {
    const { a } = await distilCanvas();
    const { result, spy } = run(a, DOC.replace(" Entries expire after 30 minutes.", ""), rewriteAll, { citationUpdates: true });
    const r = await result;
    expect(r.citations).toMatchObject({ remove: 1, resend: 0 });
    expect(spy).not.toHaveBeenCalled();
    expect(r.changeSet!.changes.filter((c) => c.kind === "remove")).toHaveLength(1);
  });

  it("a card the reply misses is never rewritten: it is marked “source changed” for review", async () => {
    const { a } = await distilCanvas();
    const { result } = run(a, DOC.replace("3 attempts", "5 attempts"), (req) => (req.task === "resend_cards" ? response(JSON.stringify({ cards: [] })) : distiller()(req)), { citationUpdates: true });
    const set = (await result).changeSet!;
    expect(set.changes.filter((c) => c.kind === "update_block")).toEqual([]);
    const marks = set.changes.filter((c) => c.kind === "mark_review");
    expect(marks).toHaveLength(1);
    expect((marks[0] as { review: { reasons: string[] } }).review.reasons[0]).toMatch(/source changed/);
  });

  it("an old canvas (no units on the previous version) takes the section path", async () => {
    const { a } = await distilCanvas();
    const old = { ...a, previous: { ...a.previous, units: undefined } };
    const r = await run(old, DOC.replace("3 attempts", "5 attempts"), rewriteAll, { citationUpdates: true }).result;
    expect(r.citations).toBeUndefined();
  });

  it("maps a unit topic to the section holding the longest prefix of its heading path", () => {
    const s = (key: string) => ({ key, label: key, kind: "notes" as const, prominence: "primary" as const, arrangement: "grid" as const, units: [key] });
    const sections = [s("Doc › A"), s("Doc › A › B ·1"), s("Doc › C")];
    expect(sectionOfTopic("Doc › A › B", sections)!.key).toBe("Doc › A › B ·1");
    expect(sectionOfTopic("Doc › A › Z", sections)!.key).toBe("Doc › A");
    expect(sectionOfTopic("Doc › D", sections)).toBeUndefined();
  });
});

describe("a distil update's knowledge (WP1.10's request)", () => {
  const initial = FIDELITY_CONFIG.noteModel;
  beforeEach(() => {
    FIDELITY_CONFIG.noteModel = "distil";
  });
  afterEach(() => {
    FIDELITY_CONFIG.noteModel = initial;
  });

  it("a new section's cards cite the next version's units; the set carries the units, lineage, report and the note model", async () => {
    const { a } = await distilCanvas();
    const text = `${DOC}\n## Owners\n\nThe platform team owns the cache and reviews its limits every quarter.\n`;
    const r = await run(a, text, distiller()).result;
    const set = r.changeSet!;
    expect(set.metadata.noteModel).toBe("distil");
    expect(set.contentSource!.units!.units.some((u) => /platform team/.test(u.text))).toBe(true);
    expect(set.contentSource!.lineage).toMatchObject({ fromVersion: 1, toVersion: 2 });
    const owners = set.contentSource!.units!.units.find((u) => /platform team/.test(u.text))!.id;
    expect(Object.values(set.knowledge!.cards).some((c) => c.sourceUnits.includes(owners))).toBe(true);
    expect(set.knowledge!.report).toBeDefined();
    // Accounted over the new section's units only: the unchanged sections aren't read as unaccounted.
    expect(set.knowledge!.report!.outcomes).toBeDefined();
  });

  it("in preserve, an update computes no units and stamps nothing (as before)", async () => {
    FIDELITY_CONFIG.noteModel = "preserve";
    const { a } = await distilCanvas();
    const r = await run(a, `${DOC}\n## Owners\n\nThe platform team owns the cache.\n`, distiller()).result;
    expect(r.changeSet!.contentSource!.units).toBeUndefined();
    expect(r.changeSet!.knowledge).toBeUndefined();
    expect(r.changeSet!.metadata.noteModel).toBeUndefined();
  });
});

describe("the card-level resend task (WP3.1)", () => {
  const decision: CardDecision = {
    objectId: "el_1",
    stableNodeKey: "k1",
    action: "resend",
    cites: ["u3", "u4"],
    changes: [{ unit: "u4", before: "stop after 3 attempts", after: "stop after 5 attempts" }],
    removed: [],
    ambiguous: [],
    flags: [],
  };
  const units: UnitSet = {
    nextId: 5,
    units: [
      { id: "u3", kind: "sentence", text: "Retries help.", hash: "h3", topic: "Doc › Retries", span: { start: 0, end: 1 } },
      { id: "u4", kind: "sentence", text: "stop after 5 attempts", hash: "h4", topic: "Doc › Retries", span: { start: 1, end: 2 } },
    ],
  };

  it("sends local ids and passage text only, never unit ids or the object map", () => {
    const input = cardResendInput("Retries", [decision], units, () => ({ title: "Retries", body: "Stop after 3 attempts." }));
    const { objectOf, ...sent } = input;
    expect(objectOf).toEqual({ c1: "el_1" });
    const parsed = resendCardsInput.parse(sent);
    expect(Object.keys(parsed)).not.toContain("objectOf");
    const prompt = resendCardsTask.buildPrompt({ input: parsed });
    const text = `${prompt.systemPrompt ?? ""}\n${prompt.prompt}`;
    expect(text).toContain(CARD_RESEND_RULE.split("\n")[0]!);
    expect(text).toContain("Card c1");
    expect(text).toContain("after: stop after 5 attempts");
    expect(text).not.toMatch(/\bu\d+\b/);
    expect(text).not.toContain("el_1");
  });
});
