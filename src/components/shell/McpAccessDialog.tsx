"use client";

/**
 * MCP access (F20/F21): lets external agents such as Claude Code, Cursor, VS Code
 * or ChatGPT use the open workspace. Off by default, per workspace. Clients read
 * the workspace; anything they want to change is proposed for review on the
 * canvas first. Reachable from the app's `⋮` menu (`TopHeader.tsx`).
 *
 * Credentials are issued by the server (`src/mcp/bridge/credentials.ts`): a bearer
 * token for local agents, and — for remote ones like ChatGPT — a secret URL
 * ("No authentication" mode) or an OAuth connection approved with a pairing code.
 */
import { useEffect, useState } from "react";
import {
  createPairingCode,
  createSecretUrl,
  regenerateMcpToken,
  revokeOAuthGrant,
  revokeSecretUrl,
  setMcpAccess,
  setMcpPublicUrl,
  setMcpReadOnly,
  useMcpAccess,
} from "@/mcp/bridge/access";
import { MCP_ENDPOINT_PATH, MCP_SECRET_URL_PREFIX } from "@/mcp/bridge/protocol";
import { setMcpAllowIngest, useMcpAllowIngest } from "@/state/mcpIngest";
import { useMcpBridgeStatus } from "./McpBridgeHost";

const STATUS_TEXT = {
  off: "Off",
  connecting: "Connecting…",
  connected: "Ready — clients can connect while this tab is open",
  replaced: "Another Acute-Notes tab is serving MCP for this workspace. Come back to this tab to take over.",
  offline: "Can't reach the app server; retrying…",
} as const;

const LOOPBACK_HOST = /^(localhost|127\.0\.0\.1|\[::1\])$/;

export function McpAccessDialog({ workspaceId, workspaceName, onClose }: { workspaceId: string; workspaceName: string; onClose: () => void }) {
  const { enabled, readOnly, token, secretUrl, publicUrl, server } = useMcpAccess(workspaceId);
  const allowIngest = useMcpAllowIngest(workspaceId);
  const status = useMcpBridgeStatus();
  const [shown, setShown] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);
  const [pairing, setPairing] = useState<{ code: string; expiresAt: number } | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.preventDefault();
      onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  // The desktop app's window origin (acute://app) isn't reachable by MCP clients; its preload exposes the real loopback origin.
  const url = `${window.acuteDesktop?.mcpOrigin ?? window.location.origin}${MCP_ENDPOINT_PATH}`;
  const command = token ? `claude mcp add --transport http acute-notes ${url} --header "Authorization: Bearer ${token}"` : "";
  // Remote clients (ChatGPT) need a public https address: the hosted app's own origin, or a tunnel's on desktop / local dev.
  const hosted = !window.acuteDesktop && !LOOPBACK_HOST.test(window.location.hostname);
  const remoteBase = publicUrl ?? (hosted ? window.location.origin : null);
  const secretLink = secretUrl && remoteBase ? `${remoteBase}${MCP_SECRET_URL_PREFIX}${secretUrl.token}` : null;
  const copy = (what: string, text: string) => {
    void navigator.clipboard.writeText(text).then(() => {
      setCopied(what);
      setTimeout(() => setCopied((c) => (c === what ? null : c)), 1500);
    });
  };
  // The code is single-use and short-lived: it disappears from the dialog when the server would stop accepting it.
  const showPairing = (p: { code: string; expiresAt: number }) => {
    setPairing(p);
    setTimeout(() => setPairing((cur) => (cur === p ? null : cur)), Math.max(0, p.expiresAt - Date.now()));
  };
  const run = (action: () => Promise<unknown>) => {
    setError(null);
    void action().catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)));
  };

  return (
    <div className="acute-dialog__backdrop" onPointerDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="acute-dialog acute-mcp-dialog" role="dialog" aria-modal="true" aria-labelledby="acute-mcp-title">
        <h2 id="acute-mcp-title">MCP access</h2>
        <p className="acute-dialog__text">
          Let AI agents (Claude Code, Cursor, ChatGPT…) read “{workspaceName}”. Anything they want to add or change is shown to you on the canvas for review first — nothing is written until you accept it.
        </p>
        <div className="acute-dialog__row">
          <span id="acute-mcp-toggle-label">Allow MCP clients for this workspace</span>
          <div className="acute-dialog__seg" role="radiogroup" aria-labelledby="acute-mcp-toggle-label">
            {([true, false] as const).map((on) => (
              <button key={String(on)} type="button" role="radio" aria-checked={enabled === on} onClick={() => run(() => setMcpAccess(workspaceId, on))}>
                {on ? "On" : "Off"}
              </button>
            ))}
          </div>
        </div>
        {error && (
          <p className="acute-mcp-dialog__status" role="alert" data-status="offline">
            {error}
          </p>
        )}
        {enabled && (
          <>
            <div className="acute-dialog__row">
              <span id="acute-mcp-writes-label">Clients can</span>
              <div className="acute-dialog__seg" role="radiogroup" aria-labelledby="acute-mcp-writes-label">
                {([false, true] as const).map((ro) => (
                  <button key={String(ro)} type="button" role="radio" aria-checked={readOnly === ro} onClick={() => void setMcpReadOnly(workspaceId, ro)}>
                    {ro ? "Read only" : "Read and propose changes"}
                  </button>
                ))}
              </div>
            </div>
            {!readOnly && (
              <label className="acute-dialog__row">
                <input type="checkbox" checked={allowIngest} onChange={(e) => setMcpAllowIngest(workspaceId, e.target.checked)} />
                <span>Allow AI imports (spends your AI credit; local clients only; you still review every change)</span>
              </label>
            )}
            <p className="acute-mcp-dialog__status" role="status" data-status={status}>
              {STATUS_TEXT[status]}
            </p>

            <h3>On this computer (Claude Code, Cursor, VS Code)</h3>
            <div className="acute-mcp-dialog__label" role="group" aria-labelledby="acute-mcp-url">
              <span id="acute-mcp-url">Server URL</span>
              <span className="acute-mcp-dialog__field">
                <code>{url}</code>
                <button type="button" onClick={() => copy("url", url)}>
                  {copied === "url" ? "Copied" : "Copy"}
                </button>
              </span>
            </div>
            {token && (
              <div className="acute-mcp-dialog__label" role="group" aria-labelledby="acute-mcp-token">
                <span id="acute-mcp-token">Token — clients send it as a bearer token in the Authorization header</span>
                <span className="acute-mcp-dialog__field">
                  <code aria-label="Token">{shown ? token : "•".repeat(24)}</code>
                  <button type="button" onClick={() => setShown((s) => !s)}>
                    {shown ? "Hide" : "Show"}
                  </button>
                  <button type="button" onClick={() => copy("token", token)}>
                    {copied === "token" ? "Copied" : "Copy"}
                  </button>
                </span>
              </div>
            )}
            <AgentInstructions workspaceId={workspaceId} writesAllowed={!readOnly} copied={copied} onCopy={copy} />
            {token && (
              <div className="acute-mcp-dialog__label" role="group" aria-labelledby="acute-mcp-command">
                <span id="acute-mcp-command">Add to Claude Code</span>
                <span className="acute-mcp-dialog__field">
                  <code className="acute-mcp-dialog__command">{shown ? command : command.replace(token, "•".repeat(24))}</code>
                  <button type="button" onClick={() => copy("command", command)}>
                    {copied === "command" ? "Copied" : "Copy"}
                  </button>
                </span>
              </div>
            )}

            <h3>Remote agents (ChatGPT custom connector)</h3>
            <p className="acute-dialog__text">
              ChatGPT connects from the internet, so it needs a public https address.
              {hosted ? "" : " Run a tunnel to this app (for example cloudflared or ngrok), allow its host in the server's MCP_ALLOWED_HOSTS setting, and paste its https address here."}
            </p>
            {!hosted && (
              <div className="acute-mcp-dialog__label" role="group" aria-labelledby="acute-mcp-public">
                <span id="acute-mcp-public">Public address (https)</span>
                <span className="acute-mcp-dialog__field">
                  <input type="url" aria-label="Public address" defaultValue={publicUrl ?? ""} placeholder="https://example.trycloudflare.com" onBlur={(e) => void setMcpPublicUrl(e.target.value.trim() || null)} />
                </span>
              </div>
            )}
            <div className="acute-mcp-dialog__label" role="group" aria-labelledby="acute-mcp-secret">
              <span id="acute-mcp-secret">“No authentication” mode — secret URL. Anyone who has this URL can read this workspace and propose changes; it expires and can be revoked.</span>
              {secretUrl ? (
                <span className="acute-mcp-dialog__field">
                  <code>{secretLink ? (shown ? secretLink : `${remoteBase}${MCP_SECRET_URL_PREFIX}${"•".repeat(16)}`) : "Enter the public address above to see the URL"}</code>
                  {secretLink && (
                    <>
                      <button type="button" onClick={() => setShown((s) => !s)}>
                        {shown ? "Hide" : "Show"}
                      </button>
                      <button type="button" onClick={() => copy("secret", secretLink)}>
                        {copied === "secret" ? "Copied" : "Copy"}
                      </button>
                    </>
                  )}
                  <button type="button" onClick={() => run(() => revokeSecretUrl(workspaceId))} title="The URL stops working immediately">
                    Revoke
                  </button>
                </span>
              ) : (
                <span className="acute-mcp-dialog__field">
                  <button type="button" onClick={() => run(() => createSecretUrl(workspaceId, { scope: readOnly ? "read" : "propose" }))}>
                    Create secret URL
                  </button>
                </span>
              )}
              {secretUrl?.expiresAt && <span>Expires {new Date(secretUrl.expiresAt).toLocaleString()}</span>}
            </div>
            {server?.oauthEnabled && (
              <div className="acute-mcp-dialog__label" role="group" aria-labelledby="acute-mcp-oauth">
                <span id="acute-mcp-oauth">
                  “OAuth” mode — use {remoteBase ? `${remoteBase}${MCP_ENDPOINT_PATH}` : "your public address + /api/mcp"} as the Server URL; when ChatGPT asks, enter this code
                </span>
                <span className="acute-mcp-dialog__field">
                  <code>{pairing ? pairing.code : "—"}</code>
                  <button type="button" onClick={() => run(() => createPairingCode(workspaceId).then(showPairing))}>
                    New pairing code
                  </button>
                </span>
                {server.grants.map((g) => (
                  <span key={g.id} className="acute-mcp-dialog__field">
                    <span>{g.clientName}</span>
                    <button type="button" onClick={() => run(() => revokeOAuthGrant(workspaceId, g.id))}>
                      Revoke
                    </button>
                  </span>
                ))}
              </div>
            )}
          </>
        )}
        <div className="acute-dialog__actions">
          {enabled && token && (
            <button type="button" onClick={() => run(() => regenerateMcpToken(workspaceId))} title="Disconnects every local client configured with the current token">
              New token
            </button>
          )}
          <button type="button" data-primary autoFocus onClick={onClose}>
            Done
          </button>
        </div>
      </div>
    </div>
  );
}

const INSTRUCTION_CLIENTS = [
  { id: "claude", label: "Claude Code (CLAUDE.md)" },
  { id: "codex", label: "Codex (AGENTS.md)" },
  { id: "cursor", label: "Cursor (.cursor/rules)" },
] as const;

/**
 * "Agent instructions" (plan D49; setup plan §A1): the text a coding agent keeps in its project file — when and how to
 * use Acute — for the chosen client, to Copy or Download. Acute never writes into the repository itself.
 */
function AgentInstructions({ workspaceId, writesAllowed, copied, onCopy }: { workspaceId: string; writesAllowed: boolean; copied: string | null; onCopy: (what: string, text: string) => void }) {
  const [client, setClient] = useState<(typeof INSTRUCTION_CLIENTS)[number]["id"]>("claude");
  const artifact = () => import("@/mcp/setup/appArtifact").then((m) => m.appSetupArtifact(workspaceId, client, writesAllowed));
  return (
    <div className="acute-mcp-dialog__label" role="group" aria-labelledby="acute-mcp-instructions">
      <span id="acute-mcp-instructions">Agent instructions — for the agent’s project file (it tells the agent when and how to use Acute)</span>
      <span className="acute-mcp-dialog__field">
        <select aria-label="Agent" value={client} onChange={(e) => setClient(e.target.value as typeof client)}>
          {INSTRUCTION_CLIENTS.map((c) => (
            <option key={c.id} value={c.id}>
              {c.label}
            </option>
          ))}
        </select>
        <button type="button" onClick={() => void artifact().then((a) => onCopy("instructions", a.content))}>
          {copied === "instructions" ? "Copied" : "Copy"}
        </button>
        <button
          type="button"
          onClick={() =>
            void artifact().then((a) => {
              const url = URL.createObjectURL(new Blob([a.content], { type: "text/markdown" }));
              const link = document.createElement("a");
              link.href = url;
              link.download = a.targetPath.split("/").pop()!;
              link.click();
              URL.revokeObjectURL(url);
            })
          }
        >
          Download
        </button>
      </span>
    </div>
  );
}
