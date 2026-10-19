import { BlockNoteEditor } from "@blocknote/core";
import { blocksToYXmlFragment } from "@blocknote/core/yjs";
import { describe, expect, it } from "vitest";
import * as Y from "yjs";
import type { ContentBlock, RichContent } from "@/domain/types";
import { BLOCKNOTE_DEFAULT_ID, copyWithNewBlockIds, replaceDefaultBlockId, RICH_FRAGMENT } from "./blockIds";

/** Block ids of a Y.Doc's BlockNote fragment, in document order. */
function fragmentIds(doc: Y.Doc): string[] {
  const ids: string[] = [];
  for (const n of doc.getXmlFragment(RICH_FRAGMENT).createTreeWalker((x) => x instanceof Y.XmlElement && x.nodeName === "blockContainer")) {
    ids.push((n as Y.XmlElement).getAttribute("id") as string);
  }
  return ids;
}

function snapshotIds(content: RichContent): string[] {
  const out: string[] = [];
  const visit = (b: ContentBlock) => {
    if (b.id) out.push(b.id);
    b.children?.forEach(visit);
  };
  content.forEach(visit);
  return out;
}

const CONTENT: RichContent = [
  { id: "a", type: "heading", content: "Title", children: [{ id: "a1", type: "paragraph", content: "nested" }] },
  { id: "b", type: "checkListItem", content: "todo" },
  { id: "c", type: "table", content: { type: "tableContent", rows: [{ cells: ["x", "y"] }] } },
];

function sourceDoc(content: RichContent = CONTENT): { doc: Y.Doc; updates: Uint8Array[] } {
  const editor = BlockNoteEditor.create();
  const doc = new Y.Doc();
  blocksToYXmlFragment(editor, content as never, doc.getXmlFragment(RICH_FRAGMENT));
  editor._tiptapEditor.destroy();
  return { doc, updates: [Y.encodeStateAsUpdate(doc)] };
}

describe("copying a document's blocks", () => {
  it("gives every block a new id in both the Yjs content and the snapshot", () => {
    const { doc, updates } = sourceDoc();
    const before = fragmentIds(doc);
    expect(before).toEqual(["a", "a1", "b", "c"]);

    const copy = copyWithNewBlockIds(updates, CONTENT);
    const copied = new Y.Doc();
    Y.applyUpdate(copied, copy.update!);
    const after = fragmentIds(copied);

    expect(after).toHaveLength(4);
    expect(new Set(after).size).toBe(4);
    for (const id of after) expect(before).not.toContain(id);
    // Snapshot and Yjs content agree on the new ids.
    expect(snapshotIds(copy.snapshot)).toEqual(after);
    // Content is unchanged apart from ids; the source is untouched.
    expect(copied.getXmlFragment(RICH_FRAGMENT).toString().replace(/id="[^"]+"/g, "")).toBe(
      doc.getXmlFragment(RICH_FRAGMENT).toString().replace(/id="[^"]+"/g, ""),
    );
    expect(fragmentIds(doc)).toEqual(before);
  });

  it("makes every copy unique, including copies of copies", () => {
    const { updates } = sourceDoc();
    const first = copyWithNewBlockIds(updates, CONTENT);
    const second = copyWithNewBlockIds(updates, CONTENT);
    const third = copyWithNewBlockIds([first.update!], first.snapshot);
    const all = [first, second, third].flatMap((c) => snapshotIds(c.snapshot));
    expect(new Set(all).size).toBe(all.length);
  });

  it("separates blocks that shared an id inside one document", () => {
    const damaged: RichContent = [
      { id: "same", type: "paragraph", content: "one" },
      { id: "same", type: "paragraph", content: "two" },
    ];
    const { updates } = sourceDoc(damaged);
    const copied = new Y.Doc();
    Y.applyUpdate(copied, copyWithNewBlockIds(updates, damaged).update!);
    const ids = fragmentIds(copied);
    expect(ids).toHaveLength(2);
    expect(new Set(ids).size).toBe(2);
  });

  it("copies a never-edited document (snapshot only)", () => {
    const copy = copyWithNewBlockIds([], CONTENT);
    expect(copy.update).toBeNull();
    const ids = snapshotIds(copy.snapshot);
    expect(ids).toHaveLength(4);
    expect(ids).not.toContain("a");
  });
});

describe("BlockNote's shared default block id", () => {
  it("is replaced by a fresh id in the content and the snapshot", () => {
    const content: RichContent = [{ id: BLOCKNOTE_DEFAULT_ID, type: "paragraph", content: "hi" }, { id: "b", type: "paragraph" }];
    const { doc } = sourceDoc(content);
    let snapshot: RichContent | null = null;
    doc.transact(() => (snapshot = replaceDefaultBlockId(doc.getXmlFragment(RICH_FRAGMENT), content)));
    const ids = fragmentIds(doc);
    expect(ids[0]).not.toBe(BLOCKNOTE_DEFAULT_ID);
    expect(ids[1]).toBe("b");
    expect(snapshotIds(snapshot!)).toEqual(ids);
  });

  it("leaves documents without it untouched", () => {
    const { doc, updates } = sourceDoc();
    expect(replaceDefaultBlockId(doc.getXmlFragment(RICH_FRAGMENT), CONTENT)).toBeNull();
    expect(Y.encodeStateAsUpdate(doc)).toEqual(updates[0]);
  });
});
