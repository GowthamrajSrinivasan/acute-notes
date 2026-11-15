"use client";

/**
 * The search index's health on this canvas, when it isn't fresh (intelligent-update-engine-plan Stage 4b, refinement A):
 * "out of date — updating", "rebuilding", or "couldn't be rebuilt" with Retry. Hidden while the index is fresh, and when no
 * live index runs (AI mode off: the on-demand indexes sync from the canvas before every read).
 */
import type { DocumentHome } from "@/domain/types";
import { retryIndex, useIndexState } from "@/search/liveIndex";

export function IndexStatusBadge({ home }: { home: DocumentHome }) {
  const s = useIndexState(home.workspaceId, home.canvasId);
  if (s.state === "fresh") return null;
  const text =
    s.state === "failed"
      ? "Search index couldn't be rebuilt — search, Ask AI context and placement may miss recent changes."
      : s.state === "rebuilding"
        ? "Rebuilding the search index…"
        : "Search index out of date — updating…";
  return (
    <div className="acute-index-status" role="status" aria-label="Search index status" data-state={s.state} title={s.reason}>
      <span>{text}</span>
      {s.state === "failed" && (
        <button type="button" className="acute-ask-ai__secondary" onClick={() => retryIndex(home.workspaceId, home.canvasId)}>
          Retry
        </button>
      )}
    </div>
  );
}
