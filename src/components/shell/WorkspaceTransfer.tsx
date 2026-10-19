"use client";

import { useId, useState } from "react";
import { getCanvasCommands } from "@/components/canvas/canvasCommands";
import { DownloadIcon, UploadIcon } from "@/components/common/icons";
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
 * header. Export downloads the open workspace as `.acute.json`; import
 * validates a file (a workspace or a single-canvas export), asks for
 * confirmation, then hands it to the shell.
 */
export function WorkspaceTransfer({ workspaceId, workspaceName, onImport, buttonClassName }: WorkspaceTransferProps) {
  const fileInputId = useId();
  const { run, busy, errorDialog } = useActionRunner();
  const [pending, setPending] = useState<{ input: unknown; summary: ImportSummary } | null>(null);

  const exportWorkspaceFile = () =>
    run(async () => {
      // Write every open editor's pending changes so the file has current state.
      await getCanvasCommands()?.flush();
      await getDocumentStore().flush();
      await documentRegistry.flushAll();
      const { exportWorkspace, bundleFileName } = await import("@/portability/workspaceBundle");
      const bundle = await exportWorkspace(getPersistence(), workspaceId);
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
        onClick={exportWorkspaceFile}
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
