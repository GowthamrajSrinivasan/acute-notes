/**
 * Stage 4d–4e (§12.3): the check over cards — only what a commit newly says is checked, against other cards (never its
 * own); one detection per pair of cards; a fix is a claim-level patch proposal, checked like any patch.
 */
import { describe, expect, it } from "vitest";
import { applyClaimEdits, blockPlainText } from "@/ai/changes/claimPatch";
import type { SceneElement } from "@/domain/canvas/adapter";
import type { DocumentRecord, RichContent } from "@/domain/types";
import { cardReader, detect, fixFor, newClaims } from "./check";

const para = (text: string): RichContent => [{ id: "b1", type: "paragraph", content: text }];
function scene(cards: Record<string, string>) {
  const docs = new Map<string, DocumentRecord>();
  const elements = Object.entries(cards).map(([id, text]) => {
    docs.set(`doc_${id}`, { id: `doc_${id}`, workspaceId: "ws", kind: "block", title: "", snapshot: para(text), createdAt: 0, updatedAt: 0 });
    return { id, type: "embeddable", x: 0, y: 0, width: 1, height: 1, isDeleted: false, customData: { acute: { kind: "rich-block", blockType: "text", documentId: `doc_${id}` } } } as unknown as SceneElement;
  });
  return { elements, getDocument: (id: string) => docs.get(id) };
}

describe("Stage 4d–4e — checking a commit's claims against the canvas", () => {
  it("only the sentences a commit added or changed are claims (a new card: all of its sentences)", () => {
    const { elements, getDocument } = scene({ a: "Retries happen three times. Timeouts last ten seconds.", n: "Deploys take 10 minutes." });
    const read = cardReader(elements, getDocument);
    const claims = newClaims(new Map([["a", ["Retries happen five times.", "Timeouts last ten seconds."]]]), [read("a")!, read("n")!]);
    expect(claims).toEqual([
      { elementId: "a", sentence: "Retries happen three times." },
      { elementId: "n", sentence: "Deploys take 10 minutes." },
    ]);
  });

  it("a claim against other cards: the disagreement found, unrelated and compatible cards not, its own card never", () => {
    const { elements, getDocument } = scene({
      a: "Retries happen three times.",
      w: "The worker retries five times.",
      t: "Timeouts happen five times a day.",
      s: "In staging, retries happen five times.",
      u: "Deploys take 10 minutes.",
    });
    const read = cardReader(elements, getDocument);
    const found = detect([{ elementId: "a", sentence: "Retries happen three times." }], read, () => ["a", "w", "t", "s", "u"]);
    expect(found.map((d) => [d.b.elementId, d.strength, d.kind])).toEqual([
      ["w", "conflict", "differs"],
      ["s", "possible", "differs"],
    ]);
    expect(found[0]!.reason).toBe("“three times” here, “five times” there");
  });

  it("a fix makes the chosen card say the other's value, as a claim-level patch that applies to it exactly", () => {
    const { elements, getDocument } = scene({ w: "The worker retries five times. It logs each try." });
    const read = cardReader(elements, getDocument);
    void read;
    const content = { kind: "block" as const, documentId: "doc_w", content: getDocument("doc_w")!.snapshot };
    const patch = fixFor({ elementId: "w", sentence: "The worker retries five times." }, { sentence: "Retries happen three times." }, content)!;
    expect(patch).toMatchObject({ kind: "patch_block", target: "w" });
    const applied = applyClaimEdits(content.content, patch.edits);
    expect(applied.ok && blockPlainText(applied.content[0]!)).toBe("The worker retries three times. It logs each try.");
    // No value to pair (a negation conflict): no fix offered.
    expect(fixFor({ elementId: "w", sentence: "The worker retries five times." }, { sentence: "The worker never retries." }, content)).toBeNull();
  });
});
