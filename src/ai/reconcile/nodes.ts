/**
 * A node as the writer would store it (F38): its fingerprint (the same
 * mapping + canonicalisation the writer's baseline uses, so "proposed ==
 * baseline" comparisons are meaningful), its object kind, and the in-place
 * update change for an existing object.
 */
import type { ProposedChange } from "@/ai/changes/changeSet";
import { fingerprintContent, fingerprintShape } from "@/ai/content/fingerprint";
import { mapNode, withAnalysisTag, type ParseMarkdown } from "@/ai/renderer/mapNode";
import type { VisualNode } from "@/ai/visual-plan/types";
import type { ExistingObject } from "./classify";

const NO_BOX = { x: 0, y: 0, width: 1, height: 1 };

export function nodeFingerprint(node: VisualNode, parseMarkdown: ParseMarkdown): string {
  // As the node is written (an analysis node's title tagged), so it equals the fingerprint the writer stamped.
  const c = mapNode(withAnalysisTag(node), NO_BOX, parseMarkdown);
  if (c.kind === "create_frame") throw new Error(`node "${node.id}" is a group; reconciliation only sees ungrouped plans (see visual-plan/groups.ts)`);
  if (c.kind === "create_shape") return fingerprintShape(c.shape, c.label ?? "");
  if (c.kind === "create_page") return fingerprintContent(c.content, c.title);
  return fingerprintContent(c.content);
}

/** Fingerprints by parser, then by node content (LRU): a node's text doesn't change its fingerprint between calls. */
const fingerprints = new WeakMap<ParseMarkdown, Map<string, string>>();
const FINGERPRINT_CACHE = 5_000;

/**
 * `nodeFingerprint`, remembered across calls for the parser `cacheBy` (the parser's result for a text never
 * changes). `parseMarkdown` parses on a miss; it may be a wrapper of `cacheBy`. Content is never cached, only the
 * fingerprint, so no two objects ever share parsed blocks (block ids are unique per object).
 */
export function cachedNodeFingerprint(node: VisualNode, parseMarkdown: ParseMarkdown, cacheBy: ParseMarkdown): string {
  let cache = fingerprints.get(cacheBy);
  if (!cache) fingerprints.set(cacheBy, (cache = new Map()));
  // The title and origin count too: a page's fingerprint includes its title, and an analysis node's title is tagged.
  const key = `${node.type}\u0000${node.origin ?? ""}\u0000${JSON.stringify(node.title ?? null)}\u0000${JSON.stringify(node.content)}`;
  const hit = cache.get(key);
  if (hit !== undefined) {
    cache.delete(key);
    cache.set(key, hit);
    return hit;
  }
  const fp = nodeFingerprint(node, parseMarkdown);
  cache.set(key, fp);
  if (cache.size > FINGERPRINT_CACHE) cache.delete(cache.keys().next().value!);
  return fp;
}

export function nodeKind(node: VisualNode): { shape: ExistingObject["shape"]; blockType?: string } {
  switch (node.type) {
    case "shape":
      return { shape: "shape" };
    case "page":
      return { shape: "page" };
    case "heading":
    case "text":
      return { shape: "block", blockType: "text" };
    default:
      return { shape: "block", blockType: node.type };
  }
}

/** The change that gives `target` this node's content in place (its id, bindings and position stay). */
export function updateChange(node: VisualNode, target: string, parseMarkdown: ParseMarkdown): Extract<ProposedChange, { kind: "update_block" | "update_shape" }> {
  // An analysis node keeps its tag when updated, as when it was first written.
  const c = mapNode(withAnalysisTag(node), NO_BOX, parseMarkdown);
  const stableNodeKey = node.stableKey!;
  if (c.kind === "create_frame") throw new Error(`node "${node.id}" is a group; reconciliation only sees ungrouped plans (see visual-plan/groups.ts)`);
  if (c.kind === "create_shape") return { kind: "update_shape", target, label: c.label ?? "", stableNodeKey };
  if (c.kind === "create_page") return { kind: "update_block", target, content: c.content, title: c.title, stableNodeKey };
  return { kind: "update_block", target, content: c.content, stableNodeKey };
}
