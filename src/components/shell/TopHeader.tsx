"use client";

import { memo, useEffect, useState } from "react";
import { aiPanel, OPEN_AI_SETTINGS_EVENT, useAIMode } from "@/components/ai/askAI";
import { visualizeDialog } from "@/components/ai/visualizeStore";
import { isAIFeatureEnabled, isMcpUiEnabled } from "@/config/features";
import { PanelLeftIcon } from "@/components/common/icons";
import { RenameInput } from "@/components/common/RenameInput";
import { MenuButton, RowMenu, type OpenMenu } from "@/components/common/RowMenu";
import { getCanvasCommands } from "@/components/canvas/canvasCommands";
import type { DocumentHome } from "@/domain/types";
import { CanvasExportDialog } from "@/export/CanvasExportDialog";
import { AIConnectionsDialog } from "./AIConnectionsDialog";
import { McpAccessDialog } from "./McpAccessDialog";
import { AskAIButton, CanvasToolbar, useCanvasMenuItems } from "./CanvasToolbar";

interface TopHeaderProps {
  workspaceName: string;
  canvasTitle: string;
  sidebarOpen: boolean;
  onToggleSidebar: () => void;
  onRenameWorkspace: (name: string) => void;
  onRenameCanvas: (title: string) => void;
  /** Dev builds only: create a canvas pre-filled with every object type. */
  onCreateDemoCanvas?: () => void;
  /** The open workspace, for its MCP access settings. */
  workspaceId: string;
}

const iconButton =
  "inline-flex h-8 w-8 items-center justify-center rounded-md text-[var(--acute-text-muted)] " +
  "hover:bg-[var(--acute-surface-muted)] hover:text-[var(--acute-text)] cursor-pointer border-0 bg-transparent";

export const TopHeader = memo(function TopHeader({
  workspaceName,
  canvasTitle,
  sidebarOpen,
  onToggleSidebar,
  onRenameWorkspace,
  onRenameCanvas,
  onCreateDemoCanvas,
  workspaceId,
}: TopHeaderProps) {
  const [menu, setMenu] = useState<OpenMenu | null>(null);
  const [aiSettingsOpen, setAiSettingsOpen] = useState(false);
  const [mcpOpen, setMcpOpen] = useState(false);
  const aiMode = useAIMode();
  const aiFeature = isAIFeatureEnabled();
  const mcpFeature = isMcpUiEnabled();
  const [exportHome, setExportHome] = useState<DocumentHome | null>(null);
  const canvasMenu = useCanvasMenuItems({ onExportCanvas: () => setExportHome(getCanvasCommands()?.home() ?? null) });

  // "Open AI settings" links elsewhere (e.g. Ask AI with no connection).
  useEffect(() => {
    if (!aiFeature) return;
    const open = () => setAiSettingsOpen(true);
    window.addEventListener(OPEN_AI_SETTINGS_EVENT, open);
    return () => window.removeEventListener(OPEN_AI_SETTINGS_EVENT, open);
  }, [aiFeature]);

  return (
    <header
      className="flex shrink-0 items-center gap-2 border-b border-[var(--acute-border)] bg-[var(--acute-surface)] px-2"
      style={{ height: "var(--acute-header-h)" }}
    >
      <button
        type="button"
        className={iconButton}
        onClick={onToggleSidebar}
        aria-label={sidebarOpen ? "Hide workspaces" : "Show workspaces"}
        aria-expanded={sidebarOpen}
        title="Workspaces and canvases"
      >
        <PanelLeftIcon />
      </button>
      <span className="text-[15px] font-semibold tracking-tight">Acute-Notes</span>
      <nav aria-label="Breadcrumb" className="ml-2 flex min-w-0 items-center gap-0.5 text-sm text-[var(--acute-text-muted)]">
        <EditableName value={workspaceName} label="Workspace name" onRename={onRenameWorkspace} />
        <span aria-hidden="true">/</span>
        <EditableName value={canvasTitle} label="Canvas name" current onRename={onRenameCanvas} />
      </nav>
      <div className="ml-auto flex items-center gap-2">
        <AskAIButton />
        <CanvasToolbar />
        <MenuButton
          className={iconButton}
          label="More"
          open={menu !== null}
          onOpen={(el) =>
            setMenu({
              id: "app-menu",
              label: "More",
              anchor: el.getBoundingClientRect(),
              items: [
                ...(aiFeature ? [{ label: "AI settings", onSelect: () => setAiSettingsOpen(true) }] : []),
                ...(mcpFeature ? [{ label: "MCP access", onSelect: () => setMcpOpen(true) }] : []),
                ...(aiMode === "on"
                  ? [
                      { label: "AI conversations", onSelect: () => aiPanel.openHistory("all") },
                      { label: "Agent log", onSelect: () => aiPanel.openAgentHistory() },
                      { label: "Visualize content…", onSelect: () => visualizeDialog.open() },
                    ]
                  : []),
                ...(onCreateDemoCanvas
                  ? [{ label: "Create AI test canvas", hint: "Dev", separatorBefore: true, onSelect: onCreateDemoCanvas }]
                  : []),
                ...canvasMenu.items,
              ],
            })
          }
        />
      </div>
      {menu && <RowMenu menu={menu} onClose={() => setMenu(null)} />}
      {canvasMenu.errorDialog}
      {aiFeature && aiSettingsOpen && <AIConnectionsDialog onClose={() => setAiSettingsOpen(false)} />}
      {mcpFeature && mcpOpen && <McpAccessDialog workspaceId={workspaceId} workspaceName={workspaceName} onClose={() => setMcpOpen(false)} />}
      {exportHome && <CanvasExportDialog home={exportHome} canvasTitle={canvasTitle} onClose={() => setExportHome(null)} />}
    </header>
  );
});

/** A breadcrumb name that turns into an input on click (or F2 / Enter when focused). */
function EditableName({
  value,
  label,
  current = false,
  onRename,
}: {
  value: string;
  label: string;
  /** The last crumb (the open canvas). */
  current?: boolean;
  onRename: (value: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  if (editing) {
    return (
      <RenameInput
        value={value}
        label={label}
        className="acute-crumb__input"
        onDone={(next) => {
          setEditing(false);
          if (next !== null && next !== value) onRename(next);
        }}
      />
    );
  }
  return (
    <button
      type="button"
      className="acute-crumb"
      data-current={current || undefined}
      aria-current={current ? "page" : undefined}
      title={`${value} — click to rename`}
      disabled={!value}
      onClick={() => setEditing(true)}
      onKeyDown={(e) => {
        if (e.key === "F2") setEditing(true);
      }}
    >
      <span className="truncate">{value}</span>
    </button>
  );
}
