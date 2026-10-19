import { getCanvasCommands } from "@/components/canvas/canvasCommands";
import { contentToMarkdown, pageToMarkdown } from "@/domain/content/markdown";
import { getDocumentStore } from "@/state/documents";
import { documentRegistry } from "@/sync/documentRegistry";
import { downloadText, fileSlug } from "./download";

/** Writes every open editor's pending changes so exports read current state. */
export async function flushLiveState(): Promise<void> {
  await getCanvasCommands()?.flush();
  await getDocumentStore().flush();
  await documentRegistry.flushAll();
}

/** A page (title + content) or a block (content only) as Markdown, from current state. */
export async function documentMarkdown(documentId: string, asPage: boolean): Promise<{ title: string; markdown: string }> {
  await flushLiveState();
  const store = getDocumentStore();
  await store.load(documentId);
  const rec = store.get(documentId);
  if (!rec) throw new Error(`Document ${documentId} not found`);
  const markdown = asPage ? pageToMarkdown(rec.title, rec.snapshot) : contentToMarkdown(rec.snapshot);
  return { title: rec.title, markdown };
}

/** Downloads a page or block as a `.md` file. */
export async function downloadMarkdown(documentId: string, asPage: boolean): Promise<void> {
  const { title, markdown } = await documentMarkdown(documentId, asPage);
  downloadText(`${fileSlug(title, asPage ? "page" : "block")}.md`, markdown, "text/markdown");
}
