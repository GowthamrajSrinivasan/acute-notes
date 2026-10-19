import { describe, expect, it } from "vitest";
import type { SceneElement } from "@/domain/canvas/adapter";
import { parseChangeSet } from "@/ai/changes/changeSet";
import type { AgentChangeRecord } from "@/ai/changes/agentState";
import { impactOf, nodesCitingChanges, riskOf } from "./impact";
import { decisionsOf, implementationPlan, resolveProject, warningsFor } from "./knowledge";
import { addProjectNodes, projectTemplate, STARTER_TASKS, TEMPLATE_L1 } from "./projectChanges";
import { SESSION_CONTEXT_BUDGET, sessionContext, SessionContextAborted } from "./sessionContext";
import { sessionReview } from "./sessionReview";
import { ancestorsOf, buildWorkspaceGraph, resolve } from "./workspaceGraph";

let v = 1;
const el = (partial: Partial<SceneElement> & Pick<SceneElement, "id" | "type">): SceneElement =>
  ({ x: 0, y: 0, width: 100, height: 50, angle: 0, locked: false, opacity: 100, isDeleted: false, groupIds: [], strokeColor: "#000", backgroundColor: "transparent", strokeWidth: 1, strokeStyle: "solid", version: v++, ...partial }) as SceneElement;
const frame = (id: string, name: string, acuteDiagram: Record<string, unknown> = { type: "architecture", interactive: true }) => ({ ...el({ id, type: "frame", customData: { acuteDiagram } }), name }) as SceneElement;
const node = (id: string, label: string, acuteNode: Record<string, unknown>, frameId?: string) => [
  el({ id, type: "rectangle", ...(frameId ? { frameId } : {}), customData: { acuteNode } }),
  el({ id: `${id}_t`, type: "text", text: label, originalText: label, containerId: id, ...(frameId ? { frameId } : {}) }),
];
const arrow = (id: string, from: string, to: string, relation?: string) =>
  el({ id, type: "arrow", startBinding: { elementId: from }, endBinding: { elementId: to }, customData: relation ? { acuteRelation: relation } : {} });

/**
 * Architecture on one canvas — L1 "System" (Payments drills into L2 "Payment service": Webhook → Ledger) — and the
 * project's state on another: a constraint on Webhook, an enforced decision on Ledger, a proposed one, a superseded
 * one, and a deviation scoped to Ledger.
 */
function workspace() {
  const arch = [
    frame("f1", "System"),
    ...node("pay", "Payments", { kind: "backend", key: "sys.payments", expandsTo: { frameKey: "f2" } }, "f1"),
    frame("f2", "Payment service"),
    ...node("hook", "Webhook", { kind: "backend", key: "svc.webhook", sources: [{ path: "src/webhook.ts" }] }, "f2"),
    ...node("ledger", "Ledger", { kind: "database", key: "svc.ledger" }, "f2"),
    arrow("a1", "hook", "ledger", "depends_on"),
  ];
  const state = [
    frame("fp", "Project state", { type: "architecture", interactive: true, profile: "project" }),
    ...node("proj", "Acme API", { kind: "project", key: "acme", project: "acme", style: "service", focus: "Token rotation" }, "fp"),
    ...node("c1", "Never retry card_declined", { kind: "constraint", key: "acme.c1", project: "acme", status: "accepted", reason: "Fraud rules", refs: ["svc.webhook"] }, "fp"),
    ...node("d1", "Ledger is append-only", { kind: "decision", key: "acme.d1", project: "acme", status: "accepted", enforce: true, reason: "Audit", refs: ["svc.ledger"] }, "fp"),
    ...node("d2", "Use Redis for dedup", { kind: "decision", key: "acme.d2", project: "acme", status: "proposed", reason: "Speed", options: [{ label: "Redis" }, { label: "Postgres" }], refs: ["svc.webhook"] }, "fp"),
    ...node("d3", "Old retry policy", { kind: "constraint", key: "acme.d3", project: "acme", status: "superseded", refs: ["svc.webhook"] }, "fp"),
    ...node("dev", "Ledger may compact snapshots", { kind: "decision", key: "acme.dev", project: "acme", status: "accepted", reason: "Storage", deviatesFrom: ["acme.d1"], refs: ["svc.ledger"] }, "fp"),
    ...node("q1", "Who owns refunds?", { kind: "open_question", key: "acme.q1", project: "acme", status: "open", refs: ["svc.webhook"] }, "fp"),
    ...node("m1", "Auth", { kind: "milestone", key: "acme.m1", project: "acme", order: 1 }, "fp"),
    ...node("i1", "Rotate tokens", { kind: "progress_item", key: "acme.i1", project: "acme", status: "in_progress", order: 2, refs: ["acme.m1"] }, "fp"),
    ...node("i2", "Login flow", { kind: "progress_item", key: "acme.i2", project: "acme", status: "done", order: 1, refs: ["acme.m1"] }, "fp"),
  ];
  return buildWorkspaceGraph([
    { canvasId: "arch", title: "Architecture", elements: arch },
    { canvasId: "state", title: "Project state", elements: state },
  ]);
}

describe("workspace graph", () => {
  it("addresses nodes by key and by id, across canvases, and walks the hierarchy through drill links", () => {
    const g = workspace();
    expect(resolve(g, "svc.webhook")).toMatchObject({ what: "node", id: "hook", canvasId: "arch", label: "Webhook" });
    expect(resolve(g, "hook")).toBe(resolve(g, "svc.webhook"));
    const hook = resolve(g, "svc.webhook")!;
    expect(ancestorsOf(g, hook).map((a) => (a.what === "node" ? a.label : a.title))).toEqual(["Payment service", "Payments", "System"]);
    expect(g.edges).toEqual([expect.objectContaining({ from: "svc.webhook", to: "svc.ledger", relation: "depends_on" })]);
  });
});

describe("warnings: the decision firewall (D36) with deviations (D45)", () => {
  it("a constraint on a node warns there; proposed and superseded decisions never warn", () => {
    const g = workspace();
    const w = warningsFor(g, ["svc.webhook"]);
    expect(w.map((x) => x.key)).toEqual(["acme.c1"]);
    expect(w[0]).toMatchObject({ kind: "constraint", statement: "Never retry card_declined", reason: "Fraud rules", appliesTo: ["svc.webhook"] });
  });

  it("a warning on an ancestor applies to what is under it", () => {
    const g = buildWorkspaceGraph([
      { canvasId: "arch", elements: [frame("f1", "System"), ...node("pay", "Payments", { kind: "backend", key: "p", expandsTo: { frameKey: "f2" } }, "f1"), frame("f2", "Svc"), ...node("h", "Hook", { kind: "backend", key: "h" }, "f2")] },
      { canvasId: "s", elements: [...node("c", "Payments is PCI scoped", { kind: "constraint", status: "accepted", refs: ["p"] })] },
    ]);
    expect(warningsFor(g, ["h"]).map((x) => x.statement)).toEqual(["Payments is PCI scoped"]);
  });

  it("an enforced decision warns with the deviation that covers this scope attached", () => {
    const w = warningsFor(workspace(), ["svc.ledger"]);
    expect(w).toEqual([expect.objectContaining({ key: "acme.d1", kind: "decision", deviation: { key: "acme.dev", statement: "Ledger may compact snapshots", reason: "Storage" } })]);
  });

  it("no scope, no warnings", () => {
    expect(warningsFor(workspace(), [])).toEqual([]);
  });
});

describe("project queries (D33, D39)", () => {
  it("resolves the only project, lists decisions about a node, and orders the plan", () => {
    const g = workspace();
    const r = resolveProject(g);
    expect(r).toMatchObject({ ok: true, project: { key: "acme", label: "Acme API", style: "service" } });
    if (!r.ok) return;
    expect(decisionsOf(g, r.project, "svc.webhook").map((d) => d.ref)).toEqual(["acme.d3", "acme.d2", "acme.c1"]);
    const plan = implementationPlan(g, r.project);
    expect(plan.milestones).toEqual([{ key: "acme.m1", label: "Auth", order: 1, items: [expect.objectContaining({ key: "acme.i2", status: "done" }), expect.objectContaining({ key: "acme.i1", status: "in_progress" })] }]);
  });

  it("refuses to guess between several projects", () => {
    const g = buildWorkspaceGraph([{ canvasId: "c", elements: [...node("a", "A", { kind: "project", key: "a" }), ...node("b", "B", { kind: "project", key: "b" })] }]);
    expect(resolveProject(g)).toMatchObject({ ok: false, reason: "several" });
    expect(resolveProject(g, "b")).toMatchObject({ ok: true, project: { key: "b" } });
  });
});

describe("impactOf (D54)", () => {
  it("modified, what depends on it, the levels above it, and the knowledge pointing at it", () => {
    const impact = impactOf(workspace(), ["svc.ledger", "nope"]);
    expect(impact.modified.map((m) => m.ref)).toEqual(["svc.ledger"]);
    expect(impact.affected.map((a) => a.label)).toEqual(["Webhook", "Payment service", "Payments", "System"]);
    expect(impact.related.map((r) => r.ref)).toEqual(expect.arrayContaining(["acme.d1", "acme.dev", "acme.c1", "acme.d2", "acme.d3", "acme.q1"]));
    expect(impact.unresolved).toEqual(["nope"]);
  });
});

describe("line-range matching and risk ranking", () => {
  const ranged = () =>
    buildWorkspaceGraph([
      {
        canvasId: "c",
        elements: [
          ...node("a", "A", { kind: "backend", key: "a", sources: [{ path: "src/a.ts", lines: [10, 20] }] }),
          ...node("b", "B", { kind: "backend", key: "b", sources: [{ path: "src/a.ts", lines: [50, 60] }, { path: "src/a.test.ts", role: "test" }] }),
          ...node("w", "Whole", { kind: "backend", key: "w", sources: [{ path: "src/a.ts" }] }),
          arrow("e1", "b", "a", "calls"),
        ],
      },
    ]);

  it("hits only nodes whose cited lines overlap the diff; no lines on either side is a file-level hit", () => {
    const r = nodesCitingChanges(ranged(), [{ path: "src/a.ts", lines: [[15, 16]] }]);
    expect(r.hit.map((h) => [h.node.ref, h.precision])).toEqual([["a", "lines"], ["w", "file"]]);
    expect(r.skipped.map((n) => n.ref)).toEqual(["b"]);
    expect(nodesCitingChanges(ranged(), [{ path: "./src/a.ts" }]).hit.map((h) => h.node.ref)).toEqual(["a", "b", "w"]);
  });

  it("ranks a changed node with dependents and warnings first, and lists untested changed nodes", () => {
    const g = ranged();
    const risk = riskOf(g, impactOf(g, ["a"]), new Map([["a", 1]]));
    expect(risk.ranked.map((r) => r.ref)).toEqual(["a", "b"]);
    expect(risk.ranked[0]).toMatchObject({ score: 3 + 1 + 2 + 2, reasons: ["changed", "1 dependent", "1 warning", "no linked test"] });
    expect(risk.untested).toEqual(["a"]);
  });
});

const record = (id: string, extra: Partial<AgentChangeRecord>): AgentChangeRecord => ({ id, workspaceId: "ws", canvasId: "arch", operationId: id, tool: "t", at: 1, outcome: "accepted", title: id, touched: [], inverse: [], revertible: false, ...extra });

describe("sessionContext (D29, D37; C2, C4, C5, B2)", () => {
  const base = { records: [] as AgentChangeRecord[], sessions: [] };

  it("scopes by keys first, with the warnings, decisions, questions and in-progress items for them", () => {
    const ctx = sessionContext(workspace(), { ...base, keys: ["svc.webhook"], budget: 8000 });
    expect(ctx.retrieval_mode).toBe("keys");
    expect(ctx.warnings.items.map((w) => w.key)).toEqual(["acme.c1"]);
    expect(ctx.architecture.items[0]).toMatchObject({ key: "svc.webhook", label: "Webhook", within: ["Payment service", "Payments", "System"] });
    expect(ctx.decisions.items.map((d) => d.key)).toEqual(expect.arrayContaining(["acme.c1", "acme.d2"]));
    expect(ctx.openQuestions.items.map((q) => q.key)).toEqual(["acme.q1"]);
    expect(ctx.inProgress.items.map((i) => i.key)).toEqual(["acme.i1"]);
    expect(ctx.project).toMatchObject({ key: "acme", focus: "Token rotation" });
  });

  it("falls back keys → paths → task, saying why (C2)", () => {
    const byPath = sessionContext(workspace(), { ...base, keys: ["gone"], paths: ["src/webhook.ts"] });
    expect(byPath).toMatchObject({ retrieval_mode: "paths", degraded_reason: "none of the keys resolved" });
    expect(byPath.architecture.items.map((a) => a.label)).toEqual(["Webhook"]);
    const byTask = sessionContext(workspace(), { ...base, task: "Fix the Ledger compaction" });
    expect(byTask.retrieval_mode).toBe("task");
    expect(byTask.architecture.items.map((a) => a.label)).toEqual(["Ledger"]);
  });

  it("the keyword pass finds a node through a decision's reason, capped per object (C4, C6)", () => {
    const ctx = sessionContext(workspace(), { ...base, task: "fraud fraud fraud fraud" });
    expect(ctx.retrieval_mode).toBe("task");
    expect(ctx.architecture.items.map((a) => a.label)).toEqual(["Webhook"]);
  });

  it("falls back to the open tab's focus, else says nothing was in scope", () => {
    expect(sessionContext(workspace(), { ...base, task: "zzz qqq", focus: ["ledger"] })).toMatchObject({ retrieval_mode: "focus", degraded_reason: "nothing matched the task" });
    expect(sessionContext(workspace(), { ...base, focus: [] })).toMatchObject({ retrieval_mode: "none" });
  });

  it("never exceeds its budget, and reports what each section dropped", () => {
    const many = Array.from({ length: 80 }, (_, i) => node(`q${i}`, `Question number ${i} about the webhook retries`, { kind: "open_question", project: "acme", status: "open", refs: ["svc.webhook"] }, "fp")).flat();
    const g = buildWorkspaceGraph([
      { canvasId: "arch", elements: [frame("f2", "Svc"), ...node("hook", "Webhook", { kind: "backend", key: "svc.webhook" }, "f2")] },
      { canvasId: "state", elements: [frame("fp", "State", { type: "architecture", interactive: true, profile: "project" }), ...node("proj", "Acme", { kind: "project", key: "acme" }, "fp"), ...many] },
    ]);
    for (const budget of [SESSION_CONTEXT_BUDGET.min, 1200, SESSION_CONTEXT_BUDGET.default]) {
      const ctx = sessionContext(g, { ...base, keys: ["svc.webhook"], budget });
      expect(JSON.stringify(ctx).length, `budget ${budget}`).toBeLessThanOrEqual(budget);
      expect(ctx.truncated).toBe(true);
      expect(ctx.openQuestions.dropped).toBeGreaterThan(0);
      // C5: the requested key still comes back.
      expect(ctx.architecture.items.length).toBeGreaterThan(0);
    }
  });

  it("returns the previous session's next and the user's rejections", () => {
    const ctx = sessionContext(workspace(), {
      records: [record("r1", { outcome: "rejected", title: "Codex: Retry declined cards", rejectReason: "Never retry card_declined", at: 5 })],
      sessions: [{ id: "s0", workspaceId: "ws", startedAt: 1, lastWriteAt: 2, changeIds: [], next: ["Wire the ledger"], summary: "Did auth" }],
      session: "s1",
      keys: ["svc.webhook"],
      budget: 8000,
    });
    expect(ctx.project).toMatchObject({ lastNext: ["Wire the ledger"], lastSummary: "Did auth" });
    expect(ctx.recentRejections.items).toEqual([expect.objectContaining({ title: "Codex: Retry declined cards", reason: "Never retry card_declined" })]);
  });

  it("stops when the request is cancelled (B2)", () => {
    const ac = new AbortController();
    ac.abort();
    expect(() => sessionContext(workspace(), { ...base, signal: ac.signal })).toThrow(SessionContextAborted);
  });
});

describe("sessionReview (D47)", () => {
  it("before, during and after for a session's records", () => {
    const g = workspace();
    const records = [
      record("r1", { session: "s1", touched: [{ elementId: "d2", key: "acme.d2", op: "create" }], at: 1 }),
      record("r2", { session: "s1", touched: [{ elementId: "hook", key: "svc.webhook", op: "update" }], inverse: [{ op: "restore", element: { id: "hook", type: "rectangle", customData: { acuteNode: { kind: "backend", sublabel: "old" } } } }], at: 2 }),
      record("r3", { session: "other", touched: [{ elementId: "ledger", op: "update" }] }),
    ];
    const review = sessionReview(g, { records, session: { id: "s1", workspaceId: "ws", startedAt: 0, changeIds: ["r1", "r2"], summary: "Dedup", next: ["Pick a store"] } });
    expect(review.changeIds).toEqual(["r1", "r2"]);
    expect(review.before).toEqual([
      { elementId: "d2", key: "acme.d2", op: "create", prior: null },
      { elementId: "hook", key: "svc.webhook", op: "update", prior: { type: "rectangle", kind: "backend", fields: { kind: "backend", sublabel: "old" } } },
    ]);
    expect(review.during).toEqual([{ key: "acme.d2", kind: "decision", label: "Use Redis for dedup", status: "proposed" }]);
    expect(review.after.openDecisions).toEqual([{ key: "acme.d2", label: "Use Redis for dedup", options: ["Redis", "Postgres"] }]);
    expect(review.after.needsReview).toEqual([{ ref: "svc.webhook", label: "Webhook" }]);
    expect(review.after.impact.modified.map((m) => m.ref)).toEqual(["svc.webhook"]);
    expect(review.session).toMatchObject({ summary: "Dedup", next: ["Pick a store"] });
  });
});

describe("workspace templates (setup plan Part B, §B3)", () => {
  for (const style of ["modular", "feature", "service", "custom"] as const) {
    it(`${style}: one project node with its style, a project frame, one empty L1 frame named for it — nothing invented`, () => {
      const t = projectTemplate({ name: "Acme API", style, at: { x: 0, y: 0 }, taken: new Set() });
      const shapes = t.changes.filter((c) => c.kind === "create_shape");
      const frames = t.changes.filter((c) => c.kind === "create_frame");
      expect(shapes).toHaveLength(1);
      expect(shapes[0]).toMatchObject({ project: { kind: "project", style, project: t.projectKey }, lensKey: t.projectKey });
      expect(frames.map((f) => [f.kind === "create_frame" && f.title, f.kind === "create_frame" && f.profile, f.kind === "create_frame" && f.children.length])).toEqual([
        ["Acme API · Project state", "project", 1],
        [TEMPLATE_L1[style].frame, undefined, 0],
      ]);
      expect(() => parseChangeSet({ operationId: "op", title: "t", metadata: { createdBy: "mcp" }, changes: t.changes })).not.toThrow();
    });
  }

  it("the starter plan adds one onboarding milestone and its three not-started tasks (setup plan Q3)", () => {
    const t = projectTemplate({ name: "Acme", style: "modular", starterPlan: true, at: { x: 0, y: 0 }, taken: new Set() });
    const shapes = t.changes.filter((c): c is Extract<typeof c, { kind: "create_shape" }> => c.kind === "create_shape");
    const milestone = shapes.find((s) => s.project?.kind === "milestone")!;
    const tasks = shapes.filter((s) => s.project?.kind === "progress_item");
    expect(tasks.map((s) => s.label)).toEqual([...STARTER_TASKS]);
    expect(tasks.every((s) => s.project?.status === "not_started" && s.project.refs?.[0] === milestone.lensKey)).toBe(true);
    expect(shapes.filter((s) => s.project?.kind === "decision" || s.project?.kind === "finding")).toEqual([]);
  });
});

describe("addProjectNodes", () => {
  it("places nodes in their lanes with unique keys, joins them to the frame, and links an item to a milestone added with it", () => {
    const { changes, keys } = addProjectNodes({
      frameId: "fp",
      frame: { x: 0, y: 0, width: 1000, height: 400 },
      members: [{ x: 24, y: 40, kind: "project" }],
      nodes: [
        { kind: "milestone", label: "Billing", fields: {} },
        { kind: "progress_item", label: "Invoices", fields: { status: "not_started" }, refsToNew: [0] },
      ],
      taken: new Set(["acme.billing"]),
      keyBase: "acme",
    });
    expect(keys).toEqual(["acme.billing-2", "acme.invoices"]);
    expect(changes.at(-1)).toEqual({ kind: "update_frame", target: "fp", add: ["n0", "n1"] });
    expect(changes[1]).toMatchObject({ project: { refs: ["acme.billing-2"] } });
  });
});
