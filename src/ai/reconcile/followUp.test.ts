/**
 * The follow-up-replies workflow (F38b), over the pure pipeline on the local
 * tier — the path a structured paste takes with or without an AI connection.
 * One note with four parts (title, "Rollout Steps" checklist, "Risks" and
 * "Owners" paragraphs), then two follow-up replies pasted over it:
 *
 *   reply 2 corrects the Risks sentence AND adds a rollback-mitigation paragraph;
 *   reply 3 corrects only Owners.
 *
 * Each Accept is simulated the way the writer does it: updated objects keep
 * their id with a new baseline, created ones get an id, connectors are drawn
 * (owned by the source) and removed ones dropped.
 */
import { describe, expect, it, vi } from "vitest";
import { parseChangeSet, type ChangeSet, type ProposedChange } from "@/ai/changes/changeSet";
import { AIProviderManager } from "@/ai/providerManager";
import { createMockProvider } from "@/ai/providers/mock/mockProvider";
import { createAIRuntime } from "@/ai/runtime";
import { createTaskRegistry } from "@/ai/tasks";
import { groupTitleKey, ungroup } from "@/ai/visual-plan/groups";
import type { VisualPlan } from "@/ai/visual-plan/types";
import { registerVisualizeTasks } from "@/ai/visualize/tasks";
import { visualizeContent } from "@/ai/visualize/visualize";
import type { ContentSource, ContentSourceVersion } from "@/domain/types";
import type { ExistingObject } from "./classify";
import type { ExistingConnection } from "./existing";
import { nodeFingerprint, nodeKind } from "./nodes";
import { paragraphChanges, paragraphSimilarity, splitExpansions } from "./paragraphs";
import { updateFromNewContent } from "./update";

const parse = (md: string) => [{ type: "paragraph" as const, content: md }];
const context = { existing: [], viewport: { x: 0, y: 0, width: 1600, height: 900 } };

const REPLY_1 = `# Database migration plan

## Rollout Steps

- [ ] Take a backup
- [ ] Run the migration
- [ ] Verify the users table

## Risks

The database migration may lock the users table during off-peak hours.

## Owners

The platform team owns the migration; the on-call DBA approves it.
`;
const RISK_V2 = "The database migration may lock the users table for about 90 seconds during off-peak hours.";
const MITIGATION = "Mitigation: if the lock lasts longer than two minutes, roll back with the prepared down-migration and retry in the next maintenance window.";
const REPLY_2 = REPLY_1.replace("The database migration may lock the users table during off-peak hours.", `${RISK_V2}\n\n${MITIGATION}`);
const REPLY_3 = REPLY_2.replace("the on-call DBA approves it.", "the on-call DBA and the security lead both approve it.");

interface CanvasState {
  source: ContentSource;
  previous: ContentSourceVersion;
  existing: ExistingObject[];
  connections: ExistingConnection[];
}

const KEY = {
  risks: "Database migration plan › Risks#text0",
  owners: "Database migration plan › Owners#text0",
  mitigation: "Database migration plan › Risks#text0 › detail#0",
};

let ids = 0;
/** What the canvas holds after accepting `set` on top of `state` (null state = first run). */
function acceptInto(state: CanvasState | null, set: ChangeSet): CanvasState {
  const cs = set.contentSource!;
  // A section (F42) is on the canvas as its title object, keyed like the section; its frame is never linked.
  const plan = ungroup(cs.plan as VisualPlan);
  const byKey = new Map((state?.existing ?? []).map((o) => [o.stableNodeKey, o] as const));
  const removed = new Set(set.changes.flatMap((c) => (c.kind === "remove" ? [c.target] : [])));
  const createdId = new Map<string, string>(); // change key (node id) → object id
  const existing: ExistingObject[] = [];
  for (const node of plan.nodes) {
    const created = set.changes.find(
      (c) => (c.kind === "create_block" || c.kind === "create_shape" || c.kind === "create_page") && (c.key === node.id || c.key === groupTitleKey(node.id)),
    );
    const prior = byKey.get(node.stableKey!);
    if (!created && (!prior || removed.has(prior.objectId))) continue;
    const objectId = created ? `el_${++ids}` : prior!.objectId;
    if (created) createdId.set(node.id, objectId);
    const fp = nodeFingerprint(node, parse);
    const box = created && "box" in created ? created.box : prior!.box;
    existing.push({ objectId, stableNodeKey: node.stableKey!, baseline: fp, current: fp, excluded: false, box, ...nodeKind(node) });
  }
  const end = (t: { existing: string } | { created: string }) => ("existing" in t ? t.existing : createdId.get(t.created)!);
  const connections = [
    ...(state?.connections ?? []).filter((c) => !removed.has(c.arrowId) && !removed.has(c.from) && !removed.has(c.to)),
    ...set.changes.flatMap((c) => (c.kind === "connect" ? [{ arrowId: `arrow_${++ids}`, from: end(c.from), to: end(c.to), ownedBySource: true }] : [])),
  ];
  const source: ContentSource = { id: cs.sourceId, workspaceId: "ws", canvasId: "cv", origin: "paste", tier: cs.tier, template: cs.template, latestVersion: cs.version, createdAt: 1, updatedAt: 1 };
  return { source, previous: { sourceId: cs.sourceId, version: cs.version, text: cs.text, plan: cs.plan, createdAt: 1 }, existing, connections };
}

function noModel() {
  const manager = new AIProviderManager();
  const registry = createTaskRegistry();
  registerVisualizeTasks(registry);
  const spy = vi.fn(() => {
    throw new Error("the local tier never calls a model");
  });
  manager.registerProvider(createMockProvider({ id: "mock", respond: spy }));
  manager.setPrimary("mock");
  return { runtime: createAIRuntime({ manager, registry }), spy };
}

const update = (state: CanvasState, text: string, runtime: ReturnType<typeof noModel>["runtime"]) =>
  updateFromNewContent({ ...state, text, operationId: "op", title: "Update from new content", context }, runtime, { parseMarkdown: parse });

const objectOf = (s: CanvasState, key: string) => s.existing.find((o) => o.stableNodeKey === key)!;
const textOf = (c: ProposedChange) => ("content" in c ? JSON.stringify(c.content) : "");

describe("follow-up replies pasted over one note (local tier)", async () => {
  const { runtime, spy } = noModel();
  const first = await visualizeContent({ text: REPLY_1, operationId: "op_1", title: "Visualize", context }, runtime, { parseMarkdown: parse });
  const v1 = acceptInto(null, first.changeSet);
  const r2 = await update(v1, REPLY_2, runtime);
  const v2 = acceptInto(v1, r2.changeSet!);
  const r3 = await update(v2, REPLY_3, runtime);

  it("the first paste is one structured note: title, Rollout Steps checklist, Risks and Owners paragraphs", () => {
    const kinds = v1.existing.map((o) => o.blockType ?? o.shape);
    expect(kinds).toContain("todo");
    expect(v1.existing.map((o) => o.stableNodeKey)).toEqual(expect.arrayContaining([KEY.risks, KEY.owners]));
    expect(spy).not.toHaveBeenCalled();
  });

  it("Test 1 — reply 2 touches only what changed: one update, of the Risks paragraph, and nothing else rewritten", () => {
    const set = r2.changeSet!;
    expect(() => parseChangeSet(set)).not.toThrow();
    const updates = set.changes.filter((c) => c.kind === "update_block" || c.kind === "update_shape");
    expect(updates).toHaveLength(1);
    expect(updates[0]).toMatchObject({ kind: "update_block", target: objectOf(v1, KEY.risks).objectId });
    expect(textOf(updates[0]!)).toContain("about 90 seconds");
    expect(set.changes.some((c) => c.kind === "remove")).toBe(false); // no title, checklist or Owners rebuilt
    expect(set.conflicts ?? []).toEqual([]);
  });

  it("Test 2 — the mitigation is its own new block; Risks is updated in place, not duplicated or merged", () => {
    const set = r2.changeSet!;
    const created = set.changes.filter((c) => c.kind === "create_block");
    expect(created).toHaveLength(1);
    expect(textOf(created[0]!)).toContain("roll back with the prepared down-migration");
    const risksUpdate = set.changes.find((c) => c.kind === "update_block")!;
    expect(textOf(risksUpdate)).not.toContain("Mitigation"); // no merged wall of text
    // Same Risks object afterwards (updated in place), plus exactly one new one.
    expect(objectOf(v2, KEY.risks).objectId).toBe(objectOf(v1, KEY.risks).objectId);
    expect(v2.existing).toHaveLength(v1.existing.length + 1);
    // Placed below the Risks block, in line with it.
    const risksBox = objectOf(v1, KEY.risks).box!;
    const box = (created[0] as Extract<ProposedChange, { kind: "create_block" }>).box;
    expect(box.x).toBe(risksBox.x);
    expect(box.y).toBeGreaterThan(risksBox.y + risksBox.height);
  });

  it("Test 3 — the new block is linked to Risks (explained_by), not floating", () => {
    const link = r2.changeSet!.changes.find((c) => c.kind === "connect");
    expect(link).toMatchObject({ from: { existing: objectOf(v1, KEY.risks).objectId }, relation: "explained_by" });
    expect(v2.connections).toEqual([expect.objectContaining({ from: objectOf(v2, KEY.risks).objectId, to: objectOf(v2, KEY.mitigation).objectId })]);
  });

  it("Test 4 — reply 3 still proposes only what changed: one update, of Owners; Risks, the mitigation and the link stay", () => {
    const set = r3.changeSet!;
    expect(set.changes).toEqual([expect.objectContaining({ kind: "update_block", target: objectOf(v2, KEY.owners).objectId })]);
    expect(textOf(set.changes[0]!)).toContain("security lead");
    expect(set.conflicts ?? []).toEqual([]);
    expect(spy).not.toHaveBeenCalled();
  });

  it("Test 4b — pasting reply 3 again (nothing new) proposes nothing at all", async () => {
    const v3 = acceptInto(v2, r3.changeSet!);
    expect((await update(v3, REPLY_3, runtime)).changeSet).toBeNull();
  });
});

describe("splitExpansions", () => {
  const plan = (nodes: VisualPlan["nodes"]): VisualPlan => ({ version: 1, template: "action_plan", nodes, relationships: [] });
  const text = (key: string, markdown: string) => ({ id: key, stableKey: key, type: "text" as const, content: { markdown } });

  it("leaves a first run and an unchanged section alone", () => {
    const p = plan([text("s#text0", "One.\n\nTwo.")]);
    expect(splitExpansions(p, plan([]))).toEqual(p);
    expect(splitExpansions(p, p)).toEqual(p);
  });

  it("a rewritten paragraph (nothing left in common) replaces the section's own text, rather than becoming detail", () => {
    const out = splitExpansions(plan([text("s#text0", "Completely different wording now.")]), plan([text("s#text0", "The lock lasts a while.")]));
    expect(out.nodes).toHaveLength(1);
  });

  it("an explanation removed from the content is left out (a proposed removal), and numbers are never reused", () => {
    const previous = plan([text("s#text0", "Risk sentence here."), text("s#text0 › detail#0", "First detail paragraph."), text("s#text0 › detail#1", "Second detail paragraph.")]);
    const out = splitExpansions(plan([text("s#text0", "Risk sentence here.\n\nSecond detail paragraph.\n\nA brand new third point.")]), previous);
    expect(out.nodes.map((n) => n.stableKey)).toEqual(["s#text0", "s#text0 › detail#1", "s#text0 › detail#2"]);
    expect(out.relationships.every((r) => r.type === "explained_by" && r.from === "s#text0")).toBe(true);
  });

  it("paragraph similarity: a correction still matches, a different point doesn't", () => {
    expect(paragraphSimilarity("The migration may lock the users table during off-peak hours.", RISK_V2)).toBeGreaterThanOrEqual(0.5);
    expect(paragraphSimilarity("The migration may lock the users table during off-peak hours.", MITIGATION)).toBeLessThan(0.5);
  });
});

describe("paragraphChanges — how a section's text changed, as facts for the model", () => {
  const RISKS_1 = "## Risks\n\nThe database migration may lock the users table during off-peak hours.";
  const RISKS_2 = `## Risks\n\n${RISK_V2}\n\n${MITIGATION}`;

  it("reply 2's Risks: the sentence was edited (corrected), the mitigation paragraph was added", () => {
    expect(paragraphChanges(RISKS_1, RISKS_2)).toEqual({ edited: [RISK_V2], added: [MITIGATION] });
  });

  it("reply 3's Owners: one sentence edited, nothing added — so no new node is needed", () => {
    const before = "## Owners\n\nThe platform team owns the migration; the on-call DBA approves it.";
    const after = "## Owners\n\nThe platform team owns the migration; the on-call DBA and the security lead both approve it.";
    expect(paragraphChanges(before, after)).toEqual({ edited: [after.split("\n\n")[1]], added: [] });
  });

  it("an unchanged paragraph is neither; headings are ignored", () => {
    expect(paragraphChanges("## A\n\nSame text.", "## A renamed\n\nSame text.")).toEqual({ edited: [], added: [] });
  });
});
