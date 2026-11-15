/**
 * Full-gate regression spec (2026-11-15, `.ai/docs/mcp-write-surface-audit-2026-11-15.md` §4 gaps 1 and 2): the unit half
 * of `e2e/local/mcpRemoveRevert.local.spec.ts`. Each `it.fails` states the behaviour REQUIRED of a deferred fix and fails
 * today for the stated reason. When the fix lands, the test starts passing, `it.fails` then fails, and the mark must be
 * removed (turn it into `it`). Do not weaken the assertions to make it pass.
 *
 * Required behaviour, mirroring `update_block`'s stale-target protection (`staleTarget.ts`):
 * - A `remove` (MCP `delete_object` / `delete_connection`) and a revert's `restore` / `remove` (`revert_agent_changes`)
 *   carry a baseline when proposed, are compared with the live target at Accept, and a target the user edited since is
 *   withheld as a decision (Keep mine / Delete anyway, Keep current / Revert anyway), never written blind.
 * - `planRevert` treats a block whose CONTENT changed since the agent's change as edited, even though a content edit
 *   writes only the document store and never bumps the element's version (`documentSession.ts`).
 *
 * The pipeline is the real one (`PendingChanges` → `withDecisions` → `acceptChangeSet` → `afterAccept`), on the same
 * kind of in-memory canvas as `staleTarget.test.ts`. Where the fix needs a new input (the planRevert content reading),
 * the call below uses the proposed shape (`afterFingerprint` on `touched`, a third `contentFingerprint` argument); if
 * the shipped API differs, adapt the setup, never the assertions.
 */
import { describe, expect, it } from "vitest";
import { fingerprintContent, fingerprintShape } from "@/ai/content/fingerprint";
import { withDecisions } from "@/ai/reconcile/conflicts";
import type { RichContent } from "@/domain/types";
import { CanvasHistory } from "@/history/canvasHistory";
import { acceptChangeSet, type ChangeSetCanvas } from "./accept";
import { planRevert, type AgentChangeRecord, type RevertPlan } from "./agentState";
import type { ChangeSet, ProposedChange } from "./changeSet";
import { PendingChanges } from "./pendingChanges";
import { afterAccept } from "./staleTarget";

/** The deferred defects (audit 2026-11-15). Each `it.fails` names one; remove the mark when its fix lands. */
const DELETE_DEFECT = "deferred defect: delete_object/delete_connection `remove` has no baseline and no Accept re-check (audit gap 2, A2/A3) — remove when the fix lands";
const REVERT_ACCEPT_DEFECT = "deferred defect: a revert's restore/remove is not re-checked at Accept (audit gap 1a, A4; changeSet.ts resolveChangeSet) — remove when the fix lands";
const REVERT_PLAN_DEFECT = "deferred defect: planRevert detects edits by element version only; block content edits never bump it (audit gap 1b, A4) — remove when the fix lands";

const para = (text: string): RichContent => [{ type: "paragraph", content: text }];
const textOfContent = (c: RichContent) => (typeof c[0]?.content === "string" ? c[0].content : "");

interface El {
  id: string;
  type: "embeddable" | "arrow";
  version: number;
  index: string;
  isDeleted: boolean;
  /** A block's document (re-pointed to a fresh one by an update, as the real writer does). */
  doc?: string;
  /** An arrow's label (in the app: its bound text element). */
  label?: string;
}

/** Blocks (`blocks`: id → text) and arrows (`arrows`: id → label) on a canvas with the real history; documents live outside it. */
function canvasWith(blocks: Record<string, string>, arrows: Record<string, string> = {}) {
  const docs = new Map<string, RichContent>();
  let i = 0;
  let scene: El[] = [
    ...Object.entries(blocks).map(([id, t]): El => {
      docs.set(`d_${id}`, para(t));
      return { id, type: "embeddable", version: 1, index: `a${i++}`, isDeleted: false, doc: `d_${id}` };
    }),
    ...Object.entries(arrows).map(([id, label]): El => ({ id, type: "arrow", version: 1, index: `a${i++}`, isDeleted: false, label })),
  ];
  const history = new CanvasHistory<El>({
    getElements: () => scene,
    apply: (elements) => (scene = elements),
    bump: (t, above) => ({ ...t, version: above + 1 }),
    markDeleted: (el) => ({ ...el, isDeleted: true }),
  });
  history.init(scene);
  let n = 0;
  const live = (id: string) => scene.find((e) => e.id === id && !e.isDeleted);
  const element = (id: string) => scene.find((e) => e.id === id);
  const text = (id: string) => {
    const el = live(id);
    if (!el) return null;
    return el.type === "arrow" ? (el.label ?? "") : textOfContent(docs.get(el.doc!)!);
  };
  /** What `liveFingerprints` reads: a block's content, an arrow's label. */
  const fingerprint = (id: string) => {
    const el = live(id);
    if (!el) return null;
    return el.type === "arrow" ? fingerprintShape("arrow", el.label ?? "") : fingerprintContent(docs.get(el.doc!)!);
  };
  const canvas: ChangeSetCanvas = {
    boxOf: (id) => (live(id) ? { x: 0, y: 0, width: 10, height: 10 } : undefined),
    // Both readers cover both kinds, so the fix may check a removal through either.
    contentOf: (id) => {
      const el = live(id);
      if (!el) return null;
      const content = el.type === "arrow" ? para(el.label ?? "") : docs.get(el.doc!)!;
      return { content, fingerprint: fingerprint(id)! };
    },
    shapeOf: (id) => {
      const el = live(id);
      return el?.type === "arrow" ? { shape: "arrow", fingerprint: fingerprint(id)! } : null;
    },
    write(_set: ChangeSet, changes: readonly ProposedChange[]) {
      for (const c of changes) {
        if (c.kind === "update_block") {
          const doc = `d_${c.target}_${++n}`;
          docs.set(doc, c.content);
          scene = scene.map((e) => (e.id === c.target ? { ...e, doc, version: e.version + 1 } : e));
        } else if (c.kind === "remove") {
          scene = scene.map((e) => (e.id === c.target ? { ...e, isDeleted: true, version: e.version + 1 } : e));
        } else if (c.kind === "restore") {
          // The element as it was (its old document pointer), keeping its version history, as the real writer does.
          scene = scene.map((e) => (e.id === c.target ? { ...e, ...(c.element as Partial<El>), version: e.version + 1, isDeleted: false } : e));
        }
      }
      return new Map();
    },
  };
  /** The user's edit in the block's editor: its document changes, not the element (no version bump). */
  const edit = (id: string, t: string) => docs.set(live(id)!.doc!, para(t));
  /** The user retypes an arrow's label on the canvas (a scene edit: the version moves). */
  const relabel = (id: string, label: string) => (scene = scene.map((e) => (e.id === id ? { ...e, label, version: e.version + 1 } : e)));
  return { history, canvas, text, fingerprint, edit, relabel, element, isLive: (id: string) => !!live(id) };
}

type Canvas = ReturnType<typeof canvasWith>;

/** The pending store as the app has it: proposals stamped from the live canvas (`liveFingerprints`). */
const pendingOn = (c: Canvas) => new PendingChanges({ baselineOf: () => (id) => c.fingerprint(id) });

/** What `acceptPendingSet` does, on the pure pipeline: decisions, one transaction, then what stays under review. */
function accept(pending: PendingChanges, c: Canvas, decisions = new Map<string, "apply" | "keep">()) {
  const set = pending.get("cv")!;
  const r = acceptChangeSet(withDecisions(set, decisions), c.canvas, c.history);
  const after = afterAccept(set, decisions, r.stale, r.applied.length > 0);
  if (after.rest) pending.replace("cv", set.operationId, after.rest);
  else pending.settle("cv", set.operationId);
  return { ...r, ...after };
}

/** What the MCP delete tools propose (`writeTools.ts` delete_object, `objectTools.ts` delete_connection). */
const deletion = (tool: "delete_object" | "delete_connection", targets: string[]) => ({
  operationId: `op_${tool}`,
  title: `ChatGPT: Delete ${targets.length}`,
  metadata: { createdBy: "mcp", task: tool },
  session: "mcp_1",
  agent: "ChatGPT",
  changes: targets.map((target) => ({ kind: "remove", target })),
});

describe("delete_object / delete_connection: an edit made during review is never deleted without a decision", () => {
  it.fails(`a block whose content the user edited after delete_object was proposed: Accept withholds it as a decision; Keep mine writes nothing [${DELETE_DEFECT}]`, () => {
    const c = canvasWith({ retry: "Retry limit: 5", timeout: "Timeout: 30 s" });
    const pending = pendingOn(c);
    pending.propose("cv", deletion("delete_object", ["retry", "timeout"]));
    c.edit("retry", "Retry limit: 4");
    const r = accept(pending, c);
    // The untouched block is deleted (one step); the edited one is withheld and asked about.
    expect(r.applied).toEqual([{ kind: "remove", target: "timeout" }]);
    expect(c.isLive("retry")).toBe(true);
    expect(c.text("retry")).toBe("Retry limit: 4");
    expect(r.stale).toMatchObject([{ target: "retry", apply: { kind: "remove", target: "retry" }, changedSinceProposal: true }]);
    expect(pending.get("cv")!.conflicts).toMatchObject([{ target: "retry", changedSinceProposal: true }]);
    // Keep mine: nothing written, review over.
    const step = accept(pending, c, new Map([["retry", "keep"]]));
    expect(step).toMatchObject({ stepId: null, applied: [], waiting: [], rest: null });
    expect(c.text("retry")).toBe("Retry limit: 4");
    expect(pending.get("cv")).toBeNull();
  });

  it.fails(`Delete anyway deletes the edited block as one undo step, and undo brings back the user's edit [${DELETE_DEFECT}]`, () => {
    const c = canvasWith({ retry: "Retry limit: 5" });
    const pending = pendingOn(c);
    pending.propose("cv", deletion("delete_object", ["retry"]));
    c.edit("retry", "Retry limit: 4");
    const first = accept(pending, c);
    expect(first.stepId).toBeNull();
    expect(c.isLive("retry")).toBe(true);
    const r = accept(pending, c, new Map([["retry", "apply"]]));
    expect(r.stepId).not.toBeNull();
    expect(c.isLive("retry")).toBe(false);
    c.history.undo();
    expect(c.text("retry")).toBe("Retry limit: 4");
    expect(c.history.canUndo).toBe(false);
  });

  it.fails(`a connection whose label the user changed after delete_connection was proposed: Accept withholds it; the label survives [${DELETE_DEFECT}]`, () => {
    const c = canvasWith({}, { link: "calls" });
    const pending = pendingOn(c);
    pending.propose("cv", deletion("delete_connection", ["link"]));
    c.relabel("link", "calls (retried)");
    const r = accept(pending, c);
    expect(r.applied).toEqual([]);
    expect(c.isLive("link")).toBe(true);
    expect(c.text("link")).toBe("calls (retried)");
    expect(r.stale).toMatchObject([{ target: "link", apply: { kind: "remove", target: "link" }, changedSinceProposal: true }]);
  });

  it("control (passes today and after the fix): an untouched target is deleted as one undo step", () => {
    const c = canvasWith({ retry: "Retry limit: 5" });
    const pending = pendingOn(c);
    pending.propose("cv", deletion("delete_object", ["retry"]));
    const r = accept(pending, c);
    expect(r.applied).toEqual([{ kind: "remove", target: "retry" }]);
    expect(r.stale).toEqual([]);
    expect(c.isLive("retry")).toBe(false);
    c.history.undo();
    expect(c.text("retry")).toBe("Retry limit: 5");
  });
});

describe("revert_agent_changes: a content edit made after the revert was proposed is re-checked at Accept", () => {
  /** The agent updated `retry` ("Retry limit: 5" → "3"), accepted; returns the block's before-state (what the revert restores). */
  function agentUpdated(c: Canvas) {
    const before = { ...c.element("retry")! };
    acceptChangeSet({ operationId: "op_agent", title: "ChatGPT: Update", metadata: { createdBy: "mcp" }, changes: [{ kind: "update_block", target: "retry", content: para("Retry limit: 3") }] }, c.canvas, c.history);
    expect(c.text("retry")).toBe("Retry limit: 3");
    return before;
  }

  const revertSet = (changes: unknown[]) => ({
    operationId: "op_revert",
    title: "ChatGPT: Revert: Update",
    metadata: { createdBy: "mcp", task: "revert_agent_changes" },
    session: "mcp_1",
    agent: "ChatGPT",
    reverts: ["chg_1"],
    changes,
  });

  it.fails(`a restore whose block the user edited after the revert was proposed: Accept withholds it; Keep current leaves the content exactly [${REVERT_ACCEPT_DEFECT}]`, () => {
    const c = canvasWith({ retry: "Retry limit: 5" });
    const before = agentUpdated(c);
    const pending = pendingOn(c);
    pending.propose("cv", revertSet([{ kind: "restore", target: "retry", element: before }]));
    c.edit("retry", "Retry limit: 4");
    const r = accept(pending, c);
    expect(r.applied).toEqual([]);
    expect(c.text("retry")).toBe("Retry limit: 4");
    expect(r.stale).toMatchObject([{ target: "retry", apply: { kind: "restore", target: "retry" }, changedSinceProposal: true }]);
    const kept = accept(pending, c, new Map([["retry", "keep"]]));
    expect(kept).toMatchObject({ stepId: null, applied: [], rest: null });
    expect(c.text("retry")).toBe("Retry limit: 4");
  });

  it.fails(`a revert's remove of a block the agent created, edited by the user after the revert was proposed: Accept withholds it [${REVERT_ACCEPT_DEFECT}]`, () => {
    const c = canvasWith({ added: "Agent's note" });
    const pending = pendingOn(c);
    pending.propose("cv", revertSet([{ kind: "remove", target: "added" }]));
    c.edit("added", "Agent's note, with my addition");
    const r = accept(pending, c);
    expect(r.applied).toEqual([]);
    expect(c.isLive("added")).toBe(true);
    expect(c.text("added")).toBe("Agent's note, with my addition");
  });
});

describe("planRevert: a block whose content changed since the agent's change is a conflict (content edits don't bump the version)", () => {
  const fp = (t: string) => fingerprintContent(para(t));
  /** The proposed API: `touched[].afterFingerprint` recorded at accept, and the live content read as a third argument. */
  const plan = planRevert as unknown as (records: readonly AgentChangeRecord[], scene: readonly { id: string; isDeleted: boolean; version: number }[], contentFingerprint?: (id: string) => string | null) => RevertPlan;
  const rec = (extra: Partial<AgentChangeRecord>): AgentChangeRecord => ({
    id: "chg_1",
    workspaceId: "ws",
    canvasId: "cv",
    operationId: "op_agent",
    tool: "update_block",
    at: 1,
    outcome: "accepted",
    title: "ChatGPT: Update",
    touched: [],
    inverse: [],
    revertible: true,
    ...extra,
  });
  const updated = rec({
    touched: [{ elementId: "b", op: "update", afterVersion: 2, afterFingerprint: fp("Retry limit: 3") } as AgentChangeRecord["touched"][number]],
    inverse: [{ op: "restore", element: { id: "b", type: "embeddable", version: 1, customData: { acute: { kind: "rich-block", documentId: "d_old" } } } }],
  });
  const created = rec({
    id: "chg_2",
    tool: "create_block",
    touched: [{ elementId: "n", op: "create", afterVersion: 1, afterFingerprint: fp("Agent's note") } as AgentChangeRecord["touched"][number]],
    inverse: [{ op: "remove", elementId: "n" }],
  });
  // The element versions are exactly what the agent's change left: the user edited only the documents.
  const scene = [
    { id: "b", type: "embeddable", version: 2, isDeleted: false },
    { id: "n", type: "embeddable", version: 1, isDeleted: false },
  ];

  it.fails(`an updated block and a created block, both with content edited by the user since: conflicts, not a clean restore/remove [${REVERT_PLAN_DEFECT}]`, () => {
    const live: Record<string, string> = { b: fp("Retry limit: 4"), n: fp("Agent's note, with my addition") };
    const p = plan([updated, created], scene, (id) => live[id] ?? null);
    expect(p.changes).toEqual([]);
    expect(p.conflicts.map((c) => [c.target, c.apply.kind])).toEqual([
      ["b", "restore"],
      ["n", "remove"],
    ]);
  });

  it("control (passes today and after the fix): unedited content is reverted cleanly", () => {
    const live: Record<string, string> = { b: fp("Retry limit: 3"), n: fp("Agent's note") };
    const p = plan([updated, created], scene, (id) => live[id] ?? null);
    expect(p.conflicts).toEqual([]);
    expect(p.changes.map((c) => [c.kind, "target" in c ? c.target : ""])).toEqual([
      ["restore", "b"],
      ["remove", "n"],
    ]);
  });
});
