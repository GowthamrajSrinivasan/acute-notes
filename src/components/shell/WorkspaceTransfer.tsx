"use client";

import { useCallback, useEffect, useId, useState } from "react";
import { getCanvasCommands } from "@/components/canvas/canvasCommands";
import { CloseIcon, DownloadIcon, UploadIcon } from "@/components/common/icons";
import { getPersistence } from "@/persistence";
import { BundleError } from "@/portability/bundleError";
import { downloadText } from "@/portability/download";
import type { ImportSummary } from "@/portability/workspaceBundle";
import { getDocumentStore } from "@/state/documents";
import { documentRegistry } from "@/sync/documentRegistry";
import { useActionRunner } from "./useActionRunner";

interface WorkspaceTransferProps {
  /** The open workspace (what export saves, and what an import may replace). */
  workspaceId: string;
  workspaceName: string;
  /** Imports a validated bundle: a workspace export replaces its workspace (the shell closes the canvas first); a canvas export is added to the open workspace. */
  onImport: (input: unknown, summary: ImportSummary) => Promise<void>;
  buttonClassName: string;
}

/**
 * Workspace export / import (F17) as two icon buttons for the navigator
 * header. Export asks whether to include the sources (§6.4; default on, with
 * their size) and downloads the open workspace as `.acute.json`; import
 * validates a file (a workspace or a single-canvas export), asks for
 * confirmation, then hands it to the shell.
 */
export function WorkspaceTransfer({ workspaceId, workspaceName, onImport, buttonClassName }: WorkspaceTransferProps) {
  const fileInputId = useId();
  const { run, busy, errorDialog } = useActionRunner();
  const [pending, setPending] = useState<{ input: unknown; summary: ImportSummary } | null>(null);
  const [exporting, setExporting] = useState(false);
  const measureSources = useCallback(() => workspaceSourcesSize(workspaceId), [workspaceId]);

  const exportWorkspaceFile = (sources: boolean) =>
    run(async () => {
      // Write every open editor's pending changes so the file has current state.
      await getCanvasCommands()?.flush();
      await getDocumentStore().flush();
      await documentRegistry.flushAll();
      const { exportWorkspace, bundleFileName } = await import("@/portability/workspaceBundle");
      const bundle = await exportWorkspace(getPersistence(), workspaceId, { sources });
      downloadText(bundleFileName(bundle), JSON.stringify(bundle, null, 2), "application/json");
    }, "Couldn't export the workspace");

  const readImportFile = (file: File) =>
    run(async () => {
      let input: unknown;
      try {
        input = JSON.parse(await file.text());
      } catch {
        throw new BundleError("This file isn't valid JSON.");
      }
      const { inspectBundle } = await import("@/portability/workspaceBundle");
      setPending({ input, summary: inspectBundle(input).summary });
    }, "Couldn't import the file");

  return (
    <>
      <button
        type="button"
        className={buttonClassName}
        aria-label={`Export workspace ${workspaceName}`}
        title={`Export workspace — download “${workspaceName}” as a .acute.json file`}
        aria-busy={busy || undefined}
        onClick={() => setExporting(true)}
      >
        <DownloadIcon size={16} />
      </button>
      <button
        type="button"
        className={buttonClassName}
        aria-label="Import workspace"
        title="Import — upload a workspace or canvas .acute.json file"
        onClick={() => document.getElementById(fileInputId)?.click()}
      >
        <UploadIcon size={16} />
      </button>
      <input
        id={fileInputId}
        type="file"
        accept=".json,.acute.json,application/json"
        hidden
        onChange={(e) => {
          const file = e.target.files?.[0];
          e.target.value = "";
          if (file) readImportFile(file);
        }}
      />
      {exporting && (
        <WorkspaceExportDialog
          workspaceName={workspaceName}
          measureSources={measureSources}
          onClose={() => setExporting(false)}
          onExport={(sources) => {
            setExporting(false);
            exportWorkspaceFile(sources);
          }}
        />
      )}
      {pending && (
        <ConfirmImport
          summary={pending.summary}
          replacesCurrent={pending.summary.scope === "workspace" && pending.summary.workspaceId === workspaceId}
          currentName={workspaceName}
          onCancel={() => setPending(null)}
          onConfirm={() => {
            const { input, summary } = pending;
            setPending(null);
            run(() => onImport(input, summary), summary.scope === "canvas" ? "Couldn't import the canvas" : "Couldn't import the workspace");
          }}
        />
      )}
      {errorDialog}
    </>
  );
}

/** Shown when the backup won't carry its sources (§6.4), as in the canvas export dialog. Advice, not a blocker. */
export const NO_SOURCES_WARNING = "This file won't include the original sources. Citations in it can't be checked.";

const SOURCES_HINT = "The original text each note was made from, every version, so its citations can be checked.";

/** "12 KB", "1.4 MB" (as the canvas export dialog). */
function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** The "Include sources" hint: what it adds and its size, once known. */
export function workspaceSourcesHint(size: { count: number; bytes: number } | null): string {
  if (!size) return SOURCES_HINT;
  if (!size.count) return `${SOURCES_HINT} This workspace has no sources on this device.`;
  return `${SOURCES_HINT} ${size.count} source${size.count === 1 ? "" : "s"}, ${formatSize(size.bytes)}.`;
}

/**
 * The workspace's sources and their size, summed over its canvases (`canvasSourcesSize` per canvas). A source cited
 * from two canvases counts twice here though the file carries it once, so the size is an upper bound.
 */
async function workspaceSourcesSize(workspaceId: string): Promise<{ count: number; bytes: number }> {
  const services = getPersistence();
  const workspace = await services.workspaces.get(workspaceId);
  if (!workspace) return { count: 0, bytes: 0 };
  const { canvasSourcesSize } = await import("@/portability/workspaceBundle");
  const sizes = await Promise.all(
    workspace.canvasIds.map((id) => canvasSourcesSize(services, workspaceId, id).catch(() => ({ count: 0, bytes: 0 }))),
  );
  return sizes.reduce((sum, s) => ({ count: sum.count + s.count, bytes: sum.bytes + s.bytes }), { count: 0, bytes: 0 });
}

/**
 * Export workspace: one option, "Include sources" (default on, with the sources' size), and the warning when it's
 * off. Styled like the canvas export dialog (`export/CanvasExportDialog.tsx`).
 */
export function WorkspaceExportDialog({
  workspaceName,
  measureSources,
  onExport,
  onClose,
}: {
  workspaceName: string;
  /** The sources' count and size for the hint; a failure leaves the plain hint. Keep it stable (it reruns on change). */
  measureSources: () => Promise<{ count: number; bytes: number }>;
  onExport: (sources: boolean) => void;
  onClose: () => void;
}) {
  const [sources, setSources] = useState(true);
  const [size, setSize] = useState<{ count: number; bytes: number } | null>(null);

  useEffect(() => {
    let live = true;
    measureSources()
      .then((s) => live && setSize(s))
      .catch((err: unknown) => console.warn("[acute-notes] couldn't measure the workspace's sources", err));
    return () => {
      live = false;
    };
  }, [measureSources]);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.preventDefault();
      onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  return (
    <div className="acute-dialog__backdrop" onPointerDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="acute-dialog acute-ai-settings acute-export-canvas" role="dialog" aria-modal="true" aria-labelledby="acute-export-workspace-title">
        <header className="acute-ai-settings__header">
          <div>
            <h2 id="acute-export-workspace-title" className="acute-ai-settings__title">
              Export workspace
            </h2>
            <p className="acute-ai-settings__subtitle">
              Download <strong>{workspaceName}</strong> with its canvases, pages and blocks, as a backup file.
            </p>
          </div>
          <button type="button" className="acute-ai-settings__close" aria-label="Close" autoFocus onClick={onClose}>
            <CloseIcon size={16} />
          </button>
        </header>

        <div className="acute-ai-settings__body">
          <div className="acute-export-canvas__options">
            <label className="acute-export-canvas__option">
              <input type="checkbox" checked={sources} onChange={(e) => setSources(e.target.checked)} />
              <span>
                <span className="acute-ai-settings__footer-title">Include sources</span>
                <span className="acute-ai-settings__footer-hint">{workspaceSourcesHint(size)}</span>
              </span>
            </label>
          </div>

          {!sources && (
            <p className="acute-ai-settings__footer-hint" role="status">
              {NO_SOURCES_WARNING}
            </p>
          )}

          <div className="acute-ai-connect__actions">
            <button type="button" className="acute-pill acute-pill--ghost" onClick={onClose}>
              Cancel
            </button>
            <button type="button" className="acute-pill acute-pill--primary" onClick={() => onExport(sources)}>
              Export
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function ConfirmImport({
  summary,
  replacesCurrent,
  currentName,
  onCancel,
  onConfirm,
}: {
  summary: ImportSummary;
  replacesCurrent: boolean;
  currentName: string;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const counts = [
    `${summary.canvases} canvas${summary.canvases === 1 ? "" : "es"}`,
    `${summary.pages} page${summary.pages === 1 ? "" : "s"}`,
    `${summary.blocks} block${summary.blocks === 1 ? "" : "s"}`,
    `${summary.assets} image${summary.assets === 1 ? "" : "s"}`,
  ].join(" · ");
  const canvas = summary.scope === "canvas";
  return (
    <div className="acute-dialog__backdrop" onPointerDown={(e) => e.target === e.currentTarget && onCancel()}>
      <div className="acute-dialog" role="alertdialog" aria-labelledby="acute-import-title" aria-describedby="acute-import-desc">
        <h2 id="acute-import-title">{canvas ? `Import canvas “${summary.canvasTitle}”?` : `Import “${summary.workspaceName}”?`}</h2>
        <p id="acute-import-desc" className="acute-dialog__text">
          {counts}
          <br />
          <br />
          {canvas
            ? `It's added to “${currentName}” as a new canvas. Nothing already here is changed.`
            : replacesCurrent
            ? `This replaces everything in “${currentName}” on this device. Export it first if you want a copy.`
            : "It opens as its own workspace. A workspace with the same id on this device is replaced."}
        </p>
        <div className="acute-dialog__actions">
          <button type="button" onClick={onCancel}>
            Cancel
          </button>
          <button type="button" data-primary autoFocus onClick={onConfirm}>
            {canvas ? "Import canvas" : replacesCurrent ? "Replace workspace" : "Import"}
          </button>
        </div>
      </div>
    </div>
  );
}
