/** App URL of a workspace, or of one of its canvases. */
export function canvasPath(workspaceId: string, canvasId?: string): string {
  const base = `/workspace/${encodeURIComponent(workspaceId)}`;
  return canvasId ? `${base}/${encodeURIComponent(canvasId)}` : base;
}
