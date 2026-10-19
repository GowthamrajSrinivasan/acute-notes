/** Set by the Electron preload (electron/preload.cjs); absent in a normal browser. */
interface Window {
  acuteDesktop?: {
    /** Loopback origin MCP clients can reach (the window's own origin, acute://app, is not reachable from other processes). */
    mcpOrigin?: string;
    /** The desktop SQLite store (electron/storage/): one validated request per repository call. Never raw SQL. */
    storage?: {
      invoke(service: string, method: string, args: unknown[]): Promise<{ ok: true; value: unknown } | { ok: false; error: { name?: string; code?: string; message: string } }>;
    };
  };
}
