/**
 * Links from an L5 source card out to the code (plan §5.2, AC8). Pure: the targets (a local folder, a web repo URL)
 * come from the user, device-locally (`state/lensRepoLinks.ts`). Acute never reads the files itself.
 */

export interface RepoLinks {
  /** Absolute local folder with forward slashes and no trailing slash, e.g. `C:/src/shop` or `/home/me/shop`. */
  root?: string;
  /** `https://github.com/org/repo` (any http(s) host serving `/blob/<ref>/<path>` works). */
  web?: string;
}

/** Trimmed and normalised; a web URL that isn't http(s) is dropped. */
export function cleanRepoLinks(links: RepoLinks): RepoLinks {
  const root = links.root?.trim().replace(/\\/g, "/").replace(/\/+$/, "");
  let web: string | undefined;
  try {
    const url = links.web?.trim() ? new URL(links.web.trim()) : undefined;
    web = url && (url.protocol === "https:" || url.protocol === "http:") ? url.href.replace(/\/+$/, "") : undefined;
  } catch {
    web = undefined;
  }
  return { ...(root ? { root } : {}), ...(web ? { web } : {}) };
}

/** `vscode://file/<root>/<path>:<line>`, or undefined without a root. */
export function vscodeUrl(links: RepoLinks, path: string, line?: number): string | undefined {
  if (!links.root) return undefined;
  const file = `${links.root}/${path.replace(/^\/+/, "")}`.replace(/^\/+/, "");
  return `vscode://file/${encodeURI(file)}${line ? `:${line}` : ""}`;
}

/** `<web>/blob/<commit or HEAD>/<path>#L<a>-L<b>`, or undefined without a web URL. */
export function webUrl(links: RepoLinks, path: string, lines?: [number, number], commit?: string): string | undefined {
  if (!links.web) return undefined;
  const anchor = lines ? (lines[0] === lines[1] ? `#L${lines[0]}` : `#L${lines[0]}-L${lines[1]}`) : "";
  return `${links.web}/blob/${encodeURIComponent(commit ?? "HEAD")}/${encodeURI(path.replace(/^\/+/, ""))}${anchor}`;
}
