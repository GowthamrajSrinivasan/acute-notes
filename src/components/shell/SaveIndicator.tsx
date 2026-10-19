"use client";

import { useSyncExternalStore, type ReactNode } from "react";
import { saveStatusStore, type SaveStatus } from "@/sync/saveStatus";

const LABELS: Record<SaveStatus, string> = {
  idle: "",
  saving: "Saving…",
  saved: "Saved locally",
  error: "Couldn't save — retrying",
};

/**
 * Subtle local-save status; re-renders only itself when status changes.
 * Renders nothing while idle; `before` (e.g. a toolbar divider) shows only
 * together with the status.
 */
export function SaveIndicator({ before, className = "" }: { before?: ReactNode; className?: string }) {
  const status = useSyncExternalStore(saveStatusStore.subscribe, saveStatusStore.get, () => "idle" as const);
  if (status === "idle") return null;
  return (
    <>
      {before}
      <span
        role="status"
        aria-live="polite"
        className={`text-xs ${status === "error" ? "text-red-600" : "text-[var(--acute-text-muted)]"} ${className}`}
      >
        {LABELS[status]}
      </span>
    </>
  );
}
