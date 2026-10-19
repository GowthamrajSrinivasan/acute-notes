/**
 * What the app does for the repo-map tools (F43) beyond the open canvas:
 * create the map canvas and open it in this tab. Registered by the app shell
 * while MCP is served (`McpBridgeHost`), like `LiveCanvasActions` is by the
 * canvas, so the tools never touch React, the router or storage writes for
 * the workspace tree themselves.
 */
export interface RepoMapHost {
  /** Creates a canvas in the served workspace; returns its id. */
  createCanvas(title: string): Promise<string>;
  /** Opens a canvas of the served workspace in this tab (client-side navigation: the MCP session survives). */
  openCanvas(canvasId: string): void;
}

let current: RepoMapHost | null = null;

export function registerRepoMapHost(host: RepoMapHost): () => void {
  current = host;
  return () => {
    if (current === host) current = null;
  };
}

export function getRepoMapHost(): RepoMapHost | null {
  return current;
}
