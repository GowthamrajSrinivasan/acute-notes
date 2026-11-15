/**
 * Stage 1d (intelligent-update-engine-plan): a one-cell change doesn't rewrite the table, a caption change doesn't
 * rewrite the image — `patch_block` edits with a `cell` or `caption` target, under the same conditional contract.
 */
import { describe, expect, it } from "vitest";
import { parseChangeSet, resolveChangeSet, type ProposedChange } from "@/ai/changes/changeSet";
import { applyClaimEdits, describeClaimEdit, type ClaimEdit } from "@/ai/changes/claimPatch";
import { fingerprintContent } from "@/ai/content/fingerprint";
import type { ContentBlock, RichContent } from "@/domain/types";
import { claimLevelUpdate, editedCardUpdate, planClaimPatch } from "./claimPlanner";

const t = (text: string, styles: Record<string, unknown> = {}) => ({ type: "text" as const, text, styles });
/** A table as BlockNote stores it: one header row, cells in the object form, column widths. */
const table = (rows: (string | ReturnType<typeof t>[])[][], id = "tbl"): ContentBlock => ({
  id,
  type: "table",
  props: { textColor: "default" },
  content: {
    type: "tableContent",
    headerRows: 1,
    columnWidths: [120, 80],
    rows: rows.map((cells) => ({ cells: cells.map((c) => ({ type: "tableCell" as const, content: typeof c === "string" ? [t(c)] : c, props: { backgroundColor: "default" } })) })),
  },
});
const LIMITS = [
  ["Setting", "Value"],
  ["Retries", "5"],
  ["Timeout", "10 seconds"],
];
const image = (caption: string): ContentBlock => ({ id: "img", type: "image", props: { url: "acute-asset://a.png", caption, previewWidth: 400 } });
const edit = (e: Partial<ClaimEdit> & Pick<ClaimEdit, "match" | "replacement">): ClaimEdit => ({ blockIndex: 0, ...e });
const cellText = (content: RichContent, row: number, col: number) => JSON.stringify((content[0]!.content as { rows: { cells: unknown[] }[] }).rows[row]!.cells[col]);

describe("applyClaimEdits — a cell target", () => {
  it("edits one cell; every other cell, the header, widths, cell props and the block's id stay as they were", () => {
    const before = [table(LIMITS)];
    const r = applyClaimEdits(before, [edit({ cell: { row: 1, col: 1 }, match: { exactText: "5" }, replacement: "3" })]);
    expect(r.ok).toBe(true);
    const after = (r as { content: RichContent }).content;
    expect(cellText(after, 1, 1)).toBe(JSON.stringify({ type: "tableCell", content: [t("3")], props: { backgroundColor: "default" } }));
    for (const [row, col] of [[0, 0], [0, 1], [1, 0], [2, 0], [2, 1]] as const) expect(cellText(after, row, col)).toBe(cellText(before, row, col));
    expect({ ...after[0], content: undefined }).toEqual({ ...before[0], content: undefined });
    expect((after[0]!.content as { columnWidths: unknown }).columnWidths).toEqual([120, 80]);
  });

  it("keeps a styled cell's marks outside the edit", () => {
    const r = applyClaimEdits([table([["Setting", "Value"], ["Timeout", [t("10", { bold: true }), t(" seconds")]]])], [edit({ cell: { row: 1, col: 1 }, match: { exactText: "10" }, replacement: "30" })]);
    expect(r.ok && cellText(r.content, 1, 1)).toContain(JSON.stringify([t("30", { bold: true }), t(" seconds")]));
  });

  it("two cells in one patch, atomically; a cell that's gone rejects the whole patch", () => {
    const both = applyClaimEdits([table(LIMITS)], [edit({ cell: { row: 1, col: 1 }, match: { exactText: "5" }, replacement: "3" }), edit({ cell: { row: 2, col: 1 }, match: { exactText: "10" }, replacement: "30" })]);
    expect(both.ok).toBe(true);
    const gone = applyClaimEdits([table(LIMITS)], [edit({ cell: { row: 1, col: 1 }, match: { exactText: "5" }, replacement: "3" }), edit({ cell: { row: 7, col: 1 }, match: { exactText: "x" }, replacement: "y" })]);
    expect(gone).toMatchObject({ ok: false, reason: "stale" });
  });

  it("a cell target on a block that isn't a table is unsupported; a string cell stays a string", () => {
    expect(applyClaimEdits([{ type: "paragraph", content: "5" }], [edit({ cell: { row: 0, col: 0 }, match: { exactText: "5" }, replacement: "3" })])).toMatchObject({ ok: false, reason: "unsupported" });
    const plain: ContentBlock = { type: "table", content: { type: "tableContent", rows: [{ cells: ["Retries", "5"] }] } };
    const r = applyClaimEdits([plain], [edit({ cell: { row: 0, col: 1 }, match: { exactText: "5" }, replacement: "3" })]);
    expect(r.ok && (r.content[0]!.content as { rows: { cells: unknown[] }[] }).rows[0]!.cells).toEqual(["Retries", "3"]);
  });
});

describe("applyClaimEdits — a caption target", () => {
  it("edits the caption only; the image's url and size stay", () => {
    const r = applyClaimEdits([image("The gateway in five regions.")], [edit({ caption: true, match: { exactText: "five" }, replacement: "three" })]);
    expect(r.ok && r.content[0]).toEqual(image("The gateway in three regions."));
  });

  it("a block without a caption is unsupported", () => {
    expect(applyClaimEdits([{ type: "paragraph", content: "x" }], [edit({ caption: true, match: { exactText: "x" }, replacement: "y" })])).toMatchObject({ ok: false, reason: "unsupported" });
  });
});

describe("planClaimPatch — tables and captions", () => {
  const plan = (a: ContentBlock, b: ContentBlock) => planClaimPatch([a], [b]);

  it("one changed cell is one cell edit, classified with its row: a superseded value", () => {
    const p = plan(table(LIMITS), table([LIMITS[0]!, ["Retries", "3"], LIMITS[2]!]));
    expect(p).toMatchObject({ kind: "patch", edits: [{ cell: { row: 1, col: 1 }, match: { text: "5" }, replacement: "3", intent: "SUPERSEDES" }] });
    expect(describeClaimEdit((p as { edits: ClaimEdit[] }).edits[0]!)).toBe("row 2, column 2: replaces “5” → “3”");
  });

  it("a cell extended keeps the rest of the cell", () => {
    const p = plan(table(LIMITS), table([LIMITS[0]!, LIMITS[1]!, ["Timeout", "10 seconds per call"]]));
    expect(p).toMatchObject({ kind: "patch", edits: [{ cell: { row: 2, col: 1 }, replacement: "seconds per call", intent: "EXTENDS" }] });
  });

  it("a cell whose row now says the opposite escalates", () => {
    const p = plan(table([["Rule", "Applies"], ["The cache is shared across regions", "yes"]]), table([["Rule", "Applies"], ["The cache is not shared across regions", "yes"]]));
    expect(p).toMatchObject({ kind: "escalate", intent: "CONTRADICTS" });
  });

  it.each([
    ["a row added", table(LIMITS), table([...LIMITS, ["Backoff", "double"]])],
    ["a column added", table(LIMITS), table(LIMITS.map((r) => [...r, "x"]))],
    ["a cell filled in", table([["Setting", "Value"], ["Retries", ""]]), table([["Setting", "Value"], ["Retries", "5"]])],
    ["only a cell's formatting changed", table(LIMITS), table([LIMITS[0]!, ["Retries", [t("5", { bold: true })]], LIMITS[2]!])],
    ["the image itself changed", image("The gateway."), { ...image("The gateway."), props: { url: "acute-asset://b.png", caption: "The gateway.", previewWidth: 400 } }],
  ] as const)("falls back to the whole-block update: %s", (_why, a, b) => {
    expect(plan(a as ContentBlock, b as ContentBlock).kind).toBe("rewrite");
  });

  it("a changed caption is one caption edit", () => {
    expect(plan(image("The gateway in five regions."), image("The gateway in three regions."))).toMatchObject({ kind: "patch", edits: [{ caption: true, replacement: "three", intent: "SUPERSEDES" }] });
  });
});

describe("Stage 1d through the change set", () => {
  const live = [table(LIMITS)];
  const proposed = [table([LIMITS[0]!, ["Retries", "3"], LIMITS[2]!])];

  it("a clean table update becomes a cell patch, parses, and resolves to the patched table at accept", () => {
    const r = claimLevelUpdate({ kind: "update_block", target: "el_t", content: proposed, stableNodeKey: "k" }, { objectId: "el_t", stableNodeKey: "k", current: fingerprintContent(live), rich: { content: live } });
    const patch = (r as { change: ProposedChange }).change;
    expect(patch).toMatchObject({ kind: "patch_block", edits: [{ cell: { row: 1, col: 1 } }] });
    const set = parseChangeSet({ operationId: "op", title: "Update", metadata: { createdBy: "ai" }, changes: [patch] });
    const resolved = resolveChangeSet(set, () => true, () => ({ content: live, fingerprint: fingerprintContent(live) }));
    const written = resolved.changes[0] as Extract<ProposedChange, { kind: "update_block" }>;
    expect(fingerprintContent(written.content)).toBe(fingerprintContent(proposed));
    expect((written.content[0]!.content as { columnWidths: unknown }).columnWidths).toEqual([120, 80]);
  });

  it("an edited table: the source's cell change is merged into the user's table, their own cells kept", () => {
    const users = [table([LIMITS[0]!, ["Retries", "5"], ["Timeout", "10 seconds (my note: per call)"]])];
    const r = editedCardUpdate({ kind: "update_block", target: "el_t", content: proposed, stableNodeKey: "k" }, { objectId: "el_t", stableNodeKey: "k", current: "c_user", rich: { content: users } }, { content: live });
    const patch = (r as { change: Extract<ProposedChange, { kind: "patch_block" }> }).change;
    expect(patch).toMatchObject({ onEditedCard: true });
    const out = applyClaimEdits(users, patch.edits);
    expect(out.ok && cellText(out.content, 1, 1)).toContain('"3"');
    expect(out.ok && cellText(out.content, 2, 1)).toContain("my note: per call");
  });

  it("the schema refuses an edit aimed at a cell and a caption at once", () => {
    const bad = { kind: "patch_block", target: "x", expectedFingerprint: "c", edits: [{ blockIndex: 0, cell: { row: 0, col: 0 }, caption: true, match: { exactText: "a" }, replacement: "b" }] };
    expect(() => parseChangeSet({ operationId: "op", title: "Update", metadata: { createdBy: "ai" }, changes: [bad] })).toThrow(/cell or a caption/);
  });
});
