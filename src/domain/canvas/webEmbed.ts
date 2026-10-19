/**
 * Web embeds: Excalidraw embeddables whose `link` is an ordinary http(s) URL.
 *
 * Many sites (claude.ai artifacts, most apps behind a login) forbid being
 * framed via `X-Frame-Options` or CSP `frame-ancestors`; the browser then
 * shows an empty frame and gives the page no way to tell. We read those
 * headers server-side (`/api/embed/check`) to decide up front, and let the
 * user import the page's HTML instead. Imported HTML lives on the element
 * (`customData.acuteHtml`) and renders in a sandboxed `srcdoc` frame.
 */
import type { SceneElement } from "./adapter";

/** Largest imported HTML file kept on an element (it is saved with the scene). */
export const MAX_IMPORTED_HTML_BYTES = 2 * 1024 * 1024;

export interface ImportedHtml {
  html: string;
  /** Original file name, shown in the embed's toolbar. */
  name: string;
}

export function isWebLink(link: string | null | undefined): link is string {
  if (typeof link !== "string") return false;
  try {
    const url = new URL(link);
    return url.protocol === "https:" || url.protocol === "http:";
  } catch {
    return false;
  }
}

export function getImportedHtml(el: Pick<SceneElement, "customData">): ImportedHtml | null {
  const data = el.customData?.acuteHtml as Partial<ImportedHtml> | undefined;
  if (!data || typeof data.html !== "string") return null;
  return { html: data.html, name: typeof data.name === "string" ? data.name : "Imported HTML" };
}

/** `customData` with the imported HTML set, or removed with `null`. */
export function withImportedHtml(
  customData: Record<string, unknown> | undefined,
  imported: ImportedHtml | null,
): Record<string, unknown> {
  const next = { ...customData };
  if (imported) next.acuteHtml = { html: imported.html, name: imported.name };
  else delete next.acuteHtml;
  return next;
}

export interface FramingHeaders {
  xFrameOptions: string | null;
  contentSecurityPolicy: string | null;
}

/** Host-source match for one `frame-ancestors` token (`https://*.example.com`, `example.com:443`, …). */
function sourceMatches(token: string, embedder: URL): boolean {
  if (token === "*") return true;
  if (token === `${embedder.protocol}`) return true; // scheme-source, e.g. `https:`
  const m = /^(?:([a-z][a-z0-9+.-]*):\/\/)?(\*\.)?([^/:]+)(?::(\d+|\*))?/i.exec(token);
  if (!m) return false;
  const [, scheme, wildcard, host, port] = m;
  if (scheme && `${scheme.toLowerCase()}:` !== embedder.protocol) return false;
  const h = host!.toLowerCase();
  const hostOk = wildcard ? embedder.hostname.endsWith(`.${h}`) : embedder.hostname === h;
  if (!hostOk) return false;
  if (!port || port === "*") return true;
  const embedderPort = embedder.port || (embedder.protocol === "https:" ? "443" : "80");
  return port === embedderPort;
}

/**
 * Whether a page served with these headers may be framed by `embedderOrigin`.
 * CSP `frame-ancestors` takes precedence over `X-Frame-Options` (as in browsers).
 */
export function allowsFraming(headers: FramingHeaders, embedderOrigin: string, targetUrl: string): boolean {
  const embedder = new URL(embedderOrigin);
  const target = new URL(targetUrl);
  const directive = (headers.contentSecurityPolicy ?? "")
    .split(/[;,]/)
    .map((d) => d.trim().split(/\s+/))
    .find(([name]) => name?.toLowerCase() === "frame-ancestors");
  if (directive) {
    const sources = directive.slice(1).map((s) => s.replace(/^'|'$/g, "").toLowerCase());
    if (sources.includes("none") || sources.length === 0) return false;
    return sources.some((s) => (s === "self" ? target.origin === embedder.origin : sourceMatches(s, embedder)));
  }
  const xfo = headers.xFrameOptions?.trim().toLowerCase();
  if (xfo === "deny") return false;
  if (xfo === "sameorigin") return target.origin === embedder.origin;
  return true;
}
