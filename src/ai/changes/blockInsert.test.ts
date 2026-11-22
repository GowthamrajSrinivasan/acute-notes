/**
 * Stage 5d anchors (intelligent-update-engine-plan §13.5, §18): `patch_block` inserts — a list item after another or at
 * the end, a table row — all or nothing, every existing block untouched, checked against the live fingerprint.
 */
import { describe, expect, it } from "vitest";
import { fingerprintContent } from "@/ai/content/fingerprint";
import type { RichContent, TableContent } from "@/domain/types";
import { parseChangeSet, resolveChangeSet, type ProposedChange } from "./changeSet";
import { applyBlockInserts, describeBlockInsert, resolvePatch } from "./claimPatch";

const list: RichContent = [
  { id: "h", type: "paragraph", content: "Limits:" },
  { id: "a", type: "bulletListItem", content: "Retries happen five times." },
  { id: "b", type: "bulletListItem", content: [{ type: "text", text: "Timeouts last ", styles: {} }, { type: "text", text: "ten seconds", styles: { bold: true } }] },
];
const table = (cells: "object" | "string"): RichContent => {
  const c = (t: string) => (cells === "object" ? { type: "tableCell" as const, content: [{ type: "text" as const, text: t, styles: {} }] } : t);
  return [{ id: "t", type: "table", content: { type: "tableContent", headerRows: 1, rows: [{ cells: [c("Service"), c("Timeout")] }, { cells: [c("API"), c("30 s")] }] } }];
};

describe("applyBlockInserts", () => {
  it("adds a list item right after the matched one, of the given type; every other block is the same object", () => {
    const out = applyBlockInserts(list, [{ kind: "block", after: 1, afterBlockId: "a", blockType: "bulletListItem", text: "Backoff doubles each time." }]);
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.content.map((b) => b.id ?? "new")).toEqual(["h", "a", "new", "b"]);
    expect(out.content[2]).toEqual({ type: "bulletListItem", content: [{ type: "text", text: "Backoff doubles each time.", styles: {} }] });
    expect(out.content[3]).toBe(list[2]);
  });

  it("keeps the order of several inserts at one place, and a todo item starts unchecked", () => {
    const out = applyBlockInserts(list, [
      { kind: "block", after: 2, blockType: "checkListItem", text: "one" },
      { kind: "block", after: 2, blockType: "checkListItem", text: "two" },
    ]);
    expect(out.ok && out.content.slice(3).map((b) => [b.type, b.props?.checked, (b.content as { text: string }[])[0]!.text])).toEqual([
      ["checkListItem", false, "one"],
      ["checkListItem", false, "two"],
    ]);
  });

  it("rejects a moved anchor, a position past the end and empty text — whole", () => {
    expect(applyBlockInserts(list, [{ kind: "block", after: 1, afterBlockId: "zzz", blockType: "bulletListItem", text: "x" }])).toMatchObject({ ok: false, reason: "stale" });
    expect(applyBlockInserts(list, [{ kind: "block", after: 3, blockType: "bulletListItem", text: "x" }])).toMatchObject({ ok: false, reason: "stale" });
    expect(applyBlockInserts(list, [{ kind: "block", after: 0, blockType: "bulletListItem", text: "  " }])).toMatchObject({ ok: false, reason: "unsupported" });
  });

  it("adds a table row in the table's own cell form, padding short rows; refuses rows wider than the table", () => {
    for (const form of ["object", "string"] as const) {
      const out = applyBlockInserts(table(form), [{ kind: "row", blockIndex: 0, blockId: "t", after: 1, cells: ["Worker"] }]);
      expect(out.ok).toBe(true);
      if (!out.ok) continue;
      const rows = (out.content[0]!.content as TableContent).rows;
      expect(rows).toHaveLength(3);
      expect(rows[2]!.cells).toEqual(form === "object" ? [{ type: "tableCell", content: [{ type: "text", text: "Worker", styles: {} }] }, { type: "tableCell", content: [] }] : ["Worker", ""]);
    }
    expect(applyBlockInserts(table("string"), [{ kind: "row", blockIndex: 0, after: 1, cells: ["a", "b", "c"] }])).toMatchObject({ ok: false, reason: "unsupported" });
    expect(applyBlockInserts(list, [{ kind: "row", blockIndex: 1, after: 0, cells: ["a"] }])).toMatchObject({ ok: false, reason: "unsupported" });
  });

  it("is described for the review", () => {
    expect(describeBlockInsert({ kind: "block", after: 0, blockType: "bulletListItem", text: "Backoff doubles." })).toBe("adds “Backoff doubles.”");
    expect(describeBlockInsert({ kind: "row", blockIndex: 0, after: 1, cells: ["Worker", "", "60 s"] })).toBe("adds a row “Worker · 60 s”");
  });
});

describe("resolvePatch with inserts", () => {
  const live = { content: list, fingerprint: fingerprintContent(list) };

  it("applies edits, then inserts; refuses a patch planned on other content", () => {
    const patch = {
      expectedFingerprint: live.fingerprint,
      edits: [{ blockIndex: 1, match: { exactText: "five" }, replacement: "three" }],
      inserts: [{ kind: "block" as const, after: 2, blockType: "bulletListItem" as const, text: "Backoff doubles." }],
    };
    const out = resolvePatch(patch, live);
    expect(out.ok && out.content.map((b) => (typeof b.content === "string" ? b.content : (b.content as { text: string }[]).map((r) => r.text).join("")))).toEqual(["Limits:", "Retries happen three times.", "Timeouts last ten seconds", "Backoff doubles."]);
    expect(resolvePatch({ ...patch, expectedFingerprint: "other" }, live)).toMatchObject({ ok: false, reason: "stale" });
  });

  it("an empty patch is still refused", () => {
    expect(resolvePatch({ expectedFingerprint: live.fingerprint, edits: [], inserts: [] }, live)).toMatchObject({ ok: false, reason: "not_found" });
  });

  it("a patch_block with only inserts parses, and becomes the update_block that writes the patched content at accept", () => {
    const change: ProposedChange = { kind: "patch_block", target: "card", expectedFingerprint: live.fingerprint, edits: [], inserts: [{ kind: "block", after: 2, blockType: "bulletListItem", text: "Backoff doubles." }] };
    const set = parseChangeSet({ operationId: "op", title: "Place", metadata: { createdBy: "ai" }, changes: [change] });
    const resolved = resolveChangeSet(set, () => true, () => live);
    expect(resolved.dropped).toEqual([]);
    expect(resolved.changes[0]).toMatchObject({ kind: "update_block", target: "card" });
    expect((resolved.changes[0] as Extract<ProposedChange, { kind: "update_block" }>).content).toHaveLength(4);
    expect(() => parseChangeSet({ operationId: "op", title: "Place", metadata: { createdBy: "ai" }, changes: [{ ...change, inserts: [{ kind: "block", after: 0, blockType: "codeBlock", text: "x" }] }] })).toThrow();
  });
});
