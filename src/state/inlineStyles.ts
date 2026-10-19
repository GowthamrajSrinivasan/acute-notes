/**
 * Item-level formatting for documents that are not open in an editor: when a
 * whole text item's font/size/colour/alignment is changed from the panel, the
 * inline overrides of that property are removed so the item setting applies
 * everywhere (see plan A1).
 *
 * Works on the stored Yjs document and on the preview snapshot. If the
 * document is still held by the shared registry (e.g. just after editing), the
 * change is applied to that same Y.Doc so no view goes stale.
 */
import * as Y from "yjs";
import { stripInlineStyle } from "@/domain/content/richContent";
import type { InlineContent, InlineStyles, RichContent } from "@/domain/types";
import { getPersistence } from "@/persistence";
import { DocumentProvider } from "@/sync/DocumentProvider";
import { documentRegistry } from "@/sync/documentRegistry";
import { richDocKey, trackPendingDocWork } from "./documentClone";
import { getDocumentStore } from "./documents";

const FRAGMENT = "blocknote";

/**
 * Removes a mark (y-prosemirror stores marks as text formatting attributes) or,
 * for `textAlignment`, resets block alignment attributes. Returns true if the
 * tree was touched.
 */
export function stripYStyle(node: Y.XmlFragment | Y.XmlElement, key: string): boolean {
  let touched = false;
  for (const child of node.toArray()) {
    if (child instanceof Y.XmlText) {
      if (key === "textAlignment") continue;
      const hasMark = child.toDelta().some((op: { attributes?: Record<string, unknown> }) => op.attributes && key in op.attributes);
      if (hasMark) {
        child.format(0, child.length, { [key]: null });
        touched = true;
      }
    } else if (child instanceof Y.XmlElement) {
      if (key === "textAlignment") {
        const value = child.getAttribute("textAlignment");
        if (value && value !== "left") {
          child.setAttribute("textAlignment", "left");
          touched = true;
        }
      }
      if (stripYStyle(child, key)) touched = true;
    }
  }
  return touched;
}

/** y-prosemirror stores a string-prop style mark as `{ stringValue }`. */
function markValue(attr: unknown): string | undefined {
  if (attr && typeof attr === "object" && "stringValue" in attr) return String((attr as { stringValue: unknown }).stringValue);
  return typeof attr === "string" ? attr : undefined;
}

export const scaleSize = (size: number, factor: number) => Math.max(8, Math.round(size * factor));

/** Multiplies every inline `fontSize` mark by `factor`. Returns true if touched. */
export function scaleYFontSize(node: Y.XmlFragment | Y.XmlElement, factor: number): boolean {
  let touched = false;
  for (const child of node.toArray()) {
    if (child instanceof Y.XmlText) {
      let offset = 0;
      const edits: [number, number, string][] = [];
      for (const op of child.toDelta() as { insert: unknown; attributes?: Record<string, unknown> }[]) {
        const len = typeof op.insert === "string" ? op.insert.length : 1;
        const value = markValue(op.attributes?.fontSize);
        if (value) edits.push([offset, len, String(scaleSize(Number(value), factor))]);
        offset += len;
      }
      for (const [at, len, size] of edits) child.format(at, len, { fontSize: { stringValue: size } });
      if (edits.length) touched = true;
    } else if (child instanceof Y.XmlElement && scaleYFontSize(child, factor)) {
      touched = true;
    }
  }
  return touched;
}

/** Runs a Yjs change on a stored document, via the shared provider if it is open. */
function changeStoredDoc(documentId: string, change: (fragment: Y.XmlFragment) => void): void {
  const held = documentRegistry.peek(richDocKey(documentId));
  const work = held
    ? held.then((p) => p.applyLocalChange((doc) => change(doc.getXmlFragment(FRAGMENT))))
    : (async () => {
        const provider = new DocumentProvider(richDocKey(documentId), getPersistence().yupdates, { flushDelay: 0 });
        await provider.load();
        provider.applyLocalChange((doc) => change(doc.getXmlFragment(FRAGMENT)));
        await provider.dispose();
      })();
  trackPendingDocWork(documentId, work);
}

/** Scales inline font sizes across a stored document (corner-resize of a text item). */
export function scaleInlineFontSizeStored(documentId: string, factor: number): void {
  const store = getDocumentStore();
  const record = store.get(documentId);
  if (record) store.updateSnapshot(documentId, scaleSnapshotFontSize(record.snapshot, factor));
  changeStoredDoc(documentId, (fragment) => scaleYFontSize(fragment, factor));
}

function scaleSnapshotFontSize(blocks: RichContent, factor: number): RichContent {
  const scaleNodes = (nodes: InlineContent[]): InlineContent[] =>
    nodes.map((n) => {
      const scale = <T extends { styles: InlineStyles }>(c: T): T =>
        c.styles?.fontSize ? { ...c, styles: { ...c.styles, fontSize: String(scaleSize(Number(c.styles.fontSize), factor)) } } : c;
      return n.type === "link" ? { ...n, content: n.content.map(scale) } : scale(n);
    });
  return blocks.map((b) => ({
    ...b,
    ...(Array.isArray(b.content) ? { content: scaleNodes(b.content) } : {}),
    ...(b.children ? { children: scaleSnapshotFontSize(b.children, factor) } : {}),
  }));
}

/** Clears `key` across a stored document (Yjs content + preview snapshot). */
export function clearInlineStyleStored(documentId: string, key: string): void {
  const store = getDocumentStore();
  const record = store.get(documentId);
  if (record) store.updateSnapshot(documentId, stripInlineStyle(record.snapshot, key));

  // An editor opening meanwhile waits for this to land (see RichBlockEditor).
  changeStoredDoc(documentId, (fragment) => stripYStyle(fragment, key));
}
