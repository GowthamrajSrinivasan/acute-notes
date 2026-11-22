/**
 * Stage 5d (intelligent-update-engine-plan §13.5, §18): the descent's anchor, turned into the exact `patch_block` that
 * puts the new information *inside* the card — deterministic, no model:
 *
 * | Anchor        | Patch                                                                                      |
 * |---------------|--------------------------------------------------------------------------------------------|
 * | `after_item`  | a new list/todo item of the same type, right after the matched item (`inserts: block`)     |
 * | `append`      | a new list/todo item after the list's last item                                            |
 * | `table_row`   | a new table row after the last one; cells from "a \| b \| c" or "Header: value" pairs     |
 * | `cell`        | the changed value in that row and column: only the quantity's words (`edits: cell`)       |
 *
 * `replace_item` stays the router's `update` (a claim-level sentence edit, `placement.ts`), and `duplicate` its `none`.
 * Anything that can't be placed exactly gives null, and the dialog offers "a new card beside it" instead. Locked cards
 * (or cards in a locked section) are never anchored into. Every patch goes through the same review and accept-time check
 * (`resolvePatch` against the card's live fingerprint), as one undo step.
 */
import type { BlockInsert, ClaimEdit, InsertBlockType } from "@/ai/changes/claimPatch";
import { resolvePatch } from "@/ai/changes/claimPatch";
import { quantitiesOf, sameQuantity } from "@/ai/fidelity/quantities";
import { fingerprintOf, type ObjectContent } from "@/ai/reconcile/objects";
import type { CardOption } from "./descent";
import type { CardItems } from "./itemIndex";
import { tableCells } from "./semanticIndex";

export type AnchorAction = "after_item" | "append" | "table_row" | "cell";

/** A planned anchor: what the dialog says, and the patch it proposes (checked again when proposed and at accept). */
export interface AnchorPlan {
  action: AnchorAction;
  /** For the dialog: "Add it to the list, after “…”". */
  label: string;
  /** The card's fingerprint the plan was made on. */
  fingerprint: string;
  edits: ClaimEdit[];
  inserts: BlockInsert[];
}

const clip = (s: string, n = 40) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

/** The note as one item's text: one line, without a list marker of its own. */
export function itemText(text: string): string {
  return text
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^(?:[-*+•]|\d+[.)]|\[[ xX]\])\s+/, "");
}

/** See module doc. `option` is the descent's choice for this card; `items` and `live` describe the card now. */
export function planAnchor(option: Pick<CardOption, "action" | "item" | "column">, items: CardItems, live: ObjectContent | null, text: string): AnchorPlan | null {
  if (!live || live.kind === "shape") return null;
  const blocks = live.content;
  const fingerprint = fingerprintOf(live);
  const line = itemText(text);
  if (!line) return null;
  const check = (plan: AnchorPlan): AnchorPlan | null => (resolvePatch({ expectedFingerprint: fingerprint, edits: plan.edits, inserts: plan.inserts }, { content: blocks, fingerprint }).ok ? plan : null);

  if ((option.action === "after_item" || option.action === "append") && (items.kind === "list" || items.kind === "todo")) {
    const listBlocks = items.items.map((it) => it.block as number);
    const at = option.action === "after_item" && option.item !== null ? items.items[option.item]?.block : listBlocks[listBlocks.length - 1];
    if (typeof at !== "number") return null;
    const anchor = blocks[at];
    if (!anchor) return null;
    const blockType = (["bulletListItem", "numberedListItem", "checkListItem"].includes(anchor.type) ? anchor.type : "bulletListItem") as InsertBlockType;
    const neighbour = items.items.find((it) => it.block === at)?.text ?? "";
    return check({
      action: option.action,
      label: option.action === "after_item" ? `Add it to the list, after “${clip(neighbour)}”` : "Add it at the end of the list",
      fingerprint,
      edits: [],
      inserts: [{ kind: "block", after: at, ...(anchor.id ? { afterBlockId: anchor.id } : {}), blockType, text: line }],
    });
  }

  if (items.kind !== "table") return null;
  const tableAt = items.items[0]?.block ?? blocks.findIndex((b) => b.type === "table");
  if (typeof tableAt !== "number" || tableAt < 0 || !blocks[tableAt]) return null;
  const table = blocks[tableAt]!;
  const header = items.header ?? [];

  if (option.action === "table_row") {
    const rows = tableCells(table);
    const cells = rowCells(line, header);
    if (!cells) return null;
    return check({
      action: "table_row",
      label: `Add a row to the table: “${clip(cells.filter(Boolean).join(" · "))}”`,
      fingerprint,
      edits: [],
      inserts: [{ kind: "row", blockIndex: tableAt, ...(table.id ? { blockId: table.id } : {}), after: rows.length - 1, cells }],
    });
  }

  // A changed value: `cell` (the descent found the column), or `replace_item` in a table (a quantity in that row changed).
  if ((option.action === "cell" || option.action === "replace_item") && option.item !== null) {
    const row = items.items[option.item];
    if (!row || typeof row.part !== "number") return null;
    const rowCellsNow = tableCells(table)[row.part] ?? [];
    const named = option.column ? header.indexOf(option.column) : -1;
    const order = named >= 0 ? [named] : rowCellsNow.map((_c, i) => i);
    for (const col of order) {
      const was = rowCellsNow[col] ?? "";
      const change = changedQuantity(was, line);
      if (!change) continue;
      return check({
        action: "cell",
        label: `Change ${header[col] ? `“${clip(header[col]!, 24)}”` : `column ${col + 1}`} in row ${row.part + 1}: “${clip(change.was, 24)}” → “${clip(change.now, 24)}”`,
        fingerprint,
        edits: [{ blockIndex: tableAt, ...(table.id ? { blockId: table.id } : {}), cell: { row: row.part, col }, match: { range: { start: change.start, end: change.end }, text: change.was }, replacement: change.now, intent: "SUPERSEDES" }],
        inserts: [],
      });
    }
    return null;
  }
  return null;
}

/** The quantity in `cell` that `text` gives another value of the same kind for: its span and both wordings. */
function changedQuantity(cell: string, text: string): { start: number; end: number; was: string; now: string } | null {
  const now = quantitiesOf(text);
  for (const q of quantitiesOf(cell)) {
    const other = now.find((n) => n.dimension === q.dimension && !sameQuantity(n, q));
    if (other && !now.some((n) => sameQuantity(n, q))) return { start: q.start, end: q.end, was: q.text, now: other.text };
  }
  return null;
}

/** A new row's cells: "a | b | c", else "Header: value" pairs (the rest of the text in the first column), else the text in the first column. */
export function rowCells(text: string, header: readonly string[]): string[] | null {
  const width = Math.max(1, header.length);
  if (text.includes("|")) {
    const cells = text.split("|").map((c) => c.trim());
    while (cells.length && !cells[0]) cells.shift();
    while (cells.length && !cells[cells.length - 1]) cells.pop();
    return cells.length && cells.length <= width ? [...cells, ...Array<string>(width - cells.length).fill("")] : null;
  }
  const cells = Array<string>(width).fill("");
  let firstPair = text.length;
  let found = 0;
  header.forEach((h, i) => {
    const name = h.trim();
    if (!name || i === 0) return;
    const m = new RegExp(`\\b${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*[:=]\\s*([^;,]+)`, "i").exec(text);
    if (!m) return;
    cells[i] = m[1]!.trim().replace(/[.]$/, "");
    firstPair = Math.min(firstPair, m.index);
    found++;
  });
  cells[0] = (found ? text.slice(0, firstPair) : text).trim().replace(/[,;:\-–]+$/, "").trim();
  if (!cells[0] && !found) return null;
  return cells;
}
