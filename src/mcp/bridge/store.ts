/**
 * The relay store interface and the process's MCP services (proof of concept).
 *
 * `RelayStore` is the seam the production design swaps: `InMemoryRelayStore` here (desktop, tests, the local PoC),
 * a Firestore-backed one later. Whatever the implementation, relays are keyed by workspace and a caller only ever
 * reaches the relay of the workspace its credential was issued for.
 *
 * The in-memory services live on `globalThis` so dev reloads of the route modules share them. They are NOT a
 * production design: one process, lost on restart, no shared state between instances.
 */
import { CredentialStore } from "./credentials";
import { OAuthStore } from "./oauth";
import { RateLimiter } from "./rateLimit";
import { McpRelay } from "./relay";

export interface RelayStore {
  /** The workspace's relay, created on first use. */
  relayFor(workspaceId: string): McpRelay;
  /** The workspace's relay if one exists (no tab has ever connected for it otherwise). */
  existing(workspaceId: string): McpRelay | undefined;
}

export class InMemoryRelayStore implements RelayStore {
  private readonly relays = new Map<string, McpRelay>();

  relayFor(workspaceId: string): McpRelay {
    let relay = this.relays.get(workspaceId);
    if (!relay) this.relays.set(workspaceId, (relay = new McpRelay()));
    return relay;
  }

  existing(workspaceId: string): McpRelay | undefined {
    return this.relays.get(workspaceId);
  }
}

export interface McpServices {
  relays: RelayStore;
  credentials: CredentialStore;
  oauth: OAuthStore;
  limits: {
    /** Requests per credential (or per client address before one authenticates). */
    requests: RateLimiter;
    /** Failed authentications (bad token, bad owner secret, bad pairing code) per client address. */
    failures: RateLimiter;
  };
}

export function createMcpServices(now: () => number = Date.now): McpServices {
  const relays = new InMemoryRelayStore();
  const credentials = new CredentialStore(now);
  // A revoked credential ends its live sessions at once.
  credentials.onRevoked((workspaceId, credentialId) => relays.existing(workspaceId)?.dropCredential(credentialId));
  return {
    relays,
    credentials,
    oauth: new OAuthStore(credentials, now),
    limits: { requests: new RateLimiter(120, 60_000, now), failures: new RateLimiter(20, 5 * 60_000, now) },
  };
}

const GLOBAL_KEY = "__acuteMcpServices";

export function getMcpServices(): McpServices {
  const g = globalThis as unknown as Record<string, McpServices | undefined>;
  return (g[GLOBAL_KEY] ??= createMcpServices());
}
