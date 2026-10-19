"use client";

import { memo, useMemo, useState, type CSSProperties } from "react";
import { getCanvasCommands } from "@/components/canvas/canvasCommands";
import {
  ChevronRightIcon,
  CloseIcon,
  LocateIcon,
  PageIcon,
  PlusIcon,
  CanvasIcon,
  SearchIcon,
  SparkleIcon,
  TrashIcon,
  WorkspaceIcon,
} from "@/components/common/icons";
import { RenameInput } from "@/components/common/RenameInput";
import { MenuButton, RowMenu, type MenuItem, type OpenMenu } from "@/components/common/RowMenu";
import { UNTITLED_PAGE } from "@/domain/content/richContent";
import type { CanvasDocument, DocumentRecord } from "@/domain/types";
import { createPage, deletePage, renamePage } from "@/domain/pages/pageCommands";
import { useDocumentList } from "@/state/documents";
import { useHierarchy } from "@/state/hierarchy";
import { lensPanel } from "@/state/lensPanel";
import { useLensRoots } from "@/state/lensRoots";
import { pagePanel, usePagePanel } from "@/state/pagePanel";
import type { ImportSummary } from "@/portability/workspaceBundle";
import type { WorkspaceNode } from "@/workspaces/hierarchy";
import { WorkspaceTransfer } from "./WorkspaceTransfer";

/** Hierarchy changes, implemented by the shell (which closes the open canvas when needed). */
export interface NavigatorCommands {
  openCanvas(workspaceId: string, canvasId: string): void;
  /** Resolves to the new workspace's id (undefined when it failed). */
  createWorkspace(): Promise<string | undefined>;
  renameWorkspace(id: string, name: string): void;
  deleteWorkspace(id: string): Promise<void>;
  /** Resolves to the new canvas's id (undefined when it failed). */
  createCanvas(workspaceId: string): Promise<string | undefined>;
  renameCanvas(id: string, title: string): void;
  deleteCanvas(id: string): Promise<void>;
  moveCanvas(id: string, targetWorkspaceId: string): Promise<void>;
}

interface NavigatorProps {
  /** The open workspace and canvas. */
  workspaceId: string;
  workspaceName: string;
  canvasId: string | null;
  commands: NavigatorCommands;
  /** Replaces a workspace with an imported bundle (see `WorkspaceTransfer`). */
  onImport: (input: unknown, summary: ImportSummary) => Promise<void>;
  onClose: () => void;
}

const iconButton =
  "inline-flex h-7 w-7 shrink-0 cursor-pointer items-center justify-center rounded-md border-0 bg-transparent " +
  "text-[var(--acute-text-muted)] hover:bg-[var(--acute-surface-muted)] hover:text-[var(--acute-text)]";

const INDENT_PX = 14;
const indent = (level: number) => ({ "--acute-indent": `${level * INDENT_PX}px` }) as CSSProperties;
const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/**
 * The left navigator (F16): workspaces → canvases → the
 * open canvas's Lens roots and pages, with create, open, rename, move, delete and search.
 */
export const Navigator = memo(function Navigator({ workspaceId, workspaceName, canvasId, commands, onImport, onClose }: NavigatorProps) {
  const { loaded, nodes } = useHierarchy();
  const pages = useDocumentList(workspaceId, "page");
  const { pageId: openPageId } = usePagePanel();
  const lensRootsState = useLensRoots();
  const openLensRoots = lensRootsState.canvasId === canvasId ? lensRootsState.roots : [];
  const [query, setQuery] = useState("");
  /** Explicit expand/collapse per workspace; the open workspace is expanded by default. */
  const [toggled, setToggled] = useState<ReadonlyMap<string, boolean>>(new Map());
  const [renaming, setRenaming] = useState<string | null>(null);
  const [menu, setMenu] = useState<OpenMenu | null>(null);

  const q = query.trim().toLowerCase();
  const matches = (text: string) => text.toLowerCase().includes(q);
  const isExpanded = (id: string) => !!q || (toggled.get(id) ?? id === workspaceId);
  const setExpanded = (id: string, expanded: boolean) => setToggled((m) => new Map(m).set(id, expanded));

  const canvasPages = useMemo(
    () => pages.filter((p) => p.canvasId === canvasId).sort((a, b) => b.createdAt - a.createdAt),
    [pages, canvasId],
  );
  const visiblePages = q ? canvasPages.filter((p) => matches(p.title || UNTITLED_PAGE)) : canvasPages;

  const visibleNodes = nodes.flatMap((node) => {
    if (!q || matches(node.workspace.name)) return [{ node, canvases: node.canvases }];
    const canvases = node.canvases.filter((p) => matches(p.title) || (p.id === canvasId && visiblePages.length > 0));
    return canvases.length ? [{ node, canvases }] : [];
  });

  const newWorkspace = async () => {
    const id = await commands.createWorkspace();
    if (id) {
      setQuery("");
      setExpanded(id, true);
      setRenaming(id);
    }
  };
  const newCanvas = async (wsId: string) => {
    const id = await commands.createCanvas(wsId);
    if (id) {
      setQuery("");
      setExpanded(wsId, true);
      setRenaming(id);
    }
  };
  const newPage = () => {
    if (canvasId) pagePanel.open(createPage(workspaceId, canvasId), { focusTitle: true });
  };

  const workspaceMenu = (node: WorkspaceNode): MenuItem[] => {
    const { workspace, canvases } = node;
    const only = nodes.length === 1;
    return [
      { label: "New canvas", onSelect: () => void newCanvas(workspace.id) },
      { label: "Rename", hint: "F2", onSelect: () => setRenaming(workspace.id) },
      {
        label: "Delete workspace",
        hint: only ? "Only workspace" : undefined,
        disabled: only,
        separatorBefore: true,
        onSelect: () => {
          const message =
            `Delete workspace "${workspace.name}" and its ${plural(canvases.length, "canvas", "canvases")}? ` +
            "Every canvas, page and block in it is permanently removed from this device.";
          if (window.confirm(message)) void commands.deleteWorkspace(workspace.id);
        },
      },
    ];
  };

  const canvasMenu = (node: WorkspaceNode, canvas: CanvasDocument): MenuItem[] => {
    const last = node.canvases.length === 1;
    const targets = nodes.filter((n) => n.workspace.id !== node.workspace.id);
    return [
      { label: "Rename", hint: "F2", onSelect: () => setRenaming(canvas.id) },
      ...(targets.length
        ? [
            { label: last ? "Move to (last canvas)" : "Move to", heading: true, separatorBefore: true },
            ...targets.map((t) => ({
              label: t.workspace.name,
              disabled: last,
              onSelect: () => void commands.moveCanvas(canvas.id, t.workspace.id),
            })),
          ]
        : []),
      {
        label: "Delete canvas",
        hint: last ? "Last canvas" : undefined,
        disabled: last,
        separatorBefore: true,
        onSelect: () => {
          const message = `Delete canvas "${canvas.title}"? Its drawing, pages and blocks are permanently removed from this device.`;
          if (window.confirm(message)) void commands.deleteCanvas(canvas.id);
        },
      },
    ];
  };

  const openMenu = (id: string, label: string, items: MenuItem[], button: HTMLElement) =>
    setMenu((m) => (m?.id === id ? null : { id, label, items, anchor: button.getBoundingClientRect() }));

  return (
    <aside
      className="flex w-64 shrink-0 flex-col border-r border-[var(--acute-border)] bg-[var(--acute-surface)]"
      aria-label="Workspaces"
    >
      <div className="flex items-center justify-between px-3 pb-1 pt-3">
        <span className="text-xs font-semibold uppercase tracking-wide text-[var(--acute-text-muted)]">Workspaces</span>
        <div className="flex gap-0.5">
          <button type="button" className={iconButton} aria-label="New workspace" title="New workspace" onClick={() => void newWorkspace()}>
            <PlusIcon size={16} />
          </button>
          <WorkspaceTransfer workspaceId={workspaceId} workspaceName={workspaceName} onImport={onImport} buttonClassName={iconButton} />
          <button type="button" className={iconButton} aria-label="Close navigator" title="Close" onClick={onClose}>
            <CloseIcon size={16} />
          </button>
        </div>
      </div>
      <label className="mx-3 my-2 flex items-center gap-2 rounded-md bg-[var(--acute-surface-muted)] px-2 py-1.5 text-sm">
        <SearchIcon size={14} className="text-[var(--acute-text-muted)]" />
        <input
          type="search"
          placeholder="Search canvases and pages"
          aria-label="Search canvases and pages"
          className="w-full border-0 bg-transparent text-[var(--acute-text)] outline-none"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      </label>

      {!loaded ? (
        <p className="px-3 py-2 text-sm text-[var(--acute-text-muted)]">Loading…</p>
      ) : !visibleNodes.length ? (
        <p className="px-3 py-2 text-sm text-[var(--acute-text-muted)]">No matching canvases or pages.</p>
      ) : (
        <ul
          role="tree"
          aria-label="Workspaces and canvases"
          className="m-0 min-h-0 flex-1 list-none overflow-y-auto px-1.5 pb-3 pt-0"
          onScroll={() => setMenu(null)}
        >
          {visibleNodes.map(({ node, canvases }) => {
            const { workspace } = node;
            const expanded = isExpanded(workspace.id);
            return (
              <li key={workspace.id} role="treeitem" aria-expanded={expanded} aria-selected={false} className="list-none">
                <TreeRow
                  level={0}
                  icon={
                    <>
                      <ChevronRightIcon size={14} className="acute-nav-chevron" data-expanded={expanded || undefined} />
                      <WorkspaceIcon size={15} />
                    </>
                  }
                  label={workspace.name}
                  current={workspace.id === workspaceId}
                  renaming={renaming === workspace.id}
                  onActivate={() => setExpanded(workspace.id, !expanded)}
                  onRename={(name) => {
                    setRenaming(null);
                    if (name !== null && name !== workspace.name) commands.renameWorkspace(workspace.id, name);
                  }}
                  onStartRename={() => setRenaming(workspace.id)}
                  actions={
                    <>
                      <button
                        type="button"
                        className={iconButton}
                        title="New canvas"
                        aria-label={`New canvas in ${workspace.name}`}
                        onClick={() => void newCanvas(workspace.id)}
                      >
                        <PlusIcon size={14} />
                      </button>
                      <MenuButton
                        className={iconButton}
                        label={`${workspace.name} actions`}
                        open={menu?.id === workspace.id}
                        onOpen={(el) => openMenu(workspace.id, `${workspace.name} actions`, workspaceMenu(node), el)}
                      />
                    </>
                  }
                />
                {expanded && (
                  <ul role="group" className="m-0 list-none p-0">
                    {canvases.map((canvas) => {
                      const open = canvas.id === canvasId;
                      return (
                        <li key={canvas.id} role="treeitem" aria-selected={open} aria-expanded={open || undefined} className="list-none">
                          <TreeRow
                            level={1}
                            icon={<CanvasIcon size={15} />}
                            label={canvas.title}
                            current={open}
                            renaming={renaming === canvas.id}
                            onActivate={() => commands.openCanvas(workspace.id, canvas.id)}
                            onRename={(title) => {
                              setRenaming(null);
                              if (title !== null && title !== canvas.title) commands.renameCanvas(canvas.id, title);
                            }}
                            onStartRename={() => setRenaming(canvas.id)}
                            actions={
                              <MenuButton
                                className={iconButton}
                                label={`${canvas.title} actions`}
                                open={menu?.id === canvas.id}
                                onOpen={(el) => openMenu(canvas.id, `${canvas.title} actions`, canvasMenu(node, canvas), el)}
                              />
                            }
                          />
                          {open && (
                            <ul role="group" aria-label={`Pages in ${canvas.title}`} className="m-0 list-none p-0">
                              {!q &&
                                openLensRoots.map((r) => (
                                  <li key={`lens:${r.frameId}`} className="acute-page-row" style={indent(2)}>
                                    <button
                                      type="button"
                                      className="acute-page-row__open"
                                      title={`Open ${r.title} in Lens`}
                                      aria-label={`${r.title} (Lens, L${r.level})`}
                                      onClick={() => lensPanel.open({ canvasId: canvas.id, frameId: r.frameId })}
                                    >
                                      <SparkleIcon size={14} />
                                      <span className="truncate">{r.title}</span>
                                      <span className="acute-nav-lens-level">Lens · L{r.level}</span>
                                    </button>
                                  </li>
                                ))}
                              {visiblePages.map((page) => (
                                <PageRow key={page.id} page={page} open={page.id === openPageId} />
                              ))}
                              {!q && (
                                <li className="list-none">
                                  <button type="button" className="acute-nav-add" style={indent(2)} onClick={newPage}>
                                    <PlusIcon size={14} />
                                    New page
                                  </button>
                                </li>
                              )}
                            </ul>
                          )}
                        </li>
                      );
                    })}
                    {!q && (
                      <li className="list-none">
                        <button type="button" className="acute-nav-add" style={indent(1)} onClick={() => void newCanvas(workspace.id)}>
                          <PlusIcon size={14} />
                          New canvas
                        </button>
                      </li>
                    )}
                  </ul>
                )}
              </li>
            );
          })}
        </ul>
      )}
      {menu && <RowMenu menu={menu} onClose={() => setMenu(null)} />}
    </aside>
  );
});

// ---------------------------------------------------------------------------
// Rows
// ---------------------------------------------------------------------------

interface TreeRowProps {
  level: number;
  icon: React.ReactNode;
  label: string;
  current: boolean;
  renaming: boolean;
  onActivate: () => void;
  onStartRename: () => void;
  /** The new name, or null when renaming was cancelled. */
  onRename: (value: string | null) => void;
  actions: React.ReactNode;
}

function TreeRow({ level, icon, label, current, renaming, onActivate, onStartRename, onRename, actions }: TreeRowProps) {
  return (
    <div className="acute-page-row" data-open={current || undefined} style={indent(level)}>
      {renaming ? (
        <RenameInput value={label} label="Name" onDone={onRename} />
      ) : (
        <>
          <button
            type="button"
            className="acute-page-row__open"
            aria-current={current || undefined}
            title={`${label} — double-click to rename`}
            onClick={onActivate}
            onDoubleClick={onStartRename}
            onKeyDown={(e) => {
              if (e.key === "F2") onStartRename();
            }}
          >
            {icon}
            <span className="truncate">{label}</span>
          </button>
          <span className="acute-page-row__actions">{actions}</span>
        </>
      )}
    </div>
  );
}

const PageRow = memo(function PageRow({ page, open }: { page: DocumentRecord; open: boolean }) {
  const [renaming, setRenaming] = useState(false);
  const title = page.title.trim() || UNTITLED_PAGE;

  const showOnCanvas = () => {
    const canvas = getCanvasCommands();
    if (canvas && !canvas.revealPage(page.id)) canvas.insertPagePreview(page.id);
  };
  const remove = () => {
    if (window.confirm(`Delete "${title}"? Its content is removed; previews on the canvas show it as deleted.`)) {
      void deletePage(page.id);
    }
  };

  return (
    <li className="acute-page-row" data-open={open || undefined} style={indent(2)}>
      {renaming ? (
        <RenameInput
          value={page.title}
          label="Page title"
          onDone={(value) => {
            if (value !== null) renamePage(page.id, value);
            setRenaming(false);
          }}
        />
      ) : (
        <>
          <button
            type="button"
            className="acute-page-row__open"
            aria-current={open || undefined}
            title={`${title} — double-click to rename`}
            onClick={() => pagePanel.open(page.id)}
            onDoubleClick={() => setRenaming(true)}
            onKeyDown={(e) => {
              if (e.key === "F2") setRenaming(true);
            }}
          >
            <PageIcon size={15} />
            <span className="truncate" data-untitled={!page.title.trim() || undefined}>
              {title}
            </span>
          </button>
          <span className="acute-page-row__actions">
            <button type="button" className={iconButton} title="Show on canvas" aria-label={`Show ${title} on canvas`} onClick={showOnCanvas}>
              <LocateIcon size={14} />
            </button>
            <button type="button" className={iconButton} title="Delete page" aria-label={`Delete ${title}`} onClick={remove}>
              <TrashIcon size={14} />
            </button>
          </span>
        </>
      )}
    </li>
  );
});
