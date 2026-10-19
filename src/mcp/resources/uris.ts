/**
 * Acute-Notes MCP resource URIs (F20, PRD §F20). One place builds and parses
 * them, so every payload links to other resources the same way.
 *
 *   acute://workspace/{workspaceId}
 *   acute://canvas/{canvasId}
 *   acute://page/{pageId}
 *   acute://table/{objectId}   (a table block's canvas element id)
 *   acute://todo/{objectId}    (a todo block's canvas element id)
 *   acute://context/current
 */

export const RESOURCE_KINDS = ["workspace", "canvas", "page", "table", "todo"] as const;
export type ResourceKind = (typeof RESOURCE_KINDS)[number];

export const CURRENT_CONTEXT_URI = "acute://context/current" as const;

/** The URI template of one resource kind, e.g. `acute://page/{pageId}`. */
export const URI_TEMPLATES: Record<ResourceKind, string> = {
  workspace: "acute://workspace/{workspaceId}",
  canvas: "acute://canvas/{canvasId}",
  page: "acute://page/{pageId}",
  table: "acute://table/{objectId}",
  todo: "acute://todo/{objectId}",
};

export function resourceUri(kind: ResourceKind, id: string): string {
  return `acute://${kind}/${encodeURIComponent(id)}`;
}

/** `{kind, id}` of an `acute://` resource URI, or null when it isn't one. */
export function parseResourceUri(uri: string): { kind: ResourceKind; id: string } | null {
  const m = /^acute:\/\/([a-z]+)\/([^/?#]+)$/.exec(uri);
  if (!m || !RESOURCE_KINDS.includes(m[1] as ResourceKind)) return null;
  try {
    return { kind: m[1] as ResourceKind, id: decodeURIComponent(m[2]!) };
  } catch {
    return null;
  }
}
