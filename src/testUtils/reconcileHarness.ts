/**
 * Shared harness for "Update from new content" tests (F38): first run (F31) → pretend-accept (objects as the writer
 * would stamp them) → update with new text. A real AIProviderManager + task registry + MockProvider, never the
 * singletons. Used by `reconcile/update.test.ts` and the topic-merge tests (chat-share-import plan, G0).
 */
import { vi } from "vitest";
import type { ChangeSet } from "@/ai/changes/changeSet";
import { registerMergeTasks } from "@/ai/merge/assign";
import { registerRevisionTasks } from "@/ai/history/revisions";
import { AIProviderManager } from "@/ai/providerManager";
import { createMockProvider } from "@/ai/providers/mock/mockProvider";
import type { ExistingObject } from "@/ai/reconcile/classify";
import { nodeFingerprint, nodeKind } from "@/ai/reconcile/nodes";
import { updateFromNewContent } from "@/ai/reconcile/update";
import { createAIRuntime, type AIRuntime } from "@/ai/runtime";
import { createTaskRegistry } from "@/ai/tasks";
import type { AIRequest, AIResponse } from "@/ai/types";
import { ungroup } from "@/ai/visual-plan/groups";
import type { VisualNode, VisualPlan } from "@/ai/visual-plan/types";
import { registerVisualizeTasks } from "@/ai/visualize/tasks";
import { visualizeContent } from "@/ai/visualize/visualize";
import type { ContentSource, ContentSourceVersion } from "@/domain/types";

export const parse = (md: string) => [{ type: "paragraph" as const, content: md }];
export const context = { existing: [], viewport: { x: 0, y: 0, width: 1200, height: 800 } };
export const response = (text: string): AIResponse => ({ text, model: "m", finishReason: "stop", usage: { provider: "mock", model: "m" } });

/** A mock model: one shape per unit, labelled with the unit's own text — so changed text gives a changed node. */
export function modelReply(req: AIRequest): AIResponse {
  const body = req.prompt.split("Content to visualize:\n\n")[1] ?? "";
  return response(JSON.stringify({ version: 1, template: "architecture", nodes: [{ id: "n1", type: "shape", content: { shape: "rectangle", label: body.slice(0, 250) } }], relationships: [] }));
}

export function runtimeWith(respond: (req: AIRequest) => AIResponse) {
  const manager = new AIProviderManager();
  const registry = createTaskRegistry();
  registerVisualizeTasks(registry);
  registerMergeTasks(registry);
  registerRevisionTasks(registry);
  const spy = vi.fn(respond);
  manager.registerProvider(createMockProvider({ id: "mock", respond: spy }));
  manager.setPrimary("mock");
  return { runtime: createAIRuntime({ manager, registry }), spy };
}

export type Accepted = { source: ContentSource; previous: ContentSourceVersion; existing: ExistingObject[] };

/** Accepts a first-run change set as the writer would: one object per node (a section, F42: its title), stamped with its key and baseline. */
export function accepted(set: ChangeSet, edits: Record<string, string> = {}): Accepted {
  const cs = set.contentSource!;
  const plan = ungroup(cs.plan as VisualPlan);
  // Where the writer put each object, and the section frame (F42) it is in.
  const nodeOfKey = (k: string) => (k.endsWith("::title") ? k.slice(0, -"::title".length) : k);
  const boxOf = new Map(set.changes.flatMap((c) => ("box" in c && c.kind !== "create_frame" ? [[nodeOfKey(c.key), c.box] as const] : [])));
  const frameOf = new Map(set.changes.flatMap((c) => (c.kind === "create_frame" ? c.children.map((k) => [nodeOfKey(k), `el_frame_${c.key}`] as const) : [])));
  const existing = plan.nodes.map((n): ExistingObject => {
    const baseline = nodeFingerprint(n, parse);
    const box = boxOf.get(n.id);
    const frameId = frameOf.get(n.id);
    return {
      objectId: `el_${n.id}`,
      stableNodeKey: n.stableKey!,
      baseline,
      current: edits[n.stableKey!] ?? baseline,
      excluded: false,
      ...nodeKind(n),
      ...(box ? { box } : {}),
      ...(frameId ? { frameId } : {}),
    };
  });
  const source: ContentSource = { id: cs.sourceId, workspaceId: "ws", canvasId: "cv", origin: "paste", tier: cs.tier, template: cs.template, latestVersion: 1, createdAt: 1, updatedAt: 1 };
  return { source, previous: { sourceId: cs.sourceId, version: 1, text: cs.text, plan: cs.plan, ...(cs.revisions ? { revisions: cs.revisions } : {}), createdAt: 1 }, existing };
}

/**
 * Accepts an update's change set on top of `a`, as the writer would: updated objects get their new baseline, removed
 * ones are gone, created ones are stamped like a first run's (without boxes or frames), and the next version (with
 * its `pathIds`) becomes `previous`.
 */
export function acceptUpdate(a: Accepted, set: ChangeSet): Accepted {
  const cs = set.contentSource!;
  const plan = ungroup(cs.plan as VisualPlan);
  const removed = new Set(set.changes.flatMap((c) => (c.kind === "remove" ? [c.target] : [])));
  const stamped = (n: VisualNode): Pick<ExistingObject, "baseline" | "current"> => {
    const fingerprint = nodeFingerprint(n, parse);
    return { baseline: fingerprint, current: fingerprint };
  };
  const kept = a.existing
    .filter((o) => !removed.has(o.objectId))
    .map((o) => {
      const node = plan.nodes.find((n) => n.stableKey === o.stableNodeKey);
      return node ? { ...o, ...stamped(node) } : o;
    });
  const nodeOfKey = (k: string) => (k.endsWith("::title") ? k.slice(0, -"::title".length) : k);
  const createdIds = new Set(set.changes.flatMap((c) => ((c.kind === "create_block" || c.kind === "create_shape" || c.kind === "create_page") && "key" in c ? [nodeOfKey(c.key)] : [])));
  const created = plan.nodes
    .filter((n) => createdIds.has(n.id) && n.stableKey)
    .map((n): ExistingObject => ({ objectId: `el_${n.id}`, stableNodeKey: n.stableKey!, excluded: false, ...stamped(n), ...nodeKind(n) }));
  const existing = [...kept, ...created];
  const previous: ContentSourceVersion = { sourceId: cs.sourceId, version: cs.version, text: cs.text, plan: cs.plan, ...(cs.pathIds ? { pathIds: cs.pathIds } : {}), ...(cs.revisions ? { revisions: cs.revisions } : {}), createdAt: cs.version };
  return { source: { ...a.source, latestVersion: cs.version }, previous, existing };
}

export async function firstRun(text: string, runtime: AIRuntime = runtimeWith(modelReply).runtime, template?: "architecture") {
  const { changeSet } = await visualizeContent({ text, operationId: "op_1", title: "Visualize", context, ...(template ? { template } : {}) }, runtime, { parseMarkdown: parse });
  return changeSet;
}

export const update = (a: Accepted, text: string, runtime: AIRuntime) =>
  updateFromNewContent({ ...a, text, operationId: "op_2", title: "Update from new content", context }, runtime, { parseMarkdown: parse });
