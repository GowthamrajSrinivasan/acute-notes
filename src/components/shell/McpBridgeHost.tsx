"use client";

/**
 * Serves MCP (F20/F21) from this tab while the open workspace's MCP access is
 * on (`src/mcp/bridge`). Renders nothing; the SDK and the bridge are loaded
 * only once access is on, never in the initial bundle.
 */
import { useRouter } from "next/navigation";
import { useEffect, useSyncExternalStore } from "react";
import { AIRuntime } from "@/ai/runtime";
import { getMcpAllowWrites, getMcpOwnerSecret, syncMcpCredentials, useMcpAccess } from "@/mcp/bridge/access";
import type { BridgeStatus } from "@/mcp/bridge/tabBridge";
import { getPersistence } from "@/persistence";
import { hierarchy } from "@/state/hierarchy";
import { getMcpAllowIngest } from "@/state/mcpIngest";
import { createCanvas } from "@/workspaces/hierarchy";
import { canvasPath } from "@/workspaces/paths";

let status: BridgeStatus | "off" = "off";
const listeners = new Set<() => void>();
function setStatus(next: BridgeStatus | "off") {
  if (status === next) return;
  status = next;
  for (const l of listeners) l();
}

/** The bridge's state for the MCP access dialog. */
export function useMcpBridgeStatus(): BridgeStatus | "off" {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => status,
    () => "off",
  );
}

/**
 * The bridge outlives a remount of the shell: opening another canvas re-renders the page (and this component), and
 * restarting the bridge would drop every client's MCP session — including the `begin_repo_map` call (F43) that
 * opened the canvas. So a stop waits a moment, and a remount for the same workspace keeps the bridge.
 */
const KEEP_ALIVE_MS = 3000;
let running: { key: string; stop: () => void; timer: ReturnType<typeof setTimeout> | null } | null = null;

function stopRunning() {
  if (!running) return;
  if (running.timer) clearTimeout(running.timer);
  running.stop();
  running = null;
  setStatus("off");
}

export function McpBridgeHost({ workspaceId }: { workspaceId: string }) {
  const { enabled } = useMcpAccess(workspaceId);
  const router = useRouter();

  // Repo maps (F43): the map canvas is created in this workspace and opened here, without a reload (the MCP session survives).
  useEffect(() => {
    if (!enabled) return;
    let unregister: (() => void) | null = null;
    let cancelled = false;
    void import("@/mcp/tools/repoMap/host").then(({ registerRepoMapHost }) => {
      if (cancelled) return;
      unregister = registerRepoMapHost({
        createCanvas: async (title) => {
          const canvas = await createCanvas(getPersistence(), workspaceId, title);
          void hierarchy.refresh();
          return canvas.id;
        },
        openCanvas: (canvasId) => router.push(canvasPath(workspaceId, canvasId)),
      });
    });
    return () => {
      cancelled = true;
      unregister?.();
    };
  }, [enabled, workspaceId, router]);

  useEffect(() => {
    if (!enabled) {
      stopRunning();
      setStatus("off");
      return;
    }
    const key = workspaceId;
    if (running?.key === key) {
      // Remounted for the same workspace: keep serving.
      if (running.timer) clearTimeout(running.timer);
      running.timer = null;
    } else {
      stopRunning();
      let stop: (() => void) | null = null;
      let cancelled = false;
      const entry = {
        key,
        timer: null as ReturnType<typeof setTimeout> | null,
        stop: () => {
          cancelled = true;
          stop?.();
        },
      };
      running = entry;
      setStatus("connecting");
      void Promise.all([import("@/mcp/bridge/tabBridge"), import("@/mcp/server"), getMcpOwnerSecret(), import("@/ai/changes/pendingPersistence")]).then(([{ startTabBridge }, { createAcuteMcpServer }, ownerSecret, { restorePendingProposals }]) => {
        if (cancelled) return;
        const services = getPersistence();
        // Proposals a client left under review survive a reload: they come back for the owner to accept or reject.
        void restorePendingProposals(services.meta);
        stop = startTabBridge({
          workspaceId,
          ownerSecret,
          beforeConnect: () => syncMcpCredentials(workspaceId),
          createServer: ({ sessionId, remote, scope }) =>
            createAcuteMcpServer({
              services,
              workspaceId,
              sessionId,
              remote,
              // A client may propose only while the workspace allows writes AND its own credential carries the propose scope.
              toolPolicy: () => ({ allowWrites: getMcpAllowWrites(workspaceId) && scope === "propose" }),
              repoMap: { services: { store: services.repoMaps, contentSources: services.contentSources } },
              // Content imports (AI, the user's credit): served to local sessions, and only while the user allows them for this workspace.
              ingest: { runtime: AIRuntime, contentSources: services.contentSources, allowed: () => getMcpAllowIngest(workspaceId) },
              agentState: services.agentState,
              // Agent State (D46): each session's calls and characters returned, per tool.
              onToolCall: (call) => void import("@/state/agentLog").then((m) => m.recordUsage(workspaceId, call.session, call.agent, call.tool, call.chars)),
            }),
          onStatus: (st) => {
            if (running === entry) setStatus(st);
          },
        });
      });
    }
    return () => {
      const current = running;
      if (current?.key !== key) return;
      current.timer = setTimeout(() => {
        if (running === current) stopRunning();
      }, KEEP_ALIVE_MS);
    };
  }, [enabled, workspaceId]);

  return null;
}
