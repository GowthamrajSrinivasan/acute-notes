/**
 * Canvas text search across both kinds of text (plan B#10): native Excalidraw
 * text elements and Acute text items / blocks (their snapshot plain text).
 * Pure matching lives here so it is testable without a browser.
 */
export interface SearchSource {
  elementId: string;
  kind: "text" | "rich";
  text: string;
}

export interface SearchResult {
  elementId: string;
  kind: SearchSource["kind"];
  /** Number of matches in this element. */
  count: number;
  /** Text around the first match. */
  snippet: { before: string; match: string; after: string };
}

const CONTEXT = 24;

export function searchSources(sources: readonly SearchSource[], query: string): SearchResult[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  const results: SearchResult[] = [];
  for (const s of sources) {
    const haystack = s.text.toLowerCase();
    let at = haystack.indexOf(q);
    if (at < 0) continue;
    const first = at;
    let count = 0;
    while (at >= 0) {
      count++;
      at = haystack.indexOf(q, at + q.length);
    }
    const flat = s.text.replace(/\s+/g, " ");
    const flatFirst = flat.toLowerCase().indexOf(q);
    const i = flatFirst >= 0 ? flatFirst : first;
    results.push({
      elementId: s.elementId,
      kind: s.kind,
      count,
      snippet: {
        before: (i > CONTEXT ? "…" : "") + flat.slice(Math.max(0, i - CONTEXT), i),
        match: flat.slice(i, i + q.length),
        after: flat.slice(i + q.length, i + q.length + CONTEXT) + (i + q.length + CONTEXT < flat.length ? "…" : ""),
      },
    });
  }
  return results;
}
