/**
 * G3.3 through the pipeline (mock model): a document that changes its mind is drawn with the later statement only; the earlier one
 * is on the section's "Changed over time" page, kept with the version, and never sent to the model or re-added by the safety net.
 */
import { describe, expect, it } from "vitest";
import type { ChangeSet } from "@/ai/changes/changeSet";
import type { AIRequest } from "@/ai/types";
import { mergeIntoSource } from "@/ai/merge/merge";
import { accepted, context, firstRun, modelReply, parse, response, runtimeWith, update } from "@/testUtils/reconcileHarness";

const DOC = `## Storage

We store every workspace in Firestore. Attachments stay as blobs. Actually, we switched to Postgres for workspaces.

## AI access

Users bring their own AI. The app never ships a model key.
`;
const PAIR = { section: "u1", earlier: "We store every workspace in Firestore.", later: "Actually, we switched to Postgres for workspaces." };

/** The mock model: the revision pair for find_revisions (the Storage section is the only one asked about), a plan otherwise. */
function scripted(revisions: unknown[] = [PAIR]) {
  return runtimeWith((req: AIRequest) => (req.task === "find_revisions" ? response(JSON.stringify({ revisions })) : modelReply(req)));
}
const tasks = (spy: ReturnType<typeof runtimeWith>["spy"]) => spy.mock.calls.map((c) => c[0]!.task);
const trailOf = (set: ChangeSet) => set.changes.find((c) => c.kind === "create_page" && /§ trail$/.test(c.stableNodeKey ?? ""));

describe("G3.3 — a document that changes its mind", () => {
  it("first run: the model never sees the replaced statement; the section's 'Changed over time' page keeps it; the version stores it", async () => {
    const { runtime, spy } = scripted();
    const set = await firstRun(DOC, runtime, "architecture");
    expect(tasks(spy)).toContain("find_revisions");
    const generated = spy.mock.calls.map((c) => c[0]!).filter((r) => r.task === "generate_visual_plan").map((r) => r.prompt).join("\n");
    expect(generated).toContain("we switched to Postgres");
    expect(generated).not.toContain("in Firestore");
    expect(JSON.stringify(trailOf(set))).toContain("Was “We store every workspace in Firestore.” — now “Actually, we switched to Postgres for workspaces.”");
    expect(set.contentSource).toMatchObject({ text: DOC, revisions: [{ unit: "Storage", earlier: PAIR.earlier, later: PAIR.later }] });
  });

  it("an unchanged re-send asks nothing again and proposes nothing", async () => {
    const { runtime, spy } = scripted();
    const a = accepted(await firstRun(DOC, runtime, "architecture"));
    spy.mockClear();
    const r = await update(a, DOC, runtime);
    expect(tasks(spy)).not.toContain("find_revisions");
    expect(r.changeSet).toBeNull();
  });

  it("editing that section asks about it again; the trail follows what the text says now", async () => {
    const { runtime, spy } = scripted([{ section: "u1", earlier: "We store every workspace in Firestore.", later: "Actually, we switched to SQLite for workspaces." }]);
    const a = accepted(await firstRun(DOC, runtime, "architecture"));
    spy.mockClear();
    const r = await update(a, DOC.replace("Postgres", "SQLite"), runtime);
    expect(tasks(spy)).toContain("find_revisions");
    expect(r.changeSet!.contentSource!.revisions).toEqual([{ unit: "Storage", earlier: PAIR.earlier, later: "Actually, we switched to SQLite for workspaces." }]);
  });

  it("a merge asks nothing new (its own contradictions are choices) and keeps the revisions still in the text", async () => {
    const { runtime, spy } = runtimeWith((req: AIRequest) =>
      req.task === "find_revisions" ? response(JSON.stringify({ revisions: [PAIR] })) : req.task === "assign_to_topics" ? response(JSON.stringify({ assignments: [{ part: "p1", topic: "t2" }] })) : modelReply(req),
    );
    const a = accepted(await firstRun(DOC, runtime, "architecture"));
    spy.mockClear();
    const r = await mergeIntoSource({ ...a, text: "## Access notes\n\nKeys are encrypted in the browser.\n", operationId: "op_m", title: "Merge", context }, runtime, { parseMarkdown: parse });
    expect(tasks(spy)).not.toContain("find_revisions");
    expect(r.changeSet!.contentSource!.revisions).toEqual([{ unit: "Storage", earlier: PAIR.earlier, later: PAIR.later }]);
  });

  it("a document without a revision cue asks nothing", async () => {
    const { runtime, spy } = scripted();
    await firstRun(DOC.replace("Actually, we switched to Postgres for workspaces.", "Backups run nightly."), runtime, "architecture");
    expect(tasks(spy)).not.toContain("find_revisions");
  });
});
