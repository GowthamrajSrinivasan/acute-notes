/**
 * Conflict decisions for the review bar (F39). A conflict is an update to an
 * object the user has edited since AI last wrote it; it is never applied
 * without a decision: "Apply update" adds its `apply` change to the accepted
 * set, "Keep mine" its `keep` (rebaseline) change, and an undecided conflict
 * adds nothing — the object is left exactly as it is.
 */
import type { ChangeSet, ConflictItem, ProposedChange } from "@/ai/changes/changeSet";
import { canonicalContent } from "@/ai/content/fingerprint";
import type { SceneElement } from "@/domain/canvas/adapter";
import type { DocumentRecord } from "@/domain/types";
import { labelsByContainer, objectContent } from "./objects";

export type ConflictDecision = "apply" | "keep";

/** The set Accept writes: its clean changes plus each decided conflict's change; conflicts themselves are gone. */
export function withDecisions(set: ChangeSet, decisions: ReadonlyMap<string, ConflictDecision>): ChangeSet {
  const decided = (set.conflicts ?? []).flatMap((c): ProposedChange[] => {
    const d = decisions.get(c.target);
    // A revert conflict has no `keep`: keeping the object as it is adds nothing.
    return d === "apply" ? [c.apply, ...(c.alsoApply ?? [])] : d === "keep" && c.keep ? [c.keep] : [];
  });
  const { conflicts: _conflicts, ...rest } = set;
  return { ...rest, changes: [...set.changes, ...decided] };
}

/** The proposed content as the text a card shows and diffs (canonical Markdown; a page's title first). */
export function proposedText(conflict: ConflictItem): string {
  const c = conflict.apply;
  if (c.kind === "update_shape") return c.label;
  // A revert (D30): the before-state is restored as it was, or the object the agent added is removed.
  if (c.kind === "restore") {
    const label = conflict.alsoApply?.find((a) => a.kind === "restore");
    return snapshotText(c.element) ?? (label?.kind === "restore" ? snapshotText(label.element) : null) ?? "(as it was before the agent's change)";
  }
  if (c.kind === "remove") return "(removed: the agent added it)";
  const body = canonicalContent(c.content);
  return c.title ? `# ${c.title}\n\n${body}`.trim() : body;
}

/** The object's current content in the same form, or null when it is gone or not loaded. */
export function currentText(elements: readonly SceneElement[], getDocument: (id: string) => DocumentRecord | null | undefined, target: string): string | null {
  const el = elements.find((e) => e.id === target && !e.isDeleted);
  if (!el) return null;
  const content = objectContent(el, labelsByContainer(elements), getDocument);
  if (!content) return null;
  if (content.kind === "shape") return content.label;
  const body = canonicalContent(content.content);
  return content.kind === "page" ? `# ${content.title}\n\n${body}`.trim() : body;
}

/** A short name for a card: the proposed title, heading or label. */
export function conflictName(conflict: ConflictItem): string {
  const c = conflict.apply;
  if (conflict.name) return conflict.name;
  if (c.kind === "update_shape") return c.label || "Shape";
  if (c.kind === "restore" || c.kind === "remove") return "Object";
  if (c.title) return c.title;
  const first = canonicalContent(c.content).split("\n").find((l) => l.trim()) ?? "";
  return first.replace(/^#+\s*/, "").replace(/^[-*]\s+(\[[ x]\]\s+)?/, "").slice(0, 60) || "Block";
}

/** A restore snapshot's own text (a text element's, a frame's name), when it has any. */
function snapshotText(el: Record<string, unknown>): string | null {
  const text = typeof el.originalText === "string" ? el.originalText : typeof el.text === "string" ? el.text : typeof el.name === "string" ? el.name : null;
  return text?.trim() || null;
}
