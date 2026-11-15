/**
 * Stage 2d (intelligent-update-engine-plan): placing content where the user chose, and the router's optional model
 * step. Offline: the model is a fake runtime.
 */
import { describe, expect, it } from "vitest";
import { parseChangeSet, resolveChangeSet, type ProposedChange } from "@/ai/changes/changeSet";
import { fingerprintContent } from "@/ai/content/fingerprint";
import type { AIRuntime } from "@/ai/runtime";
import type { SceneElement } from "@/domain/canvas/adapter";
import type { DocumentRecord } from "@/domain/types";
import { block, doc, el, lookup, para } from "@/search/testFixtures";
import { WorkspaceIndex } from "@/search/workspaceIndex";
import { VectorTier } from "./embedding";
import { placeContent, type PlacementChoice } from "./placement";
import { routeContent, type RouteResult } from "./router";
import { refineRoute, routeContentTask } from "./task";

const frame = el({ id: "f_limits", type: "frame", name: "Limits", x: 0, y: 0, width: 600, height: 400 } as Partial<SceneElement> & Pick<SceneElement, "id" | "type">);
const docs: DocumentRecord[] = [
  doc("d_retries", [{ id: "b1", type: "paragraph", props: { textColor: "blue" }, content: "Retries happen five times with exponential backoff. Calls are logged." }]),
  doc("d_timeouts", para("Timeouts last ten seconds per call.")),
];
const scene: SceneElement[] = [
  frame,
  block("retries", "d_retries", { frameId: "f_limits", x: 20, y: 40, width: 300, height: 80 }),
  block("timeouts", "d_timeouts", { frameId: "f_limits", x: 20, y: 140, width: 300, height: 60 }),
];
const getDocument = lookup(docs);

function route(text: string): RouteResult {
  const index = new WorkspaceIndex("ws");
  index.syncScene("cv", scene, getDocument);
  return routeContent({ text, canvasId: "cv", tier: new VectorTier(index), scene });
}
const choose = (r: RouteResult, id: string, action?: PlacementChoice["action"]): PlacementChoice => {
  const candidate = r.candidates.find((c) => c.id === id)!;
  return { target: id, action: action ?? candidate.action, candidate };
};
const place = (text: string, choices: PlacementChoice[]) => placeContent({ text, choices, scene, getDocument, at: { x: 900, y: 900 }, operationId: "op_place" });

describe("placeContent", () => {
  it("an update is a claim-level patch of the sentence that holds the claim, applied at accept with the rest of the card kept", () => {
    const r = route("Retries happen three times with exponential backoff.");
    const { set, notes } = place("Retries happen three times with exponential backoff.", [choose(r, "retries")]);
    expect(notes).toEqual([]);
    const patch = set!.changes[0] as Extract<ProposedChange, { kind: "patch_block" }>;
    expect(patch).toMatchObject({ kind: "patch_block", target: "retries", edits: [{ replacement: "three", intent: "SUPERSEDES", blockId: "b1" }] });
    expect(patch.stableNodeKey).toBeUndefined(); // the card keeps its own provenance: the edit counts as the user's
    const live = docs[0]!.snapshot;
    const resolved = resolveChangeSet(parseChangeSet(set), () => true, () => ({ content: live, fingerprint: fingerprintContent(live) }));
    expect((resolved.changes[0] as Extract<ProposedChange, { kind: "update_block" }>).content).toEqual([
      { id: "b1", type: "paragraph", props: { textColor: "blue" }, content: "Retries happen three times with exponential backoff. Calls are logged." },
    ]);
  });

  it("content of more than one sentence replaces the claim's sentence with all of it", () => {
    const text = "Retries happen three times with exponential backoff. Each retry waits longer.";
    const { set } = place(text, [choose(route(text), "retries")]);
    expect(set!.changes[0]).toMatchObject({ kind: "patch_block", edits: [{ match: { exactText: "Retries happen five times with exponential backoff." }, replacement: text }] });
  });

  it("insert_near: a new card at the bottom of the card's section, joining its frame", () => {
    const { set } = place("Jitter spreads retries out.", [choose(route("Jitter spreads retries out."), "retries", "insert_near")]);
    expect(set!.changes).toMatchObject([
      { kind: "create_block", key: "placed1", blockType: "text", content: [{ type: "paragraph", content: "Jitter spreads retries out." }], box: { x: 20, y: 224 } },
      { kind: "update_frame", target: "f_limits", add: ["placed1"] },
    ]);
  });

  it("several destinations in one set; two new cards in one section stack, never overlap", () => {
    const r = route("Jitter spreads retries out.");
    const { set } = place("Jitter spreads retries out.", [choose(r, "retries", "insert_near"), choose(r, "timeouts", "insert_near")]);
    const boxes = set!.changes.flatMap((c) => (c.kind === "create_block" ? [c.box] : []));
    expect(boxes).toHaveLength(2);
    expect(boxes[1]!.y).toBeGreaterThanOrEqual(boxes[0]!.y + boxes[0]!.height);
    expect(set!.changes.filter((c) => c.kind === "update_frame")).toHaveLength(1);
    expect(() => parseChangeSet(set)).not.toThrow();
  });

  it("an update that can't be placed exactly becomes a new card beside it, and says so", () => {
    const r = route("Retries happen three times with exponential backoff.");
    const stale = { ...choose(r, "retries"), candidate: { ...choose(r, "retries").candidate!, claim: { ...choose(r, "retries").candidate!.claim!, sentence: "A sentence the card doesn't have." } } };
    const { set, notes } = place("Retries happen three times with exponential backoff.", [stale]);
    expect(set!.changes[0]!.kind).toBe("create_block");
    expect(notes[0]).toMatch(/couldn't be edited exactly/);
  });

  it("new: a card at the place given; none: nothing", () => {
    expect(place("A new idea.", [{ target: null, action: "new" }]).set!.changes).toMatchObject([{ kind: "create_block", box: { x: 900, y: 900 } }]);
    expect(place("x", [{ target: "retries", action: "none" }]).set).toBeNull();
  });
});

describe("the model step (route_content)", () => {
  const fake = (data: unknown, calls: unknown[] = []): AIRuntime => ({ run: async (_t: string, input: unknown) => (calls.push(input), { data, usage: { provider: "mock", model: "m" } }) }) as unknown as AIRuntime;
  const ambiguous = (): RouteResult => {
    const r = route("Calls are timed and logged.");
    return { ...r, decision: "NEEDS_CLARIFICATION" };
  };

  it("is asked only when the router couldn't decide, and only about the cards it was shown", async () => {
    const calls: unknown[] = [];
    const decided = { ...ambiguous(), decision: "route" as const };
    expect(await refineRoute(decided, "x", fake({ decision: "new" }, calls))).toBe(decided);
    expect(calls).toHaveLength(0);
    await refineRoute(ambiguous(), "Calls are timed and logged.", fake({ decision: "route", targets: ["c1"] }, calls));
    expect((calls[0] as { candidates: { ref: string }[] }).candidates.map((c) => c.ref)).toEqual(["c1", "c2"]);
  });

  it("its pick decides the route; the candidates and both confidences stay the router's", async () => {
    const before = ambiguous();
    const r = await refineRoute(before, "Calls are timed and logged.", fake({ decision: "route", targets: ["c2", "c9"], reason: "about timing" }));
    expect(r.decision).toBe("route");
    expect(r.model!.targets).toEqual([before.candidates[1]!.id]); // an unknown reference is dropped
    expect(r.candidates).toEqual(before.candidates);
  });

  it("may answer NEEDS_CLARIFICATION with a question, or NEW", async () => {
    expect(await refineRoute(ambiguous(), "x", fake({ decision: "needs_clarification", question: "Is this about retries or timeouts?" }))).toMatchObject({
      decision: "NEEDS_CLARIFICATION",
      reason: "Is this about retries or timeouts?",
    });
    expect((await refineRoute(ambiguous(), "x", fake({ decision: "new" }))).decision).toBe("NEW");
  });

  it("a failed call leaves the router's result as it was", async () => {
    const before = ambiguous();
    const failing = { run: async () => Promise.reject(new Error("offline")) } as unknown as AIRuntime;
    expect(await refineRoute(before, "x", failing)).toBe(before);
  });

  it("its prompt lists the cards by reference and asks for JSON", () => {
    const { prompt } = routeContentTask.buildPrompt({ input: { content: "New text.", candidates: [{ ref: "c1", title: "Retries", section: "Limits", summary: "Retries happen five times." }] } });
    expect(prompt).toContain("[c1] Retries (section “Limits”)");
    expect(prompt).toContain('"decision":"needs_clarification"');
  });
});
