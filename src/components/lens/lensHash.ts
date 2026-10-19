/**
 * Acute Lens's deep link (plan §5.1): `#lens=<frameKey>&path=<k1>&path=<k2>&node=<key>` (plus `&from=<canvas>~<key>&to=…&via=<kind>`
 * while a path is traced, so a route can be shared like archify's `#route=a~b`), one `path` per drill
 * step (node keys contain dots themselves — "payments.webhook" — so the plan's `k1.k2` form can't be split back), so a position can be shared or
 * reopened after a reload. No existing hash-router precedent in the app to match (the frames plan's own
 * `#frame=/#view=` was never built) — a plain `URLSearchParams` over `location.hash`, written with
 * `history.replaceState` so it never adds a history entry.
 */

/** A path in progress or done (`from`, then `to`): each end is `<canvasId>~<node key>`, as the canvas and key tell it apart. */
export interface LensHashTrace {
  from: { canvasId: string; key: string };
  to: { canvasId: string; key: string } | null;
  kind: string | null;
}

export interface LensHash {
  lens: string;
  path: string[];
  node: string | null;
  trace: LensHashTrace | null;
}

const encodeEnd = (e: { canvasId: string; key: string }) => `${e.canvasId}~${e.key}`;
function decodeEnd(text: string | null): { canvasId: string; key: string } | null {
  const at = text ? text.indexOf("~") : -1;
  return text && at > 0 && at < text.length - 1 ? { canvasId: text.slice(0, at), key: text.slice(at + 1) } : null;
}

export function readLensHash(): LensHash | null {
  if (typeof window === "undefined") return null;
  const params = new URLSearchParams(window.location.hash.replace(/^#/, ""));
  const lens = params.get("lens");
  if (!lens) return null;
  const from = decodeEnd(params.get("from"));
  const trace = from ? { from, to: decodeEnd(params.get("to")), kind: params.get("via") } : null;
  return { lens, path: params.getAll("path").filter(Boolean), node: params.get("node"), trace };
}

export function writeLensHash(lensKey: string, path: readonly string[], node: string | null, trace?: { from: { canvasId: string; key: string }; to: { canvasId: string; key: string } | null; kind: string } | null): void {
  if (typeof window === "undefined") return;
  const params = new URLSearchParams();
  params.set("lens", lensKey);
  for (const step of path) params.append("path", step);
  if (node) params.set("node", node);
  if (trace) {
    params.set("from", encodeEnd(trace.from));
    if (trace.to) params.set("to", encodeEnd(trace.to));
    if (trace.kind !== "any") params.set("via", trace.kind);
  }
  const hash = `#${params.toString()}`;
  if (window.location.hash !== hash) window.history.replaceState(window.history.state, "", window.location.pathname + window.location.search + hash);
}

/** Removes the deep link (Lens closed), so a reload doesn't reopen it. */
export function clearLensHash(): void {
  if (typeof window === "undefined" || !readLensHash()) return;
  window.history.replaceState(window.history.state, "", window.location.pathname + window.location.search);
}
