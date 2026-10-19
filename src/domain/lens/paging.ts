/**
 * "Overview first, then drill in" paging for large MCP reads (plan §7.1, Phase 3; AFFiNE lesson G2): a page cursor
 * is tied to the version of the scenes it was cut from, so one listing can't mix two versions of a canvas — a cursor
 * from before an edit is refused, and the caller starts again from the first page. Pure (no I/O, D41).
 *
 * - **Scene version:** a short hash over every element's id, version and deleted flag, per canvas, in canvas order.
 *   Any edit Excalidraw makes bumps an element's version, so any edit changes it.
 * - **Cursor:** opaque to the caller (base64url JSON, ASCII only): which listing it continues (`k`), the scene version
 *   (`v`), the offset (`o`), and a hash of the request's other arguments (`q`), so a cursor can't continue a
 *   different query.
 */

/** FNV-1a, 32-bit, as 8 hex digits. Stable across runs and platforms; not a security hash. */
export function fnv1a(text: string, seed = 0x811c9dc5): string {
  let h = seed >>> 0;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, "0");
}

type VersionedElement = { id: string; isDeleted?: boolean; version?: number };

/** The version of a set of scenes: changes whenever any element on them is added, edited or deleted. */
export function sceneVersion(canvases: readonly { canvasId: string; elements: readonly VersionedElement[] }[]): string {
  const parts: string[] = [];
  for (const c of [...canvases].sort((a, b) => (a.canvasId < b.canvasId ? -1 : a.canvasId > b.canvasId ? 1 : 0))) {
    parts.push(`#${c.canvasId}`);
    for (const el of c.elements) parts.push(`${el.id}:${el.version ?? 0}${el.isDeleted ? "x" : ""}`);
  }
  const text = parts.join("|");
  // Two seeds: 64 bits, so two different scenes practically never share a version.
  return fnv1a(text) + fnv1a(text, 0x01000193);
}

export interface PageCursor {
  /** Which listing: "lens", "canvas". */
  k: string;
  /** The scene version page 1 was cut from. */
  v: string;
  /** Offset of the next page's first item. */
  o: number;
  /** Hash of the request's other arguments. */
  q: string;
}

const toBase64Url = (ascii: string) => btoa(ascii).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const fromBase64Url = (b64: string) => atob(b64.replace(/-/g, "+").replace(/_/g, "/"));

export function encodeCursor(cursor: PageCursor): string {
  return toBase64Url(JSON.stringify(cursor));
}

/** The cursor, or null when `text` isn't one (garbled, or from another tool). */
export function decodeCursor(text: string): PageCursor | null {
  try {
    const c = JSON.parse(fromBase64Url(text)) as Partial<PageCursor>;
    if (typeof c.k !== "string" || typeof c.v !== "string" || typeof c.q !== "string" || !Number.isInteger(c.o) || c.o! < 0) return null;
    return { k: c.k, v: c.v, o: c.o!, q: c.q };
  } catch {
    return null;
  }
}

/** A query's identity for `PageCursor.q`: its arguments other than the cursor, in a stable order. */
export function queryHash(args: Record<string, unknown>): string {
  const keys = Object.keys(args).filter((k) => k !== "cursor" && args[k] !== undefined).sort();
  return fnv1a(JSON.stringify(keys.map((k) => [k, args[k]])));
}

export type PageCheck = { ok: true; offset: number } | { ok: false; message: string };

/**
 * Where a page starts: 0 without a cursor; the cursor's offset when it continues this listing (`kind`, `query`) at
 * this version; a refusal otherwise, telling the caller to start again.
 */
export function pageStart(cursorText: string | undefined, kind: string, version: string, query: string): PageCheck {
  if (!cursorText) return { ok: true, offset: 0 };
  const c = decodeCursor(cursorText);
  if (!c || c.k !== kind) return { ok: false, message: "That cursor isn't from this tool; call it again without `cursor`." };
  if (c.q !== query) return { ok: false, message: "That cursor belongs to a different query; pass the same arguments as the first page, or start again without `cursor`." };
  if (c.v !== version) return { ok: false, message: "The canvas changed since the first page was read, so this cursor would mix two versions; call again without `cursor` to start over." };
  return { ok: true, offset: c.o };
}
