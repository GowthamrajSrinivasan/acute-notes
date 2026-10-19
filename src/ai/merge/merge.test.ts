/**
 * G2 "Merge into existing notes" over the pure pipeline (mock provider): first run → accept → merge new content.
 * The acceptance criteria are the G2 block of `reconcile/topicMerge.test.ts`; these are their tests.
 */
import { describe, expect, it } from "vitest";
import { parseChangeSet } from "@/ai/changes/changeSet";
import type { AIRequest } from "@/ai/types";
import { accepted, acceptUpdate, context, firstRun, modelReply, parse, response, runtimeWith, update, type Accepted } from "@/testUtils/reconcileHarness";
import type { AIRuntime } from "@/ai/runtime";
import type { UpdateResult } from "@/ai/reconcile/update";
import { lastMergeDiagnostics, mergeIntoSource } from "./merge";

const LOCAL = "# Launch\n\n- [ ] Ship the flag\n- [ ] Notify support\n\n## Risks\n\nThe gateway may time out.\n\n## Owners\n\nPayments team.\n";
const TEN = `Intro prose, no structure.\n\n${Array.from({ length: 10 }, (_, i) => `## Part ${i}\n\nBody of part ${i}.`).join("\n\n")}`;

const merge = (a: Accepted, text: string, runtime: AIRuntime) =>
  mergeIntoSource({ ...a, text, operationId: "op_m", title: "Merge into existing notes", context }, runtime, { parseMarkdown: parse });

const kinds = (r: UpdateResult) => r.changeSet!.changes.map((c) => c.kind);

describe("mergeIntoSource — local tier (no AI)", () => {
  it("content about an existing topic joins that topic's frame: no new frame, nothing removed, no model call", async () => {
    const { runtime, spy } = runtimeWith(() => response("never"));
    const a = accepted(await firstRun(LOCAL, runtime));
    const r = await merge(a, "## Risks\n\nRetries back off exponentially.\n", runtime);
    expect(spy).not.toHaveBeenCalled();
    expect(kinds(r)).not.toContain("create_frame");
    expect(kinds(r)).not.toContain("remove");
    expect(r.changeSet!.changes.find((c) => c.kind === "update_frame")).toMatchObject({ section: "Risks" });
    expect(r.changeSet!.contentSource!.text).toContain("The gateway may time out.\n\nRetries back off exponentially.\n\n## Owners");
    expect(r.report.mergedInto).toEqual({ "Launch › Risks": ["Risks"] });
    expect(r.notices).toContain("Merged: added to 1 existing topic.");
    expect(() => parseChangeSet(r.changeSet)).not.toThrow();
  });

  it("content the notes already hold changes nothing: no change set, and the review says why", async () => {
    const { runtime, spy } = runtimeWith(() => response("never"));
    const a = accepted(await firstRun(LOCAL, runtime));
    const r = await merge(a, "## Risks\n\nThe gateway may time out.\n\n## Owners\n\nPayments team.\n", runtime);
    expect(r.changeSet).toBeNull();
    expect(spy).not.toHaveBeenCalled();
    expect(r.report.skippedBlocks).toBe(2);
    expect(r.notices).toEqual(["Everything in this content is already in your notes."]);
  });

  it("a repeated passage is left out and the new one kept, in the same part", async () => {
    const { runtime } = runtimeWith(() => response("never"));
    const a = accepted(await firstRun(LOCAL, runtime));
    const r = await merge(a, "## Risks\n\nThe gateway may time out.\n\nThe queue may back up.\n", runtime);
    const text = r.changeSet!.contentSource!.text;
    expect(text.match(/The gateway may time out\./g)).toHaveLength(1);
    expect(text).toContain("The queue may back up.");
    expect(r.report.skippedBlocks).toBe(1);
  });

  it("content about no existing topic becomes a new topic, framed as a new section", async () => {
    const { runtime } = runtimeWith(() => response("never"));
    const a = accepted(await firstRun(LOCAL, runtime));
    const r = await merge(a, "## Budget\n\nTwo engineers for three weeks.\n", runtime);
    expect(kinds(r)).toContain("create_frame");
    expect(kinds(r)).not.toContain("remove");
    expect(r.changeSet!.contentSource!.text).toMatch(/Payments team\.\n\n## Budget\n\nTwo engineers for three weeks\.\n$/);
    expect(r.report.newTopics).toEqual(["Budget"]);
  });

  it("the merge is the same source's next version", async () => {
    const { runtime } = runtimeWith(() => response("never"));
    const a = accepted(await firstRun(LOCAL, runtime));
    const r = await merge(a, "## Owners\n\nSupport is on call for launch week.\n", runtime);
    expect(r.changeSet!.contentSource).toMatchObject({ sourceId: a.source.id, version: 2 });
  });

  it("after an accepted merge, a later update of the source raises no false conflict (one source, never two)", async () => {
    const { runtime } = runtimeWith(() => response("never"));
    const a = accepted(await firstRun(LOCAL, runtime));
    const m = await merge(a, "## Owners\n\nPayments team owns rollback too.\n", runtime);
    // The merged paragraph is a new explanation of the Owners text (F38b): added, joined to the frame, linked.
    expect(kinds(m)).toEqual(["create_block", "update_frame", "connect"]);
    const a2 = acceptUpdate(a, m.changeSet!);
    const r = await update(a2, m.changeSet!.contentSource!.text.replace("The gateway may time out.", "The gateway times out under load."), runtime);
    expect(r.changeSet!.conflicts ?? []).toEqual([]);
    // The edit is a clean update; the merged objects are matched (nothing added or removed). (The harness passes no
    // existing arrows, so the merge's link is proposed again as a `connect`; the app passes them.)
    expect(kinds(r).filter((k) => k !== "connect")).toEqual(["update_block"]);
  });
});

describe("mergeIntoSource — AI tier", () => {
  /** The mock model: assignments from `assign`, and the usual one-shape plan per unit. */
  const scripted = (assign: (req: AIRequest) => string) => runtimeWith((req) => (req.task === "assign_to_topics" ? response(assign(req)) : modelReply(req)));

  it("the model files a part under a topic with a different heading; only that topic is re-analysed", async () => {
    // Topics in prompt order: (lead) = t1, Part 0 = t2, …, Part 3 = t5.
    const { runtime, spy } = scripted(() => JSON.stringify({ assignments: [{ part: "p1", topic: "t5" }] }));
    const a = accepted(await firstRun(TEN, runtime, "architecture"));
    spy.mockClear();
    const r = await merge(a, "## Extra notes\n\nPart three also needs a migration.\n", runtime);
    expect(spy.mock.calls.map((c) => c[0]!.task)).toEqual(["assign_to_topics", "generate_visual_plan"]);
    expect(r.assignedBy).toBe("ai");
    expect(r.reanalyzedUnits).toEqual(["Part 3"]);
    expect(kinds(r)).not.toContain("create_frame");
    expect(kinds(r)).not.toContain("remove");
    // The grown topic is asked only for what was appended to it: its earlier text isn't sent again, its objects are kept.
    const content = spy.mock.calls.map((c) => c[0]!).find((q) => q.task === "generate_visual_plan")!.prompt.split("Content to visualize:")[1]!;
    expect(content).toContain("Part three also needs a migration.");
    expect(content).not.toContain("Body of part 3.");
    expect(r.reconciliation.items.filter((i) => i.state === "unchanged").length).toBeGreaterThan(0);
  });

  it("parts the model is unsure of are kept with their section, not made topics of their own; the model sees each part's headings", async () => {
    const { runtime, spy } = scripted(() =>
      JSON.stringify({ assignments: [{ part: "p1", topic: "new" }, { part: "p2", topic: "unsure" }, { part: "p3", topic: "unsure" }] }),
    );
    const a = accepted(await firstRun(TEN, runtime, "architecture"));
    spy.mockClear();
    const r = await merge(a, "## Pricing tiers\n\nThree tiers for launch, each priced monthly.\n\n### Free\n\nTen actions.\n\n### Pro\n\nUnlimited actions.\n", runtime);
    const prompt = spy.mock.calls.map((c) => c[0]!).find((q) => q.task === "assign_to_topics")!.prompt;
    expect(prompt).toContain("[p2] (under “Pricing tiers”)");
    // One new topic, with the two fragments in it under their own labels.
    expect(r.report.newTopics).toEqual(["Pricing tiers"]);
    expect(r.report.keptWith).toEqual({ "Pricing tiers": ["Pricing tiers › Free", "Pricing tiers › Pro"] });
    expect(r.changeSet!.contentSource!.text).toMatch(/## Pricing tiers\n\nThree tiers for launch, each priced monthly\.\n\n\*\*Free\*\*\n\nTen actions\.\n\n\*\*Pro\*\*\n\nUnlimited actions\.\n$/);
    expect(r.report.unsure).toEqual(["Pricing tiers › Free", "Pricing tiers › Pro"]);
    expect(r.notices).toContain("AI couldn't tell where 2 passages belong (“Free”, “Pro”): they were kept with the section around them. Check them in the review.");
    expect(r.diagnostics.decisions).toEqual([
      { part: "Pricing tiers", answer: "new", filed: "new" },
      { part: "Pricing tiers › Free", answer: "unsure", filed: "with Pricing tiers", settled: "parent" },
      { part: "Pricing tiers › Pro", answer: "unsure", filed: "with Pricing tiers", settled: "parent" },
    ]);
  });

  it("content the notes already hold is left out before any model call (no assignment, no generation)", async () => {
    const { runtime, spy } = scripted(() => JSON.stringify({ assignments: [] }));
    const a = accepted(await firstRun(TEN, runtime, "architecture"));
    spy.mockClear();
    const r = await merge(a, "## Elsewhere\n\nBody of part 2.\n\n## Again\n\nBody of part 7.\n", runtime);
    expect(spy).not.toHaveBeenCalled();
    expect(r.changeSet).toBeNull();
    expect(r.report).toMatchObject({ skippedBlocks: 2, skippedParts: ["Elsewhere", "Again"] });
    expect(r.notices).toEqual(["Everything in this content is already in your notes."]);
  });

  it("a part the model finds nothing new in (it redraws the topic as it was) changes nothing, and says it's already there", async () => {
    // One fixed shape per unit, whatever the text: a regenerated topic comes back exactly as it was.
    const same = (req: AIRequest) =>
      req.task === "assign_to_topics"
        ? response(JSON.stringify({ assignments: [{ part: "p1", topic: "t5" }] }))
        : response(JSON.stringify({ version: 1, template: "architecture", nodes: [{ id: "n1", type: "shape", content: { shape: "rectangle", label: "A part" } }], relationships: [] }));
    const { runtime } = runtimeWith(same);
    const a = accepted(await firstRun(TEN, runtime, "architecture"));
    const r = await merge(a, "## Third part, again\n\nThe third part, said in other words for this test.\n", runtime);
    expect(r.report.mergedInto).toEqual({ "Part 3": ["Third part, again"] });
    expect(r.changeSet).toBeNull();
    expect(r.notices).toEqual(["Everything in this content is already in your notes."]);
  });

  it("the model sees only what is new in a part: a passage another topic already says isn't shown to it", async () => {
    const { runtime, spy } = scripted(() => JSON.stringify({ assignments: [{ part: "p1", topic: "new" }] }));
    const a = accepted(await firstRun(TEN, runtime, "architecture"));
    spy.mockClear();
    await merge(a, "## Pipelines\n\nBuilds run on every push to main.\n\nBody of part 2.\n", runtime);
    const assign = spy.mock.calls.map((c) => c[0]!).find((q) => q.task === "assign_to_topics")!;
    const shown = assign.prompt.split("New content parts:")[1]!;
    expect(shown).toContain("## Pipelines");
    expect(shown).toContain("Builds run on every push to main.");
    expect(shown).not.toContain("Body of part 2.");
  });

  it("a part the model judges to add nothing to its topic is left out, named in the review, and never generated", async () => {
    const { runtime, spy } = scripted(() => JSON.stringify({ assignments: [{ part: "p1", topic: "t5", nothingNew: true }] }));
    const a = accepted(await firstRun(TEN, runtime, "architecture"));
    spy.mockClear();
    const r = await merge(a, "## Third part, in other words\n\nThe third part's body, said differently.\n", runtime);
    expect(spy.mock.calls.map((c) => c[0]!.task)).toEqual(["assign_to_topics"]);
    expect(r.changeSet).toBeNull();
    expect(r.report.nothingNew).toEqual(["Third part, in other words"]);
    expect(r.notices).toEqual(["Everything in this content is already in your notes.", "Left out “Third part, in other words”: AI found nothing in it that your notes don't already say."]);
  });

  it("'nothing new' only counts with a topic: a part the model calls new is still added", async () => {
    const { runtime } = scripted(() => JSON.stringify({ assignments: [{ part: "p1", topic: "new", nothingNew: true }] }));
    const a = accepted(await firstRun(TEN, runtime, "architecture"));
    const r = await merge(a, "## Hiring\n\nTwo more engineers next quarter.\n", runtime);
    expect(r.report.newTopics).toEqual(["Hiring"]);
    expect(r.report.nothingNew).toEqual([]);
  });

  it("a contradiction becomes a choice in its topic (G3): the part's sentence isn't filed as a fact, the rest is, and the review says so", async () => {
    const reply = { assignments: [{ part: "p1", topic: "t5", conflicts: [{ about: "How part 3 reads", topicSays: "Body of part 3.", partSays: "Part 3 now says something else entirely." }] }] };
    const { runtime } = scripted(() => JSON.stringify(reply));
    const a = accepted(await firstRun(TEN, runtime, "architecture"));
    const r = await mergeIntoSource(
      { ...a, text: "## Part 3 update\n\nPart 3 now says something else entirely. It also gains a reviewer.\n", operationId: "op_m", title: "Merge into existing notes", context, from: { label: "Review notes", date: "2026-10-09" } },
      runtime,
      { parseMarkdown: parse },
    );
    const text = r.changeSet!.contentSource!.text;
    expect(text).toContain("## Part 3\n\nBody of part 3.\n\nIt also gains a reviewer.\n\n> [!choice] How part 3 reads\n> - Body of part 3. _(in your notes)_\n> - Part 3 now says something else entirely. _(from “Review notes”, 2026-10-09)_");
    expect(text.match(/Part 3 now says something else entirely/g)).toHaveLength(1); // only as an option
    expect(r.report.choices).toEqual(["How part 3 reads"]);
    // Who answered and what reached the review (development diagnostics): the chat task here, one conflict, one choice.
    expect(r.diagnostics).toMatchObject({ answeredBy: { role: "primary" }, conflictsPicked: 1, choicesShown: 1 });
    expect(lastMergeDiagnostics()).toEqual(r.diagnostics);
    expect(r.notices).toContain("One thing this content and your notes disagree about is shown as “Needs your call”: “How part 3 reads”. Select an option and choose “Use this option”.");
    // Drawn by code: the box and its two options, linked.
    const keys = r.changeSet!.changes.flatMap((c) => (c.kind === "create_block" ? [c.stableNodeKey] : []));
    expect(keys).toEqual(expect.arrayContaining(["Part 3 § choice:how-part-3-reads", "Part 3 § choice:how-part-3-reads:option0", "Part 3 § choice:how-part-3-reads:option1"]));
  });

  it("a contradiction quoted wrongly (not in the topic word for word) is dropped: the part is filed as usual", async () => {
    const reply = { assignments: [{ part: "p1", topic: "t5", conflicts: [{ about: "X", topicSays: "Something Part 3 never said.", partSays: "Part 3 now says something else entirely." }] }] };
    const { runtime } = scripted(() => JSON.stringify(reply));
    const a = accepted(await firstRun(TEN, runtime, "architecture"));
    const r = await merge(a, "## Part 3 update\n\nPart 3 now says something else entirely.\n", runtime);
    expect(r.report.choices).toEqual([]);
    expect(r.changeSet!.contentSource!.text).not.toContain("[!choice]");
    expect(r.changeSet!.contentSource!.text).toContain("Part 3 now says something else entirely.");
  });

  it("a long import is assigned in batches of 20 parts, answered in parallel, their answers combined", async () => {
    // Every part is filed under Part 3 (t5), whatever its batch numbers it as.
    const { runtime, spy } = scripted((req) => JSON.stringify({ assignments: [...req.prompt.matchAll(/^\[(p\d+)\]/gm)].map((m) => ({ part: m[1], topic: "t5" })) }));
    const a = accepted(await firstRun(TEN, runtime, "architecture"));
    spy.mockClear();
    const incoming = Array.from({ length: 45 }, (_, i) => `## Note ${i + 1}\n\nThe widget-${i + 1} module ships with its own manual.`).join("\n\n");
    const r = await merge(a, incoming, runtime);
    const assigns = spy.mock.calls.map((c) => c[0]!).filter((q) => q.task === "assign_to_topics");
    expect(assigns).toHaveLength(3);
    for (const q of assigns) expect([...q.prompt.matchAll(/^\[p\d+\]/gm)].length).toBeLessThanOrEqual(20);
    expect(r.report.mergedInto["Part 3"]).toHaveLength(45);
    expect(r.diagnostics.batches).toHaveLength(3);
    // The cost counters: 3 assignment calls (one per batch), the one topic regenerated, nothing skipped up front.
    expect(r.diagnostics.calls.byTask["decide:assign_to_topics"]).toBe(3);
    expect(r.diagnostics.calls).toMatchObject({ sectionsRegenerated: ["Part 3"], partsSkippedBeforeAI: 0, choicesOpened: 0, plans: { appended: 1, regenerated: 0 } });
  });

  it("only the parts with something new are sent for assignment", async () => {
    const { runtime, spy } = scripted(() => JSON.stringify({ assignments: [{ part: "p1", topic: "new" }] }));
    const a = accepted(await firstRun(TEN, runtime, "architecture"));
    spy.mockClear();
    await merge(a, "## Elsewhere\n\nBody of part 2.\n\n## Hiring\n\nTwo more engineers next quarter.\n", runtime);
    const assign = spy.mock.calls.map((c) => c[0]!).find((q) => q.task === "assign_to_topics")!;
    expect(assign.prompt).toContain("Two more engineers");
    expect(assign.prompt).not.toContain("[p2]");
  });

  it("a part the model calls new is a new section", async () => {
    const { runtime } = scripted(() => JSON.stringify({ assignments: [{ part: "p1", topic: "new" }] }));
    const a = accepted(await firstRun(TEN, runtime, "architecture"));
    const r = await merge(a, "## Hiring\n\nTwo more engineers next quarter.\n", runtime);
    expect(r.report.newTopics).toEqual(["Hiring"]);
    expect(kinds(r)).toContain("create_frame");
    expect(kinds(r)).not.toContain("remove");
  });

  it("a part the model leaves out keeps the local answer (same heading)", async () => {
    const { runtime } = scripted(() => JSON.stringify({ assignments: [] }));
    const a = accepted(await firstRun(TEN, runtime, "architecture"));
    const r = await merge(a, "## Part 4\n\nPart four gets a second reviewer.\n", runtime);
    expect(r.report.mergedInto).toEqual({ "Part 4": ["Part 4"] });
  });

  it("when assignment fails, the local answer is used and the review says so", async () => {
    const { runtime } = scripted(() => "not json at all");
    const a = accepted(await firstRun(TEN, runtime, "architecture"));
    const r = await merge(a, "## Part 4\n\nPart four gets a second reviewer.\n", runtime);
    expect(r.assignedBy).toBe("local");
    expect(r.notices[0]).toMatch(/couldn't sort the new content/);
    expect(r.report.mergedInto).toEqual({ "Part 4": ["Part 4"] });
  });
});
