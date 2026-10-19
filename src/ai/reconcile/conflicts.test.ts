import { describe, expect, it } from "vitest";
import type { ChangeSet, ConflictItem } from "@/ai/changes/changeSet";
import type { SceneElement } from "@/domain/canvas/adapter";
import type { DocumentRecord } from "@/domain/types";
import { conflictName, currentText, proposedText, withDecisions } from "./conflicts";

const conflict = (target: string, text: string): ConflictItem => ({
  target,
  stableNodeKey: `k_${target}`,
  apply: { kind: "update_block", target, stableNodeKey: `k_${target}`, content: [{ type: "heading", props: { level: 2 }, content: text }] },
  keep: { kind: "rebaseline", target, stableNodeKey: `k_${target}` },
});

const set = (conflicts: ConflictItem[]): ChangeSet => ({
  operationId: "op_1",
  title: "Update from new content",
  metadata: { createdBy: "ai", task: "generate_visual_plan", provider: "local" },
  changes: [{ kind: "remove", target: "el_gone" }],
  conflicts,
});

describe("withDecisions", () => {
  const c1 = conflict("el_1", "One");
  const c2 = conflict("el_2", "Two");
  const c3 = conflict("el_3", "Three");

  it("adds each decided conflict's change — apply or keep — after the clean changes", () => {
    const out = withDecisions(set([c1, c2, c3]), new Map([["el_1", "apply"], ["el_2", "keep"]] as const));
    expect(out.changes).toEqual([{ kind: "remove", target: "el_gone" }, c1.apply, c2.keep]);
  });

  it("an undecided conflict adds nothing, and the result has no conflicts left", () => {
    const out = withDecisions(set([c3]), new Map());
    expect(out.changes).toEqual([{ kind: "remove", target: "el_gone" }]);
    expect(out.conflicts).toBeUndefined();
  });

  it("does not mutate the proposed set", () => {
    const s = set([c1]);
    withDecisions(s, new Map([["el_1", "apply"]] as const));
    expect(s.changes).toHaveLength(1);
    expect(s.conflicts).toHaveLength(1);
  });
});

describe("conflict text", () => {
  const doc = (snapshot: DocumentRecord["snapshot"]) => ({ id: "doc_1", snapshot }) as unknown as DocumentRecord;
  const block = { id: "el_1", type: "embeddable", isDeleted: false, customData: { acute: { kind: "rich-block", documentId: "doc_1", blockType: "text" } } } as unknown as SceneElement;

  it("proposed and current content compare as canonical Markdown", () => {
    const current = currentText([block], () => doc([{ type: "heading", props: { level: 2 }, content: "One (mine)" }]), "el_1");
    expect(current).toBe("## One (mine)");
    expect(proposedText(conflict("el_1", "One"))).toBe("## One");
  });

  it("a deleted or unknown object has no current text", () => {
    expect(currentText([{ ...block, isDeleted: true } as SceneElement], () => doc([]), "el_1")).toBeNull();
    expect(currentText([block], () => doc([]), "el_x")).toBeNull();
  });

  it("names a card by its heading or label", () => {
    expect(conflictName(conflict("el_1", "Risks"))).toBe("Risks");
    expect(conflictName({ ...conflict("el_1", "x"), apply: { kind: "update_shape", target: "el_1", stableNodeKey: "k", label: "Deploy" } })).toBe("Deploy");
  });
});
