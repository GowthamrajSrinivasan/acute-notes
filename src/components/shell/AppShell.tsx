"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { loadAIMode } from "@/ai/aiMode";
import { loadConnections } from "@/ai/connections";
import { getConversationStore } from "@/ai/conversations/conversationStore";
import { CanvasViewport } from "@/components/canvas/CanvasViewport";
import { isAIFeatureEnabled, isMcpUiEnabled } from "@/config/features";
import { PagePanel } from "@/components/pages/PagePanel";
import { useOnPropertiesPanelOpen } from "@/components/properties/panelSlot";
import { LENS_SLOT_ID } from "@/components/lens/lensSlot";
import { lensPanel } from "@/state/lensPanel";
import { getPersistence } from "@/persistence";
import { openWorkspace, rememberCanvas, type OpenedWorkspace } from "@/persistence/workspaceBootstrap";
import type { ImportSummary } from "@/portability/workspaceBundle";
import { getDocumentStore } from "@/state/documents";
import { hierarchy, useHierarchy } from "@/state/hierarchy";
import { pagePanel } from "@/state/pagePanel";
import { documentRegistry } from "@/sync/documentRegistry";
import { settlePendingWork } from "@/sync/pendingWork";
import * as ops from "@/workspaces/hierarchy";
import { canvasPath } from "@/workspaces/paths";
import { Navigator, type NavigatorCommands } from "./Navigator";
import { McpBridgeHost } from "./McpBridgeHost";
import { TopHeader } from "./TopHeader";

interface AppShellProps {
  workspaceId: string;
  /** The canvas in the URL; the workspace's last/first canvas when absent. */
  canvasId?: string;
}

/**
 * Canvas-first application shell (F01): a thin header, an optional
 * collapsible navigator (workspaces → canvases → pages, hidden by default),
 * the open canvas full-bleed and the page side panel when a
 * page is open.
 */
export function AppShell({ workspaceId, canvasId }: AppShellProps) {
  const router = useRouter();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [opened, setOpened] = useState<OpenedWorkspace | null>(null);
  const [error, setError] = useState<string | null>(null);
  /** Shown instead of the canvas while storage is changed underneath it. */
  const [busy, setBusy] = useState<string | null>(null);
  /** Bumped to reopen after a structural change even when the URL stays the same. */
  const [reopen, setReopen] = useState(0);
  const toggleSidebar = useCallback(() => setSidebarOpen((open) => !open), []);
  const closeSidebar = useCallback(() => setSidebarOpen(false), []);
  const { nodes } = useHierarchy();

  // The properties panel and the navigator both sit on the left: the panel opening closes the navigator. It isn't
  // reopened when the panel closes (that would shift the canvas on every select/deselect), and opening it again
  // while the panel shows is respected.
  useOnPropertiesPanelOpen(closeSidebar);

  // Re-registers every stored AI connection and restores primary/fallback
  // (F27) — the in-memory AIProviderManager starts empty on every load.
  useEffect(() => {
    if (!isAIFeatureEnabled()) return;
    void loadAIMode();
    void getConversationStore().loadSetting();
    void loadConnections();
  }, []);

  useEffect(() => {
    let cancelled = false;
    openWorkspace(getPersistence(), workspaceId, canvasId).then(
      async (ws) => {
        getDocumentStore().prime(ws.documents);
        await getDocumentStore().reload(ws.repairedDocuments);
        if (cancelled) return;
        setOpened(ws);
        setBusy(null);
        setError(null);
        void hierarchy.refresh();
        void rememberCanvas(getPersistence(), workspaceId, ws.canvas.id);
        if (ws.canvas.id !== canvasId) router.replace(canvasPath(workspaceId, ws.canvas.id));
      },
      (err: unknown) => {
        console.error("[acute-notes] Failed to open workspace", err);
        if (!cancelled) setError("Local storage is unavailable. Check that this browser allows site data.");
      },
    );
    return () => {
      cancelled = true;
    };
  }, [workspaceId, canvasId, reopen, router]);

  // A page belongs to its canvas: switching canvases closes it.
  const openCanvasId = opened?.canvas.id ?? null;
  useEffect(() => () => {
    pagePanel.close();
    lensPanel.close();
  }, [openCanvasId]);

  /**
   * Unmounts the canvas and page editor and lets them finish writing, so a
   * structural change never races (or is undone by) a late save.
   */
  const closeCanvas = useCallback(async (message: string) => {
    setBusy(message);
    setOpened(null);
    pagePanel.close();
    lensPanel.close();
    await new Promise((r) => requestAnimationFrame(() => setTimeout(r, 0)));
    await settlePendingWork();
    await getDocumentStore().flush();
    await documentRegistry.flushAll();
  }, []);

  // A workspace import replaces storage wholesale: close the canvas and page editor first.
  // A canvas import only adds new content, so the open canvas stays open until we move to the copy.
  const handleImport = useCallback(
    async (input: unknown, summary: ImportSummary) => {
      if (summary.scope === "canvas") {
        const { importCanvas } = await import("@/portability/workspaceBundle");
        const { canvasId } = await importCanvas(getPersistence(), input, workspaceId);
        await hierarchy.refresh();
        router.push(canvasPath(workspaceId, canvasId));
        return;
      }
      await closeCanvas("Importing workspace…");
      try {
        const { importWorkspace } = await import("@/portability/workspaceBundle");
        await importWorkspace(getPersistence(), input);
      } catch (err) {
        setReopen((n) => n + 1);
        throw err;
      }
      // A full reload, not client navigation: in-memory caches (documents,
      // providers, preferences) still hold the replaced workspace.
      window.location.assign(canvasPath(summary.workspaceId));
    },
    [closeCanvas, router, workspaceId],
  );

  const commands = useMemo<NavigatorCommands>(() => {
    // Lazy: this memo also runs during server rendering, where there is no IndexedDB.
    const services = () => getPersistence();
    /** Runs a change; the open canvas is closed first when the change affects it. */
    const change = async <T,>(
      affectsOpen: boolean,
      message: string,
      op: () => Promise<T>,
      after: (result: T) => void | Promise<void>,
    ): Promise<T | undefined> => {
      if (affectsOpen) await closeCanvas(message);
      try {
        const result = await op();
        await after(result);
        return result;
      } catch (err) {
        console.error(`[acute-notes] ${message}`, err);
        window.alert(err instanceof ops.HierarchyError ? err.message : "Something went wrong. Your data was not changed.");
        if (affectsOpen) setReopen((n) => n + 1);
        return undefined;
      } finally {
        await hierarchy.refresh();
      }
    };
    // Structural changes always navigate to a different URL, which reopens.
    const goTo = (wsId: string, pId?: string) => router.push(canvasPath(wsId, pId));
    const siblingOf = (canvasId: string) => {
      const node = hierarchy.get().nodes.find((n) => n.canvases.some((p) => p.id === canvasId));
      const index = node?.canvases.findIndex((p) => p.id === canvasId) ?? -1;
      return node?.canvases[index + 1] ?? node?.canvases[index - 1];
    };

    return {
      openCanvas: goTo,

      createWorkspace: async () => {
        const created = await change(false, "Couldn't create the workspace", () => ops.createWorkspace(services(), "Untitled workspace"), ({ workspace, canvas }) =>
          goTo(workspace.id, canvas.id),
        );
        return created?.workspace.id;
      },
      renameWorkspace: (id, name) =>
        void change(false, "Couldn't rename the workspace", () => ops.renameWorkspace(services(), id, name), (workspace) =>
          setOpened((o) => (o?.workspace.id === id ? { ...o, workspace } : o)),
        ),
      deleteWorkspace: async (id) => {
        const isOpen = id === workspaceId;
        const target = hierarchy.get().nodes.find((n) => n.workspace.id !== id);
        if (!target) return window.alert("You can't delete your only workspace.");
        await change(isOpen, "Deleting workspace…", () => ops.deleteWorkspace(services(), id), async (deleted) => {
          await getDocumentStore().reload(deleted);
          if (isOpen) goTo(target.workspace.id);
        });
      },

      createCanvas: async (wsId) => {
        const canvas = await change(false, "Couldn't create the canvas", () => ops.createCanvas(services(), wsId), (p) =>
          goTo(wsId, p.id),
        );
        return canvas?.id;
      },
      renameCanvas: (id, title) =>
        void change(false, "Couldn't rename the canvas", () => ops.renameCanvas(services(), id, title), (canvas) =>
          setOpened((o) => (o?.canvas.id === id ? { ...o, canvas } : o)),
        ),
      deleteCanvas: async (id) => {
        const isOpen = id === openCanvasId;
        const next = siblingOf(id);
        await change(isOpen, "Deleting canvas…", () => ops.deleteCanvas(services(), id), async (deleted) => {
          await getDocumentStore().reload(deleted);
          if (isOpen && next) goTo(next.workspaceId, next.id);
        });
      },
      moveCanvas: async (id, targetWorkspaceId) => {
        const isOpen = id === openCanvasId;
        await change(isOpen, "Moving canvas…", () => ops.moveCanvas(services(), id, targetWorkspaceId), async (moved) => {
          await getDocumentStore().reload(moved);
          if (isOpen) goTo(targetWorkspaceId, id);
        });
      },
    };
  }, [closeCanvas, router, workspaceId, openCanvasId]);

  // Dev-only: a new canvas filled with every object type, for trying AI features.
  const createDemoCanvas = useCallback(async () => {
    const { requestDemoCanvas } = await import("@/dev/demoCanvas");
    const canvasId = await requestDemoCanvas(workspaceId);
    await hierarchy.refresh();
    router.push(canvasPath(workspaceId, canvasId));
  }, [router, workspaceId]);

  const renameOpenWorkspace = useCallback((name: string) => commands.renameWorkspace(workspaceId, name), [commands, workspaceId]);
  const renameOpenCanvas = useCallback(
    (title: string) => openCanvasId && commands.renameCanvas(openCanvasId, title),
    [commands, openCanvasId],
  );

  // Live names for the breadcrumb (renames apply at once).
  const node = nodes.find((n) => n.workspace.id === workspaceId);
  const workspaceName = node?.workspace.name ?? opened?.workspace.name ?? "";
  const canvasTitle = node?.canvases.find((p) => p.id === openCanvasId)?.title ?? opened?.canvas.title ?? "";

  return (
    <div className="flex h-dvh flex-col">
      <TopHeader
        workspaceName={workspaceName}
        canvasTitle={canvasTitle}
        sidebarOpen={sidebarOpen}
        onToggleSidebar={toggleSidebar}
        onRenameWorkspace={renameOpenWorkspace}
        onRenameCanvas={renameOpenCanvas}
        onCreateDemoCanvas={process.env.NODE_ENV === "production" || !isAIFeatureEnabled() ? undefined : createDemoCanvas}
        workspaceId={workspaceId}
      />
      {isMcpUiEnabled() && <McpBridgeHost workspaceId={workspaceId} />}
      <div className="relative flex min-h-0 flex-1" data-sidebar-open={sidebarOpen || undefined}>
        {sidebarOpen && (
          <Navigator
            workspaceId={workspaceId}
            workspaceName={workspaceName}
            canvasId={openCanvasId}
            commands={commands}
            onImport={handleImport}
            onClose={closeSidebar}
          />
        )}
        <main className="relative min-w-0 flex-1" aria-label="Canvas">
          {error ? (
            <p role="alert" className="p-6 text-sm text-[var(--acute-text-muted)]">
              {error}
            </p>
          ) : busy ? (
            <p role="status" className="p-6 text-sm text-[var(--acute-text-muted)]">
              {busy}
            </p>
          ) : (
            <CanvasViewport canvas={opened?.canvas ?? null} />
          )}
        </main>
        {/* `display: contents` so the portaled LensPanel (rendered from inside the canvas, which has the live
            Excalidraw api) becomes an effective flex sibling of `<main>` here, like `PagePanel`. */}
        <div id={LENS_SLOT_ID} style={{ display: "contents" }} />
        {opened && !busy && <PagePanel />}
      </div>
    </div>
  );
}
