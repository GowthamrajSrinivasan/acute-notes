"use client";

/**
 * Agent Sync in Lens (plan §8.2, Phase 4): the header's **● Agent Sync** chip with Pause, and the collapsible
 * **Changes (3Δ) · Impact** drawer. The drawer lists what waits for review on this canvas, with Accept / Reject through
 * the review bar's own actions (`reviewActions.ts`), and the agent changes accepted this session; Impact runs
 * `impactOf` over what changed here, walked up the levels — reach along drawn links, not blast radius (Wave 1b item
 * 5). It stays apart from the Agent log tab, which is the persisted history (§3.7).
 */
import { useEffect, useMemo, useState } from "react";
import type { ChangeSet } from "@/ai/changes/changeSet";
import { getPendingChanges } from "@/ai/changes/pendingChanges";
import { getReviewActions } from "@/components/ai/reviewActions";
import { graphNodeAt } from "@/domain/lens/locate";
import type { LensLevelView } from "@/domain/lens/lensView";
import type { LensPendingView } from "@/domain/lens/pending";
import { impactOf } from "@/domain/project/impact";
import { warningsFor } from "@/domain/project/knowledge";
import type { DocumentHome } from "@/domain/types";
import { useAgentLog } from "@/state/agentLog";
import { agentSync, useAgentSync } from "@/state/agentSync";
import { EntryList } from "./LensOverlays";
import type { LensWorkspace } from "./lensWorkspace";

/** When this tab started: "recent changes" in the drawer are this session's (plan §8.2). */
const SESSION_START = Date.now();

export function ago(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 5) return "just now";
  if (s < 60) return `${s} s ago`;
  const m = Math.round(s / 60);
  return m < 60 ? `${m} min ago` : `${Math.round(m / 60)} h ago`;
}

/** Re-renders every few seconds while `on`, for "updated 12 s ago". */
function useNow(on: boolean, everyMs = 5_000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!on) return;
    const t = setInterval(() => setNow(Date.now()), everyMs);
    return () => clearInterval(t);
  }, [on, everyMs]);
  return now;
}

/** `● Agent Sync · updated 12 s ago` / `○ Agent Sync off`, and Pause (D15: the word is never "Live"). */
export function AgentSyncChip({ canvasId }: { canvasId: string }) {
  useAgentSync();
  const last = agentSync.lastWriteAt(canvasId);
  const paused = agentSync.isPaused(canvasId);
  const held = agentSync.heldWrites(canvasId);
  const now = useNow(last !== undefined);
  const on = agentSync.isOn(canvasId, now);
  return (
    <div className="acute-lens-sync" role="group" aria-label="Agent Sync">
      <span
        className="acute-lens-sync__status"
        data-on={on || undefined}
        title={on ? "Your IDE agent is keeping this architecture current" : "No IDE agent has written to this canvas in the last 10 minutes"}
      >
        {on ? `● Agent Sync · updated ${ago(now - last!)}` : "○ Agent Sync off"}
      </span>
      <button
        type="button"
        className="acute-lens-sync__pause"
        aria-pressed={paused}
        title={paused ? "Show what arrived while paused" : "Hold this view still while your agent works; the review bar and Accept keep working"}
        onClick={() => (paused ? agentSync.resume(canvasId) : agentSync.pause(canvasId))}
      >
        {paused ? `Resume${held ? ` · ${held}Δ` : ""}` : "Pause"}
      </button>
    </div>
  );
}

function useWaitingSets(canvasId: string): ChangeSet[] {
  const pending = getPendingChanges();
  const [, setTick] = useState(0);
  useEffect(() => pending.subscribe(() => setTick((t) => t + 1)), [pending]);
  return pending.list(canvasId);
}

export type DrawerTab = "changes" | "impact";

export function ChangesDrawer({
  home,
  view,
  pending,
  stale,
  open,
  tab,
  onToggle,
  onTab,
  workspace,
  onGo,
}: {
  home: DocumentHome;
  view: LensLevelView | undefined;
  /** The current level's ghosts (frozen while paused, like the view). */
  pending: LensPendingView | undefined;
  /** Stale element ids on this canvas. */
  stale: ReadonlySet<string>;
  open: boolean;
  tab: DrawerTab;
  onToggle: () => void;
  onTab: (tab: DrawerTab) => void;
  /** The workspace graph, built while Impact is shown. */
  workspace: LensWorkspace | undefined;
  onGo: (canvasId: string, ref: string) => void;
}) {
  const sets = useWaitingSets(home.canvasId);
  const log = useAgentLog(home.workspaceId);
  const recent = useMemo(() => log.changes.filter((r) => r.canvasId === home.canvasId && r.at >= SESSION_START && r.agent !== undefined).slice(0, 8), [log.changes, home.canvasId]);
  const [reason, setReason] = useState<Record<string, string>>({});
  const count = (pending?.count ?? 0) + (view && !view.source ? view.nodes.filter((n) => stale.has(n.id)).length : 0);
  const now = useNow(open, 15_000);

  // What changed on this level: pending changes and removals, stale nodes, and what this session's agent changes touched.
  const changedKeys = useMemo(() => {
    if (!view || view.source) return [];
    const keys = new Set<string>([...(pending?.changed.keys() ?? []), ...(pending?.removed ?? [])]);
    for (const n of view.nodes) if (stale.has(n.id)) keys.add(n.key);
    const here = new Set(view.nodes.map((n) => n.key));
    for (const r of recent) if (r.outcome === "accepted") for (const t of r.touched) if (t.key && here.has(t.key)) keys.add(t.key);
    return [...keys];
  }, [view, pending, stale, recent]);
  const impact = useMemo(() => {
    if (!open || tab !== "impact" || !workspace || !view || !changedKeys.length) return undefined;
    const refs = changedKeys.flatMap((k) => graphNodeAt(workspace.g, view.frame.canvasId, k)?.ref ?? []);
    const result = impactOf(workspace.g, refs);
    return { result, warnings: warningsFor(workspace.g, [...result.modified, ...result.affected].map((e) => e.ref)) };
  }, [open, tab, workspace, view, changedKeys]);

  return (
    <section className="acute-lens-drawer" data-open={open || undefined} aria-label="Agent Sync drawer">
      <div className="acute-lens-drawer__bar" role="tablist" aria-label="Agent Sync drawer tabs">
        <button type="button" role="tab" aria-selected={open && tab === "changes"} onClick={() => (open && tab === "changes" ? onToggle() : (onTab("changes"), !open && onToggle()))}>
          Changes{count ? ` (${count}Δ)` : ""}
        </button>
        <span aria-hidden="true">·</span>
        <button type="button" role="tab" aria-selected={open && tab === "impact"} onClick={() => (open && tab === "impact" ? onToggle() : (onTab("impact"), !open && onToggle()))}>
          Impact
        </button>
      </div>
      {open && tab === "changes" && (
        <div className="acute-lens-drawer__body" role="tabpanel" aria-label="Changes">
          {sets.length ? (
            <ul className="acute-lens-drawer__list" aria-label="Waiting for review">
              {sets.map((s) => {
                const here = pending?.sets.find((p) => p.operationId === s.operationId)?.count ?? 0;
                const actions = getReviewActions(home.canvasId);
                return (
                  <li key={s.operationId} aria-label={`Pending: ${s.title}`}>
                    <div>
                      <strong>{s.title}</strong>
                      <span className="acute-lens-overlay__muted">
                        {" "}
                        · {here ? `${here} on this level` : "elsewhere on this canvas"}
                        {s.agent ? ` · ${s.agent} (as reported)` : ""}
                      </span>
                    </div>
                    {s.conflicts?.length ? (
                      <p className="acute-lens-overlay__muted">Has changes that need your input: decide them in the review bar.</p>
                    ) : (
                      <div className="acute-lens-drawer__actions">
                        <button type="button" disabled={!actions} onClick={() => actions?.accept(s.operationId)}>
                          Accept
                        </button>
                        <input
                          aria-label={`Reason for rejecting ${s.title} (optional)`}
                          placeholder="Reason (optional)"
                          value={reason[s.operationId] ?? ""}
                          onChange={(e) => setReason((r) => ({ ...r, [s.operationId]: e.target.value }))}
                        />
                        <button type="button" disabled={!actions} onClick={() => actions?.reject(s.operationId, reason[s.operationId])}>
                          Reject
                        </button>
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          ) : (
            <p className="acute-lens-overlay__muted">Nothing is waiting for review on this canvas.</p>
          )}
          {recent.length > 0 && (
            <>
              <div className="acute-lens-overlay__group">This session</div>
              <ul className="acute-lens-drawer__list" aria-label="Recent agent changes">
                {recent.map((r) => (
                  <li key={r.id}>
                    {r.title}
                    <span className="acute-lens-overlay__muted">
                      {" "}
                      · {r.outcome} · {ago(now - r.at)}
                    </span>
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>
      )}
      {open && tab === "impact" && (
        <div className="acute-lens-drawer__body" role="tabpanel" aria-label="Impact">
          <p className="acute-lens-overlay__muted">Reach along drawn links from what changed on this level, up through the levels above — not a blast radius.</p>
          {!changedKeys.length ? (
            <p className="acute-lens-overlay__muted">Nothing changed on this level.</p>
          ) : !impact ? (
            <p className="acute-lens-overlay__muted">Working it out…</p>
          ) : (
            <>
              {impact.warnings.map((w) => (
                <p key={w.key} className="acute-lens-overlay__warning" role="note">
                  ⚠ {w.statement}
                  {w.reason ? ` — ${w.reason}` : ""}
                </p>
              ))}
              <EntryList title="Changed" entries={impact.result.modified} onGo={onGo} />
              <EntryList title="Affected" entries={impact.result.affected} onGo={onGo} />
              <EntryList title="Related" entries={impact.result.related} onGo={onGo} />
              {!impact.result.affected.length && !impact.result.related.length && <p className="acute-lens-overlay__muted">Nothing drawn depends on what changed.</p>}
            </>
          )}
        </div>
      )}
    </section>
  );
}
