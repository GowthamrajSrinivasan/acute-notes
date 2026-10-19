/**
 * F38b — conceptual (not textual) updates, over the pure pipeline with a
 * scripted model. The running example is the PRD's (§13.15.19a):
 *
 *   Firebase Auth → Backend validates token → Session created
 *
 * - a rewording changes nothing on the canvas;
 * - a changed concept (an org-membership check before the session) adds one
 *   step and rewires the flow, touching none of the existing steps;
 * - an expansion (JWT/claims detail) adds a child explanation *below* its
 *   concept, linked `explained_by`, and leaves the flow as it was;
 * - a changed concept the user edited is still a conflict, never overwritten.
 *
 * The model here follows the protocol exactly, so these tests pin down what
 * the *app* does with each kind of answer; `e2e/ai/semanticUpdate.spec.ts`
 * checks what a real model answers.
 */
import { ungroup } from "@/ai/visual-plan/groups";
import { describe, expect, it, vi } from "vitest";
import { parseChangeSet, type ChangeSet, type ProposedChange } from "@/ai/changes/changeSet";
import { AIProviderManager } from "@/ai/providerManager";
import { createMockProvider } from "@/ai/providers/mock/mockProvider";
import { createAIRuntime } from "@/ai/runtime";
import { createTaskRegistry } from "@/ai/tasks";
import type { AIRequest, AIResponse } from "@/ai/types";
import type { VisualPlan } from "@/ai/visual-plan/types";
import { registerVisualizeTasks } from "@/ai/visualize/tasks";
import { visualizeContent } from "@/ai/visualize/visualize";
import type { ContentSource, ContentSourceVersion } from "@/domain/types";
import type { ExistingObject } from "./classify";
import type { ExistingConnection } from "./existing";
import { nodeFingerprint, nodeKind } from "./nodes";
import { updateFromNewContent } from "./update";

const parse = (md: string) => [{ type: "paragraph" as const, content: md }];
const context = { existing: [], viewport: { x: 0, y: 0, width: 1600, height: 900 } };
const json = (v: unknown): AIResponse => ({ text: JSON.stringify(v), model: "m", finishReason: "stop", usage: { provider: "mock", model: "m" } });

const V1 = "## Authentication\n\nUsers sign in with Firebase Auth. The backend validates the token. Then a session is created.\n";
const REWORDED = "## Authentication\n\nUsers sign in with Firebase Auth. The backend is responsible for validating the token. After that, a session is created.\n";
const ORG_CHECK = V1.replace("Then a session is created.", "The backend now also checks the user's organization membership before creating the session.");
const JWT = V1.replace(
  "Then a session is created.",
  "Then a session is created. Firebase Authentication uses JWT-based ID tokens, which contain claims such as user ID, email and custom claims.",
);

const shape = (id: string, stableKey: string, label: string) => ({ id, stableKey, type: "shape", content: { shape: "rectangle", label } });
const FIRST = json({
  version: 1,
  template: "flow",
  nodes: [shape("n1", "firebase", "Firebase Auth"), shape("n2", "validate", "Backend validates token"), shape("n3", "session", "Session created")],
  relationships: [
    { from: "n1", to: "n2", type: "relates_to" },
    { from: "n2", to: "n3", type: "relates_to" },
  ],
});
const KEEP = [
  { id: "p1", unchanged: true },
  { id: "p2", unchanged: true },
  { id: "p3", unchanged: true },
];
const FLOW = [
  { from: "p1", to: "p2", type: "relates_to" },
  { from: "p2", to: "p3", type: "relates_to" },
];

function scripted() {
  let next: AIResponse = FIRST;
  const manager = new AIProviderManager();
  const registry = createTaskRegistry();
  registerVisualizeTasks(registry);
  const spy = vi.fn((_req: AIRequest) => next);
  manager.registerProvider(createMockProvider({ id: "mock", respond: spy }));
  manager.setPrimary("mock");
  return { runtime: createAIRuntime({ manager, registry }), spy, reply: (r: AIResponse) => (next = r) };
}

/**
 * Pretend-accept a first run as the writer would: one object per node (with its box), one owned arrow per link.
 * A section (F42) is its title object (the group's key); its frame is never linked to the source.
 */
function accepted(set: ChangeSet, edits: Record<string, string> = {}) {
  const cs = set.contentSource!;
  const plan = ungroup(cs.plan as VisualPlan);
  const boxes = new Map(
    set.changes.flatMap((c) => ("box" in c && "key" in c && c.kind !== "create_frame" ? [[c.key.replace(/::title$/, ""), c.box] as const] : [])),
  );
  const existing = plan.nodes.map((n): ExistingObject => {
    const baseline = nodeFingerprint(n, parse);
    return { objectId: `el_${n.stableKey}`, stableNodeKey: n.stableKey!, baseline, current: edits[n.stableKey!] ?? baseline, excluded: false, box: boxes.get(n.id), ...nodeKind(n) };
  });
  const objectOf = new Map(plan.nodes.map((n) => [n.id, `el_${n.stableKey}`] as const));
  const connections: ExistingConnection[] = plan.relationships.map((r, i) => ({ arrowId: `arrow_${i}`, from: objectOf.get(r.from)!, to: objectOf.get(r.to)!, ownedBySource: true }));
  const source: ContentSource = { id: cs.sourceId, workspaceId: "ws", canvasId: "cv", origin: "paste", tier: cs.tier, template: cs.template, latestVersion: 1, createdAt: 1, updatedAt: 1 };
  const previous: ContentSourceVersion = { sourceId: cs.sourceId, version: 1, text: cs.text, plan: cs.plan, createdAt: 1 };
  return { source, previous, existing, connections };
}

async function setup(edits: Record<string, string> = {}) {
  const s = scripted();
  const { changeSet } = await visualizeContent({ text: V1, template: "flow", operationId: "op_1", title: "Visualize", context }, s.runtime, { parseMarkdown: parse });
  const a = accepted(changeSet, edits);
  s.spy.mockClear();
  const update = (text: string) => updateFromNewContent({ ...a, text, operationId: "op_2", title: "Update from new content", context }, s.runtime, { parseMarkdown: parse });
  return { ...s, a, update };
}

const key = (k: string) => `Authentication § ${k}`;
const kinds = (changes: readonly ProposedChange[]) => changes.map((c) => c.kind).sort();

describe("F38b — the model sees the section's current representation", () => {
  it("an update sends the current nodes under p-ids with unit-local keys, and the rules for conceptual changes", async () => {
    const { reply, spy, update } = await setup();
    reply(json({ version: 1, template: "flow", nodes: KEEP, relationships: FLOW }));
    await update(REWORDED);
    const prompt = spy.mock.calls[0]![0].prompt;
    expect(prompt).toContain("Current representation:");
    expect(prompt).toContain('"id":"p2","stableKey":"validate"');
    expect(prompt).not.toContain("Authentication § "); // keys are shown unit-local
    expect(prompt).toContain('"unchanged":true');
    expect(prompt).toContain("explained_by");
  });
});

describe("F38b — what changed in meaning, not in wording", () => {
  it("a rewording the model reports as unchanged: nothing to review, the flow stays exactly as it is", async () => {
    const { reply, update } = await setup();
    reply(json({ version: 1, template: "flow", nodes: KEEP, relationships: FLOW }));
    const r = await update(REWORDED);
    expect(r.reanalyzedUnits).toEqual(["Authentication"]); // the text did change…
    expect(r.changeSet).toBeNull(); // …but no concept did
    expect(r.reconciliation.items.every((i) => i.state === "unchanged")).toBe(true);
  });

  it("a changed concept: the new step is added and the flow rewired; no existing step is rewritten", async () => {
    const { reply, update } = await setup();
    reply(
      json({
        version: 1,
        template: "flow",
        nodes: [...KEEP, shape("n4", "org-check", "Check organization membership")],
        relationships: [
          { from: "p1", to: "p2", type: "relates_to" },
          { from: "p2", to: "n4", type: "relates_to" },
          { from: "n4", to: "p3", type: "relates_to" },
        ],
      }),
    );
    const r = await update(ORG_CHECK);
    const set = r.changeSet!;
    expect(() => parseChangeSet(set)).not.toThrow();
    expect(kinds(set.changes)).toEqual(["connect", "connect", "create_shape", "remove"]);
    expect(set.changes.find((c) => c.kind === "create_shape")).toMatchObject({ label: "Check organization membership", stableNodeKey: key("org-check") });
    // validate → org-check → session; the old validate → session arrow (arrow_1) goes, the user never loses a step.
    expect(set.changes.filter((c) => c.kind === "connect")).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ from: { existing: `el_${key("validate")}` }, to: { created: expect.any(String) } }),
        expect.objectContaining({ from: { created: expect.any(String) }, to: { existing: `el_${key("session")}` } }),
      ]),
    );
    expect(set.changes.find((c) => c.kind === "remove")).toEqual({ kind: "remove", target: "arrow_1" });
    expect(set.changes.some((c) => c.kind === "update_shape" || c.kind === "update_block")).toBe(false);
  });

  it("an expansion: a child explanation below its concept, linked explained_by; the flow itself is untouched", async () => {
    const { reply, update, a } = await setup();
    reply(
      json({
        version: 1,
        template: "flow",
        nodes: [...KEEP, { id: "n5", stableKey: "firebase-tokens", type: "text", title: "Firebase ID tokens", content: { markdown: "JWT-based ID tokens. Claims include user ID, email and custom claims." } }],
        relationships: [...FLOW, { from: "p1", to: "n5", type: "explained_by" }],
      }),
    );
    const r = await update(JWT);
    const set = r.changeSet!;
    expect(kinds(set.changes)).toEqual(["connect", "create_block"]);
    const block = set.changes.find((c) => c.kind === "create_block")!;
    const parent = a.existing.find((o) => o.stableNodeKey === key("firebase"))!.box!;
    // Hangs below "Firebase Auth", in line with it — not appended to the flow.
    expect(block.box.x).toBe(parent.x);
    expect(block.box.y).toBeGreaterThan(parent.y + parent.height);
    expect(set.changes.find((c) => c.kind === "connect")).toMatchObject({ from: { existing: `el_${key("firebase")}` }, relation: "explained_by" });
    // No existing step changed, no arrow removed.
    expect(set.changes.some((c) => c.kind === "remove" || c.kind === "update_shape")).toBe(false);
  });

  it("a changed concept the user edited is a conflict, not an update — the edit is never overwritten", async () => {
    const { reply, update } = await setup({ [key("validate")]: "user-edited" });
    reply(
      json({
        version: 1,
        template: "flow",
        nodes: [KEEP[0], shape("p2", "validate", "Backend validates token and org membership"), KEEP[2]],
        relationships: FLOW,
      }),
    );
    const r = await update(ORG_CHECK);
    expect(r.changeSet!.changes).toEqual([]);
    expect(r.changeSet!.conflicts).toHaveLength(1);
    expect(r.changeSet!.conflicts![0]).toMatchObject({ target: `el_${key("validate")}`, apply: { kind: "update_shape", label: "Backend validates token and org membership" } });
  });

  it("a changed concept on an untouched step is a clean update of that step alone", async () => {
    const { reply, update } = await setup();
    reply(json({ version: 1, template: "flow", nodes: [KEEP[0], shape("p2", "validate", "Backend validates token and org membership"), KEEP[2]], relationships: FLOW }));
    const r = await update(ORG_CHECK);
    expect(r.changeSet!.changes).toEqual([expect.objectContaining({ kind: "update_shape", target: `el_${key("validate")}` })]);
  });

  it("a step the model drops is a proposed removal (with its arrows), never silent", async () => {
    const { reply, update } = await setup();
    reply(json({ version: 1, template: "flow", nodes: [KEEP[0], KEEP[2]], relationships: [{ from: "p1", to: "p3", type: "relates_to" }] }));
    const r = await update("## Authentication\n\nUsers sign in with Firebase Auth. Then a session is created.\n");
    const set = r.changeSet!;
    expect(set.changes).toEqual(expect.arrayContaining([{ kind: "remove", target: `el_${key("validate")}` }]));
    // Firebase → session is linked directly now.
    expect(set.changes).toEqual(expect.arrayContaining([expect.objectContaining({ kind: "connect", from: { existing: `el_${key("firebase")}` }, to: { existing: `el_${key("session")}` } })]));
  });

  it("an arrow the user drew is never removed, and a link that any arrow already makes is never drawn twice", async () => {
    const { reply, update, a } = await setup();
    // The user added their own arrow session → firebase; this source's validate → session arrow is theirs now too (not owned).
    a.connections.push({ arrowId: "user_arrow", from: `el_${key("session")}`, to: `el_${key("firebase")}`, ownedBySource: false });
    a.connections[1] = { ...a.connections[1]!, ownedBySource: false };
    reply(json({ version: 1, template: "flow", nodes: KEEP, relationships: [{ from: "p1", to: "p2", type: "relates_to" }, { from: "p1", to: "p3", type: "relates_to" }] }));
    const r = await update(REWORDED);
    // firebase → session is already linked (by the user's arrow, reversed): nothing to draw; validate → session isn't ours: nothing to remove.
    expect(r.changeSet).toBeNull();
  });
});

describe("F41 — adds go where they belong, making room locally", () => {
  /** The canvas as local reflow sees it: the source's objects (still where Acute put them), plus any extra ones. */
  const withObjects = (a: Awaited<ReturnType<typeof setup>>["a"], extra: { id: string; box: { x: number; y: number; width: number; height: number } }[] = []) => ({
    ...context,
    objects: [...a.existing.map((o) => ({ id: o.objectId, box: o.box! })), ...extra].map((o) => ({ ...o, unit: o.id, locked: false, placedByAcute: true })),
  });

  it("a new flow step goes in line after the step it follows; only the steps after it move along", async () => {
    const s = await setup();
    s.reply(
      json({
        version: 1,
        template: "flow",
        nodes: [...KEEP, shape("n4", "org-check", "Check organization membership")],
        relationships: [
          { from: "p1", to: "p2", type: "relates_to" },
          { from: "p2", to: "n4", type: "relates_to" },
          { from: "n4", to: "p3", type: "relates_to" },
        ],
      }),
    );
    const r = await updateFromNewContent({ ...s.a, text: ORG_CHECK, operationId: "op_2", title: "Update", context: withObjects(s.a) }, s.runtime, { parseMarkdown: parse });
    const set = r.changeSet!;
    expect(() => parseChangeSet(set)).not.toThrow();
    const box = (k: string) => s.a.existing.find((o) => o.stableNodeKey === key(k))!.box!;
    const step = set.changes.find((c) => c.kind === "create_shape")!;
    expect(step.box).toMatchObject({ x: box("validate").x + box("validate").width + 64, y: box("validate").y });
    const moves = set.changes.filter((c) => c.kind === "move");
    expect(moves).toEqual([{ kind: "move", target: `el_${key("session")}`, to: { x: step.box.x + step.box.width + 64, y: box("session").y } }]);
  });

  it("an explanation goes directly below its concept, pushing down what was there; nothing else moves", async () => {
    const s = await setup();
    const firebase = s.a.existing.find((o) => o.stableNodeKey === key("firebase"))!.box!;
    const under = { id: "under", box: { x: firebase.x, y: firebase.y + firebase.height + 64, width: firebase.width, height: 80 } };
    s.reply(
      json({
        version: 1,
        template: "flow",
        nodes: [...KEEP, { id: "n5", stableKey: "firebase-tokens", type: "text", title: "Firebase ID tokens", content: { markdown: "JWT-based ID tokens. Claims include user ID, email and custom claims." } }],
        relationships: [...FLOW, { from: "p1", to: "n5", type: "explained_by" }],
      }),
    );
    const r = await updateFromNewContent({ ...s.a, text: JWT, operationId: "op_2", title: "Update", context: withObjects(s.a, [under]) }, s.runtime, { parseMarkdown: parse });
    const set = r.changeSet!;
    expect(() => parseChangeSet(set)).not.toThrow();
    const block = set.changes.find((c) => c.kind === "create_block")!;
    expect(block.box).toMatchObject({ x: firebase.x, y: firebase.y + firebase.height + 64 });
    expect(set.changes.filter((c) => c.kind === "move")).toEqual([{ kind: "move", target: "under", to: { x: under.box.x, y: block.box.y + block.box.height + 64 } }]);
  });

  it("without the scene's objects, nothing is ever moved (free-space placement only)", async () => {
    const s = await setup();
    s.reply(
      json({
        version: 1,
        template: "flow",
        nodes: [...KEEP, shape("n4", "org-check", "Check organization membership")],
        relationships: [
          { from: "p2", to: "n4", type: "relates_to" },
          { from: "n4", to: "p3", type: "relates_to" },
        ],
      }),
    );
    const r = await s.update(ORG_CHECK);
    expect(r.changeSet!.changes.some((c) => c.kind === "move")).toBe(false);
  });
});

describe("F38b — new detail linked generically to an existing concept is typed as its explanation", () => {
  const detail = { id: "n5", stableKey: "firebase-tokens", type: "text", content: { markdown: "JWT-based ID tokens with claims." } };

  it("a new note joined to one existing concept by relates_to (either direction) becomes its explained_by child", async () => {
    const { reply, update } = await setup();
    // What Gemini actually does: the right structure, but a generic link type, pointing from the detail to the concept.
    reply(json({ version: 1, template: "flow", nodes: [...KEEP, detail], relationships: [...FLOW, { from: "n5", to: "p1", type: "relates_to" }] }));
    const set = (await update(JWT)).changeSet!;
    expect(set.changes.find((c) => c.kind === "connect")).toMatchObject({ from: { existing: `el_${key("firebase")}` }, to: { created: expect.any(String) }, relation: "explained_by" });
  });

  it("a specific link type, a new flow step (a shape) or a note linked to two concepts is left as the model gave it", async () => {
    const { reply, update } = await setup();
    reply(
      json({
        version: 1,
        template: "flow",
        nodes: [...KEEP, detail, shape("n6", "org-check", "Check organization membership")],
        relationships: [...FLOW, { from: "p1", to: "n5", type: "depends_on" }, { from: "p2", to: "n6", type: "relates_to" }],
      }),
    );
    const connects = (await update(ORG_CHECK)).changeSet!.changes.filter((c) => c.kind === "connect");
    expect(connects.map((c) => (c as { relation?: string }).relation).sort()).toEqual(["depends_on", "relates_to"]);
  });
});
