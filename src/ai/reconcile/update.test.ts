/**
 * F38 end to end over the pure pipeline: first run (F31) → pretend-accept
 * (objects as the writer would stamp them) → update with new text. A real
 * AIProviderManager + task registry + MockProvider, never the singletons
 * (the shared harness: `testUtils/reconcileHarness.ts`).
 */
import { describe, expect, it } from "vitest";
import { parseChangeSet } from "@/ai/changes/changeSet";
import type { AIRequest } from "@/ai/types";
import { AIProviderManager } from "@/ai/providerManager";
import { createMockProvider } from "@/ai/providers/mock/mockProvider";
import { createAIRuntime } from "@/ai/runtime";
import { createTaskRegistry } from "@/ai/tasks";
import type { VisualPlan } from "@/ai/visual-plan/types";
import { registerVisualizeTasks } from "@/ai/visualize/tasks";
import { accepted, context, firstRun, modelReply, parse, response, runtimeWith, update } from "@/testUtils/reconcileHarness";
import type { ExistingObject } from "./classify";
import { updateFromNewContent } from "./update";

const LOCAL = "# Launch\n\n- [ ] Ship the flag\n- [ ] Notify support\n\n## Risks\n\nThe gateway may time out.\n\n## Owners\n\nPayments team.\n";
const TEN = `Intro prose, no structure.\n\n${Array.from({ length: 10 }, (_, i) => `## Part ${i}\n\nBody of part ${i}.`).join("\n\n")}`;

describe("updateFromNewContent — a block the user split (F42 Phase 4)", () => {
  /** "Risks"' text block replaced by two pieces, as a split set's writer stamps them. */
  function splitRisks(a: ReturnType<typeof accepted>) {
    const risks = a.existing.find((o) => o.stableNodeKey === "Launch › Risks#text0")!;
    const piece = (i: number): ExistingObject => ({ ...risks, objectId: `el_piece${i}`, stableNodeKey: `${risks.stableNodeKey} ⊃ piece#${i}`, splitOf: { stableNodeKey: risks.stableNodeKey, fingerprint: risks.baseline } });
    return { ...a, existing: [...a.existing.filter((o) => o !== risks), piece(0), piece(1)] };
  }

  it("unchanged content keeps the split: no change set, no notice", async () => {
    const { runtime } = runtimeWith(() => response("never"));
    const r = await update(splitRisks(accepted(await firstRun(LOCAL, runtime))), LOCAL, runtime);
    expect(r.changeSet).toBeNull();
    expect(r.notices).toEqual([]);
    expect(r.reconciliation.splits).toHaveLength(1);
  });

  it("a changed split block is kept and reported; the rest of the update is still proposed", async () => {
    const { runtime } = runtimeWith(() => response("never"));
    const a = splitRisks(accepted(await firstRun(LOCAL, runtime)));
    const text = LOCAL.replace("The gateway may time out.", "The gateway may time out under load.").replace("Payments team.", "Payments and Risk teams.");
    const r = await update(a, text, runtime);
    expect(r.notices).toEqual(["The source changed a block you split, and the split was kept. To show the new content instead, delete the pieces and update again."]);
    const changes = r.changeSet!.changes;
    expect(changes.map((c) => c.kind)).toEqual(["update_block"]); // Owners only: the split block isn't added back, no piece is removed
    expect(JSON.stringify(changes[0])).toContain("Risk teams");
  });

  it("a split block the source dropped: its pieces are proposed for removal", async () => {
    const { runtime } = runtimeWith(() => response("never"));
    const a = splitRisks(accepted(await firstRun(LOCAL, runtime)));
    const r = await update(a, LOCAL.replace("\nThe gateway may time out.\n", "\n"), runtime);
    const removed = r.changeSet!.changes.flatMap((c) => (c.kind === "remove" ? [c.target] : []));
    expect(removed).toEqual(expect.arrayContaining(["el_piece0", "el_piece1"]));
  });
});

describe("updateFromNewContent — local tier", () => {
  it("byte-identical content gives no change set at all (no review prompt)", async () => {
    const { runtime, spy } = runtimeWith(() => response("never"));
    const r = await update(accepted(await firstRun(LOCAL, runtime)), LOCAL, runtime);
    expect(r.changeSet).toBeNull();
    expect(spy).not.toHaveBeenCalled();
  });

  it("an edited paragraph is one clean update; the next version is proposed for the same source", async () => {
    const { runtime, spy } = runtimeWith(() => response("never"));
    const a = accepted(await firstRun(LOCAL, runtime));
    const r = await update(a, LOCAL.replace("The gateway may time out.", "The gateway times out under load."), runtime);
    expect(spy).not.toHaveBeenCalled(); // the local tier never needs a model
    expect(r.changeSet!.changes.map((c) => c.kind)).toEqual(["update_block"]);
    expect(r.changeSet!.contentSource).toMatchObject({ sourceId: a.source.id, version: 2 });
    expect(() => parseChangeSet(r.changeSet)).not.toThrow();
  });

  it("a deleted section is a proposed removal of exactly its objects; an added one is an add", async () => {
    const { runtime } = runtimeWith(() => response("never"));
    const a = accepted(await firstRun(LOCAL, runtime));
    const r = await update(a, LOCAL.replace("## Owners\n\nPayments team.\n", "## Rollout\n\nOne region first.\n"), runtime);
    const kinds = r.reconciliation.items.filter((i) => i.state !== "unchanged").map((i) => `${i.state}:${"node" in i ? i.node.stableKey : i.object.stableNodeKey}`);
    expect(kinds.sort()).toEqual(["add:Launch › Rollout#heading0", "add:Launch › Rollout#text0", "remove:Launch › Owners#heading0", "remove:Launch › Owners#text0"].sort());
    expect(r.changeSet!.changes.filter((c) => c.kind === "remove")).toHaveLength(2);
    // The new section is framed on its own, numbered after the sections already there (F42 Phase 3).
    const frames = r.changeSet!.changes.filter((c) => c.kind === "create_frame");
    expect(frames).toHaveLength(1);
    const already = new Set(a.existing.flatMap((o) => (o.frameId ? [o.frameId] : []))).size;
    expect(frames[0]!.kind === "create_frame" && frames[0]!.title).toBe(`${already + 1} · Section`);
    expect(r.changeSet!.changes.some((c) => c.kind === "update_frame")).toBe(false);
    expect(() => parseChangeSet(r.changeSet)).not.toThrow();
  });

  it("a new paragraph in an existing section joins that section's frame (F42 Phase 3)", async () => {
    const { runtime } = runtimeWith(() => response("never"));
    const a = accepted(await firstRun(LOCAL, runtime));
    const risksFrame = a.existing.find((o) => o.stableNodeKey.includes("Risks"))!.frameId;
    expect(risksFrame).toBeTruthy();
    const r = await update(a, LOCAL.replace("The gateway may time out.", "The gateway may time out.\n\nRetries back off exponentially."), runtime);
    const joins = r.changeSet!.changes.filter((c) => c.kind === "update_frame");
    expect(joins).toHaveLength(1);
    const join = joins[0]!;
    const created = r.changeSet!.changes.filter((c) => c.kind === "create_block").map((c) => (c as { key: string }).key);
    expect(join).toMatchObject({ kind: "update_frame", target: risksFrame, section: "Risks" });
    expect(join.kind === "update_frame" && join.add).toEqual(created);
    expect(r.changeSet!.changes.some((c) => c.kind === "create_frame")).toBe(false);
    expect(() => parseChangeSet(r.changeSet)).not.toThrow();
  });

  it("a block the user edited is a conflict, never a clean update, and never in `changes`", async () => {
    const { runtime } = runtimeWith(() => response("never"));
    const set = await firstRun(LOCAL, runtime);
    const risksKey = (set.contentSource!.plan as VisualPlan).nodes.find((n) => n.type === "text" && n.stableKey!.includes("Risks"))!.stableKey!;
    const a = accepted(set, { [risksKey]: "user-edited" });
    const r = await update(a, LOCAL.replace("The gateway may time out.", "The gateway times out under load."), runtime);
    expect(r.changeSet!.changes).toEqual([]);
    expect(r.changeSet!.conflicts).toHaveLength(1);
    expect(r.changeSet!.conflicts![0]).toMatchObject({ apply: { kind: "update_block" }, keep: { kind: "rebaseline" } });
  });
});

describe("updateFromNewContent — AI tier re-analyses only what changed", () => {
  it("changing one paragraph of a ten-section document sends only that section to the model", async () => {
    const { runtime, spy } = runtimeWith(modelReply);
    const a = accepted(await firstRun(TEN, runtime, "architecture"));
    spy.mockClear();

    const r = await update(a, TEN.replace("Body of part 6.", "Body of part 6, now rewritten."), runtime);
    const calls = spy.mock.calls.map((c) => c[0]!).filter((q) => q.task === "generate_visual_plan");
    expect(calls).toHaveLength(1);
    expect(calls[0]!.prompt).toContain("Body of part 6, now rewritten.");
    expect(calls[0]!.prompt).not.toContain("Body of part 5.");
    expect(calls[0]!.prompt).not.toContain("Intro prose");
    expect(r.reanalyzedUnits).toEqual(["Part 6"]);
    expect(r.reusedUnits).toHaveLength(10);
    // Exactly one proposed change: the one node from that section.
    expect(r.changeSet!.changes.map((c) => c.kind)).toEqual(["update_shape"]);
  });

  it("new objects a model links as explanations of each other (a cycle) are still placed — the update never hangs", async () => {
    const cyclic = (req: AIRequest) =>
      req.prompt.includes("now rewritten")
        ? response(
            JSON.stringify({
              version: 1,
              template: "architecture",
              nodes: [
                { id: "n1", type: "shape", content: { shape: "rectangle", label: "Part six" } },
                { id: "n2", type: "shape", content: { shape: "rectangle", label: "Part six, step one" } },
                { id: "n3", type: "shape", content: { shape: "rectangle", label: "Part six, step two" } },
              ],
              relationships: [
                { from: "n2", to: "n3", type: "explained_by" },
                { from: "n3", to: "n2", type: "explained_by" },
              ],
            }),
          )
        : modelReply(req);
    const { runtime } = runtimeWith(cyclic);
    const a = accepted(await firstRun(TEN, runtime, "architecture"));
    const r = await update(a, TEN.replace("Body of part 6.", "Body of part 6, now rewritten."), runtime);
    expect(r.changeSet!.changes.filter((c) => c.kind === "create_shape")).toHaveLength(2);
  }, 10_000);

  it("identical text makes no model call at all and proposes nothing", async () => {
    const { runtime, spy } = runtimeWith(modelReply);
    const a = accepted(await firstRun(TEN, runtime, "architecture"));
    spy.mockClear();
    const r = await update(a, TEN, runtime);
    expect(spy).not.toHaveBeenCalled();
    expect(r.changeSet).toBeNull();
  });

  it("a new section is analysed and added; a removed one is a proposed removal", async () => {
    const { runtime, spy } = runtimeWith(modelReply);
    const a = accepted(await firstRun(TEN, runtime, "architecture"));
    spy.mockClear();
    const r = await update(a, TEN.replace("## Part 9\n\nBody of part 9.", "## Part 10\n\nA new part."), runtime);
    expect(r.reanalyzedUnits).toEqual(["Part 10"]);
    // Each section comes and goes with its title object (F42): the new one's title is added, the old one's removed.
    // A new section arrives framed, like a first run's (F42 Phase 3): its frame holds its title and its body.
    const kinds = r.changeSet!.changes.map((c) => c.kind).sort();
    expect(kinds).toEqual(["create_block", "create_frame", "create_shape", "remove", "remove"]);
    const frame = r.changeSet!.changes.find((c) => c.kind === "create_frame")!;
    const created = r.changeSet!.changes.filter((c) => c.kind === "create_block" || c.kind === "create_shape").map((c) => (c as { key: string }).key);
    expect(frame.kind === "create_frame" && [...frame.children].sort()).toEqual([...created].sort());
  });

  it("is cancellable mid-analysis and proposes nothing", async () => {
    const manager = new AIProviderManager();
    const registry = createTaskRegistry();
    registerVisualizeTasks(registry);
    manager.registerProvider(createMockProvider({ id: "mock", respond: modelReply, delayMs: 40 }));
    manager.setPrimary("mock");
    const slow = createAIRuntime({ manager, registry });
    const a = accepted(await firstRun(TEN, slow, "architecture"));
    const controller = new AbortController();
    const run = updateFromNewContent({ ...a, text: TEN.replace("part 3.", "part three."), operationId: "op", title: "t", context }, slow, { signal: controller.signal, parseMarkdown: parse });
    setTimeout(() => controller.abort(), 5);
    await expect(run).rejects.toMatchObject({ kind: "cancelled" });
  });
});
