import { describe, expect, it, vi } from "vitest";
import type { DecisionAnswer, DecisionRequest } from "@/ai/decisions/types";
import { AIProviderManager } from "@/ai/providerManager";
import { createMockProvider } from "@/ai/providers/mock/mockProvider";
import { createAIRuntime } from "@/ai/runtime";
import { createTaskRegistry } from "@/ai/tasks";
import type { AIRequest } from "@/ai/types";
import { detectRevisions, findRevisionsDecision, registerRevisionTasks, revisionCandidates, validateRevisions, withoutRevised, type RevisionInput } from "./revisions";

const STORAGE = "## Storage\n\nWe store every workspace in Firestore. Attachments stay as blobs. Actually, we switched to Postgres for workspaces.";
const PLAIN = "## AI access\n\nUsers bring their own AI. The app never ships a model key.";
const input: RevisionInput = { units: [{ key: "Doc › Storage", text: STORAGE }] };

describe("revisionCandidates — the free gate", () => {
  it("asks only about sections with a revision cue and at least two statements", () => {
    expect(revisionCandidates([{ key: "a", text: STORAGE }, { key: "b", text: PLAIN }, { key: "c", text: "Actually, yes." }]).map((u) => u.key)).toEqual(["a"]);
  });
});

describe("validateRevisions — quotes checked word for word, replaced one first", () => {
  it("keeps an exact pair, as the text has it", () => {
    const r = validateRevisions({ revisions: [{ section: "u1", earlier: "We store every workspace in Firestore", later: "Actually, we switched to Postgres for workspaces." }] }, input);
    expect(r).toEqual([{ unit: "Doc › Storage", earlier: "We store every workspace in Firestore.", later: "Actually, we switched to Postgres for workspaces." }]);
  });

  it("drops a misquote, a pair in the wrong order, a pair of one statement, and an unknown section", () => {
    const bad = [
      { section: "u1", earlier: "We store everything in Mongo.", later: "Actually, we switched to Postgres for workspaces." },
      { section: "u1", earlier: "Actually, we switched to Postgres for workspaces.", later: "We store every workspace in Firestore." },
      { section: "u1", earlier: "Attachments stay as blobs.", later: "Attachments stay as blobs." },
      { section: "u9", earlier: "We store every workspace in Firestore.", later: "Actually, we switched to Postgres for workspaces." },
    ];
    expect(validateRevisions({ revisions: bad }, input)).toEqual([]);
  });
});

describe("withoutRevised — what the model sees", () => {
  it("leaves the replaced statement out; the rest, and the replacing one, stay", () => {
    expect(withoutRevised(STORAGE, [{ earlier: "We store every workspace in Firestore." }])).toBe("## Storage\n\nAttachments stay as blobs. Actually, we switched to Postgres for workspaces.");
  });

  it("removes a replaced list item with its marker", () => {
    const list = "## Plan\n\n- Ship in March.\n- Two engineers.\n- Update: ship in April.\n";
    expect(withoutRevised(list, [{ earlier: "Ship in March." }])).toBe("## Plan\n\n- Two engineers.\n- Update: ship in April.\n");
  });
});

const flag = (p: number): DecisionAnswer => ({ type: "boolean", probability: p });
const pick = (value: string, confidence = 0.9): DecisionAnswer => ({ type: "choice", choice: value, confidence, probabilities: {} });

describe("findRevisionsDecision — the typed model picks the statements", () => {
  it("round two asks, per later statement, which earlier one it replaces (or none)", () => {
    const requests = findRevisionsDecision.followUp!({ u1_revises: flag(0.9) }, input) as DecisionRequest[];
    const q = requests[0]!.questions;
    expect(Object.keys(q)).toEqual(["u1_s1_replaces", "u1_s2_replaces"]);
    const last = q.u1_s2_replaces!;
    expect(last.type === "choice" && last.choices.map((c) => c.value)).toEqual(["u1.s0", "u1.s1", "none"]);
  });

  it("no round two for a section that doesn't change its mind", () => {
    expect(findRevisionsDecision.followUp!({ u1_revises: flag(0.2) }, input)).toBeNull();
    expect(findRevisionsDecision.interpret({ u1_revises: flag(0.2) }, input)).toEqual({ revisions: [] });
  });

  it("confident picks become exact pairs, which validateRevisions accepts as they are", () => {
    const reply = findRevisionsDecision.interpret({ u1_revises: flag(0.9), u1_s1_replaces: pick("none"), u1_s2_replaces: pick("u1.s0") }, input);
    expect(validateRevisions(reply, input)).toEqual([{ unit: "Doc › Storage", earlier: "We store every workspace in Firestore.", later: "Actually, we switched to Postgres for workspaces." }]);
  });

  it("unsure, or inconsistent, gives the question to the chat task (null)", () => {
    expect(findRevisionsDecision.interpret({ u1_revises: flag(0.9), u1_s1_replaces: pick("none"), u1_s2_replaces: pick("u1.s0", 0.5) }, input)).toBeNull();
    expect(findRevisionsDecision.interpret({ u1_revises: flag(0.9), u1_s1_replaces: pick("none"), u1_s2_replaces: pick("none") }, input)).toBeNull();
    expect(findRevisionsDecision.interpret({ u1_revises: flag(0.9) }, input)).toBeNull();
  });
});

describe("detectRevisions — the whole step", () => {
  function runtime(reply: string) {
    const manager = new AIProviderManager();
    const registry = createTaskRegistry();
    registerRevisionTasks(registry);
    const spy = vi.fn((req: AIRequest) => ({ text: req.task === "find_revisions" ? reply : "{}", model: "m", finishReason: "stop" as const, usage: { provider: "mock", model: "m" } }));
    manager.registerProvider(createMockProvider({ id: "mock", respond: spy }));
    manager.setPrimary("mock");
    return { runtime: createAIRuntime({ manager, registry }), spy };
  }

  it("asks only about the gated sections, and returns the checked pairs", async () => {
    const { runtime: rt, spy } = runtime(JSON.stringify({ revisions: [{ section: "u1", earlier: "We store every workspace in Firestore.", later: "Actually, we switched to Postgres for workspaces." }] }));
    const r = await detectRevisions(rt, [{ key: "Doc › Storage", text: STORAGE }, { key: "Doc › AI access", text: PLAIN }]);
    expect(r).toEqual([{ unit: "Doc › Storage", earlier: "We store every workspace in Firestore.", later: "Actually, we switched to Postgres for workspaces." }]);
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy.mock.calls[0]![0]!.prompt).not.toContain("Users bring their own AI");
  });

  it("makes no model call for a document with no revision cue", async () => {
    const { runtime: rt, spy } = runtime("{}");
    expect(await detectRevisions(rt, [{ key: "Doc › AI access", text: PLAIN }])).toEqual([]);
    expect(spy).not.toHaveBeenCalled();
  });

  it("an answer it can't use means no revision — nothing hidden on a guess", async () => {
    const { runtime: rt } = runtime("not json");
    expect(await detectRevisions(rt, [{ key: "Doc › Storage", text: STORAGE }])).toEqual([]);
  });
});

describe("the cue gate — phrases, not bare words", () => {
  const asks = (text: string) => revisionCandidates([{ key: "k", text: `${text} Another statement here.` }]).length === 1;
  it("asks about text that changes its mind", () => {
    for (const t of ["Actually, we use Postgres.", "We switched to SQLite.", "Update: V2 ships in April.", "Pro now costs 15 dollars.", "We changed it to weekly.", "Scratch that, keep Firestore.", "We no longer sync."]) expect(asks(t), t).toBe(true);
  });
  it("leaves ordinary prose alone", () => {
    for (const t of ["I've updated the plan with the package.", "The tracker is corrected.", "Changes are reviewed weekly.", "We decided to start with the editor.", "Replace the batteries yearly."]) expect(asks(t), t).toBe(false);
  });
});
