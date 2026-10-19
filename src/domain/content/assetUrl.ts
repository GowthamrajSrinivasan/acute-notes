/**
 * Images in rich content (pages) reference the local asset store by URL:
 * `acute-asset://<id>`. The binary lives in the `assets` store (the same one
 * canvas images use, keyed by content hash), never in the document, so a
 * page's Y.Doc and snapshot stay small. Viewers resolve the URL to a blob URL.
 */
import type { RichContent } from "@/domain/types";

export const ASSET_SCHEME = "acute-asset://";

export function assetUrl(id: string): string {
  return ASSET_SCHEME + id;
}

/** The asset id of an `acute-asset://` URL, else null (remote/data URLs). */
export function assetIdOf(url: unknown): string | null {
  return typeof url === "string" && url.startsWith(ASSET_SCHEME) && url.length > ASSET_SCHEME.length ? url.slice(ASSET_SCHEME.length) : null;
}

/** Ids of every stored asset the content's image blocks use. */
export function collectAssetIds(blocks: RichContent, into = new Set<string>()): Set<string> {
  for (const b of blocks) {
    if (b.type === "image") {
      const id = assetIdOf(b.props?.url);
      if (id) into.add(id);
    }
    if (b.children?.length) collectAssetIds(b.children, into);
  }
  return into;
}
