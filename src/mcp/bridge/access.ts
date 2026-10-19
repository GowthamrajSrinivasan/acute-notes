"use client";

/**
 * Who may reach this device's workspaces over MCP (F20/F21): a per-workspace
 * switch, off by default; an optional per-workspace read-only mode (clients
 * may read but not propose changes); and the credentials clients present.
 *
 * Credentials are issued by the server, one set per workspace (`credentials.ts`):
 * a bearer token for local agents (Claude Code, Cursor…) and, on request, secret
 * URLs for remote ones (ChatGPT's "No authentication" mode). This tab holds the
 * plaintext of what it was given, in the local `meta` store — never in workspace
 * documents or exports — plus an *owner secret* (random, per device) that proves
 * to the server this browser owns the workspace. Rotating the bearer or revoking
 * a secret URL takes effect on the server at once.
 */
import { useSyncExternalStore } from "react";
import { getPersistence } from "@/persistence";
import { BRIDGE_OWNER_HEADER, BRIDGE_WORKSPACE_HEADER } from "./protocol";
import type { McpScope } from "./protocol";

interface Held {
  id: string;
  token: string;
}

interface WorkspaceCredentials {
  bearer?: Held;
  secretUrl?: Held & { expiresAt: number | null; scope: McpScope };
}

interface McpAccess {
  /** Workspaces whose MCP access is on. */
  workspaces: Record<string, true>;
  /** Workspaces where clients may read but not propose changes. */
  readOnly: Record<string, true>;
  /** 32 random bytes, hex; created the first time access is turned on. Proves this browser owns its workspaces. */
  ownerSecret: string | null;
  credentials: Record<string, WorkspaceCredentials>;
  /** The public https origin remote clients reach this app on (a tunnel's, on desktop); hosted builds use their own origin. */
  publicUrl: string | null;
}

/** What the server reports about a workspace's credentials and OAuth grants (not persisted). */
export interface ServerAccessState {
  credentials: { id: string; kind: string; scope: McpScope; createdAt: number; expiresAt: number | null; lastUsed: number | null }[];
  grants: { id: string; clientName: string; scope: McpScope; createdAt: number }[];
  oauthEnabled: boolean;
}

const KEY = "mcp.access";
const EMPTY: McpAccess = { workspaces: {}, readOnly: {}, ownerSecret: null, credentials: {}, publicUrl: null };

let state: McpAccess = EMPTY;
let loaded: Promise<void> | null = null;
const listeners = new Set<() => void>();
const serverStates = new Map<string, ServerAccessState>();

function emit() {
  for (const l of listeners) l();
}

function load(): Promise<void> {
  loaded ??= getPersistence()
    .meta.get<Partial<McpAccess>>(KEY)
    .then((stored) => {
      if (stored) {
        // An older build stored one device-wide `token`; it is dropped — credentials are server-issued now.
        state = {
          workspaces: stored.workspaces ?? {},
          readOnly: stored.readOnly ?? {},
          ownerSecret: stored.ownerSecret ?? null,
          credentials: stored.credentials ?? {},
          publicUrl: stored.publicUrl ?? null,
        };
        emit();
      }
    });
  return loaded;
}

function save(next: McpAccess) {
  state = next;
  emit();
  void getPersistence().meta.set(KEY, next);
}

function randomHex(bytes: number): string {
  return Array.from(crypto.getRandomValues(new Uint8Array(bytes)), (b) => b.toString(16).padStart(2, "0")).join("");
}

async function ownerSecret(): Promise<string> {
  await load();
  if (state.ownerSecret) return state.ownerSecret;
  const secret = randomHex(32);
  save({ ...state, ownerSecret: secret });
  return secret;
}

/** One owner call to `/api/mcp/access`; returns the server's JSON (throws on a refusal). */
async function accessCall<T = Record<string, unknown>>(workspaceId: string, body: Record<string, unknown>, mayReclaim = true): Promise<T> {
  const secret = await ownerSecret();
  const res = await fetch("/api/mcp/access", {
    method: "POST",
    headers: { "content-type": "application/json", [BRIDGE_WORKSPACE_HEADER]: workspaceId, [BRIDGE_OWNER_HEADER]: secret },
    body: JSON.stringify(body),
    cache: "no-store",
  });
  if (res.status === 403 && mayReclaim && body.action !== "ensure") {
    // The server forgets who owns a workspace when it restarts: claim it again (a no-op if it is still ours; refused if
    // someone else holds it), then retry once.
    await syncMcpCredentials(workspaceId);
    return accessCall<T>(workspaceId, body, false);
  }
  if (!res.ok) throw new Error(`MCP access request refused (${res.status})`);
  return (await res.json()) as T;
}

function remember(workspaceId: string, update: (c: WorkspaceCredentials) => WorkspaceCredentials, server?: ServerAccessState) {
  save({ ...state, credentials: { ...state.credentials, [workspaceId]: update(state.credentials[workspaceId] ?? {}) } });
  if (server) {
    serverStates.set(workspaceId, server);
    emit();
  }
}

type EnsureResult = ServerAccessState & { bearer: Held | null };

/**
 * Claims the workspace with the server (first use) and makes sure this tab holds a bearer credential the server still
 * knows — after a server restart the old one is gone and a fresh one is issued. Also drops a secret URL the server no
 * longer has. Safe to call on every connect.
 */
export async function syncMcpCredentials(workspaceId: string): Promise<void> {
  await load();
  const held = state.credentials[workspaceId];
  const result = await accessCall<EnsureResult>(workspaceId, { action: "ensure", bearerId: held?.bearer?.id ?? null });
  const secretStillValid = !held?.secretUrl || result.credentials.some((c) => c.id === held.secretUrl!.id);
  remember(
    workspaceId,
    (c) => {
      const next: WorkspaceCredentials = { ...c, ...(result.bearer ? { bearer: result.bearer } : {}) };
      if (!secretStillValid) delete next.secretUrl;
      return next;
    },
    { credentials: result.credentials, grants: result.grants, oauthEnabled: result.oauthEnabled },
  );
}

export async function setMcpAccess(workspaceId: string, on: boolean): Promise<void> {
  await load();
  const workspaces = { ...state.workspaces };
  if (on) workspaces[workspaceId] = true;
  else delete workspaces[workspaceId];
  save({ ...state, workspaces });
  if (on) await syncMcpCredentials(workspaceId).catch(() => undefined);
  else await accessCall(workspaceId, { action: "revoke-all" }).then(() => forgetCredentials(workspaceId)).catch(() => undefined);
}

function forgetCredentials(workspaceId: string) {
  const credentials = { ...state.credentials };
  delete credentials[workspaceId];
  save({ ...state, credentials });
  serverStates.delete(workspaceId);
  emit();
}

export async function setMcpReadOnly(workspaceId: string, readOnly: boolean): Promise<void> {
  await load();
  const next = { ...state.readOnly };
  if (readOnly) next[workspaceId] = true;
  else delete next[workspaceId];
  save({ ...state, readOnly: next });
}

/** Read on every MCP tool call, so a change applies at once to connected clients. */
export function getMcpAllowWrites(workspaceId: string): boolean {
  return state.readOnly[workspaceId] !== true;
}

/** A new bearer token; the old one stops working at once, disconnecting every local client configured with it. */
export async function regenerateMcpToken(workspaceId: string): Promise<void> {
  const result = await accessCall<EnsureResult>(workspaceId, { action: "rotate-bearer" });
  remember(workspaceId, (c) => ({ ...c, ...(result.bearer ? { bearer: result.bearer } : {}) }), { credentials: result.credentials, grants: result.grants, oauthEnabled: result.oauthEnabled });
}

/** A secret URL for remote clients (ChatGPT's "No authentication" mode): the URL is the credential. */
export async function createSecretUrl(workspaceId: string, options: { scope?: McpScope; ttlMs?: number } = {}): Promise<void> {
  const result = await accessCall<ServerAccessState & { secretUrl: Held & { expiresAt: number | null; scope: McpScope } }>(workspaceId, { action: "issue-secret-url", ...options });
  remember(workspaceId, (c) => ({ ...c, secretUrl: result.secretUrl }), { credentials: result.credentials, grants: result.grants, oauthEnabled: result.oauthEnabled });
}

export async function revokeSecretUrl(workspaceId: string): Promise<void> {
  const id = state.credentials[workspaceId]?.secretUrl?.id;
  if (!id) return;
  const result = await accessCall<ServerAccessState>(workspaceId, { action: "revoke", credentialId: id }).catch(() => null);
  remember(workspaceId, (c) => {
    const { secretUrl: _gone, ...rest } = c;
    return rest;
  }, result ?? undefined);
}

export async function revokeOAuthGrant(workspaceId: string, grantId: string): Promise<void> {
  const result = await accessCall<ServerAccessState>(workspaceId, { action: "revoke", grantId });
  serverStates.set(workspaceId, { credentials: result.credentials, grants: result.grants, oauthEnabled: result.oauthEnabled });
  emit();
}

/** A short single-use code the owner types on the OAuth approval page. */
export async function createPairingCode(workspaceId: string): Promise<{ code: string; expiresAt: number }> {
  return accessCall<{ code: string; expiresAt: number }>(workspaceId, { action: "pairing-code" });
}

export async function setMcpPublicUrl(url: string | null): Promise<void> {
  await load();
  let normalized: string | null = null;
  if (url) {
    try {
      const parsed = new URL(url);
      if (parsed.protocol === "https:") normalized = parsed.origin;
    } catch {
      // not a URL: treated as cleared
    }
  }
  save({ ...state, publicUrl: normalized });
}

/** This tab's owner secret and workspace, for the bridge (`tabBridge.ts`). */
export async function getMcpOwnerSecret(): Promise<string> {
  return ownerSecret();
}

function subscribe(listener: () => void) {
  void load();
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export interface McpAccessView {
  enabled: boolean;
  readOnly: boolean;
  /** The bearer token for local clients (null until the server has issued one). */
  token: string | null;
  secretUrl: (Held & { expiresAt: number | null; scope: McpScope }) | null;
  publicUrl: string | null;
  server: ServerAccessState | null;
}

const NONE: McpAccessView = { enabled: false, readOnly: false, token: null, secretUrl: null, publicUrl: null, server: null };

let cached: { key: unknown[]; view: McpAccessView } | null = null;

/** A stable snapshot (the same object until something it shows changes) for `useSyncExternalStore`. */
function snapshot(workspaceId: string): McpAccessView {
  const creds = state.credentials[workspaceId];
  const server = serverStates.get(workspaceId) ?? null;
  const key = [workspaceId, state.workspaces[workspaceId], state.readOnly[workspaceId], creds, state.publicUrl, server];
  if (cached && cached.key.length === key.length && cached.key.every((k, i) => k === key[i])) return cached.view;
  const view: McpAccessView = {
    enabled: state.workspaces[workspaceId] === true,
    readOnly: state.readOnly[workspaceId] === true,
    token: creds?.bearer?.token ?? null,
    secretUrl: creds?.secretUrl ?? null,
    publicUrl: state.publicUrl,
    server,
  };
  cached = { key, view };
  return view;
}

/** Whether MCP access is on for `workspaceId`, and the credentials this tab holds for it. */
export function useMcpAccess(workspaceId: string): McpAccessView {
  return useSyncExternalStore(subscribe, () => snapshot(workspaceId), () => NONE);
}
