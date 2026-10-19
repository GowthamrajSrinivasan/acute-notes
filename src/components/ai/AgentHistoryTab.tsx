"use client";

/**
 * The agent log (plan §3.7, D30–D32, D46, D61): every change set accepted, rejected or left to expire on this
 * workspace, grouped by session — the MCP client as it reported itself, when, why, what it touched — with "Show on
 * canvas" and "Revert…", which stages the revert as an ordinary change set for review (never written directly).
 *
 * Kept visually apart from the review bar (pending proposals): this is what already happened.
 */
import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";
import { useEffect, useMemo, useState } from "react";
import type { AgentChangeRecord, AgentSessionRecord } from "@/ai/changes/agentState";
import { getCanvasCommands } from "@/components/canvas/canvasCommands";
import type { SceneElement } from "@/domain/canvas/adapter";
import type { DocumentHome } from "@/domain/types";
import { stageRevert, useAgentLog } from "@/state/agentLog";
import { loadOtherCanvases } from "@/components/lens/workspaceScenes";
import { sessionReview, type SessionReview } from "@/domain/project/sessionReview";
import { buildWorkspaceGraph } from "@/domain/project/workspaceGraph";

const OUTCOME_LABELS: Record<AgentChangeRecord["outcome"], string> = { accepted: "Accepted", rejected: "Rejected", expired: "Expired" };

function when(at: number): string {
  return new Date(at).toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

/** "Codex (as reported by the client)": attribution is the client's own claim, never verified (D61). */
function agentLabel(agent: string | undefined): string {
  return agent ? `${agent} (as reported by the client)` : "In-app";
}

interface Group {
  key: string;
  title: string;
  session?: AgentSessionRecord;
  records: AgentChangeRecord[];
}

function groupBySession(changes: readonly AgentChangeRecord[], sessions: readonly AgentSessionRecord[]): Group[] {
  const byId = new Map(sessions.map((s) => [s.id, s] as const));
  const groups = new Map<string, Group>();
  for (const r of changes) {
    const session = r.session && r.session !== "app" ? r.session : undefined;
    const key = session ?? "app";
    let g = groups.get(key);
    if (!g) {
      const rec = session ? byId.get(session) : undefined;
      g = { key, title: session ? `Session · ${agentLabel(r.agent ?? rec?.agent)}` : "In-app AI and your own reverts", ...(rec ? { session: rec } : {}), records: [] };
      groups.set(key, g);
    }
    g.records.push(r);
  }
  return [...groups.values()];
}

/**
 * A session's review (D47): before / during / after, from the same pure `sessionReview` the MCP tool returns, over
 * every canvas (this one live, the others as persisted).
 */
function SessionReviewView({ api, home, session, records }: { api: ExcalidrawImperativeAPI; home: DocumentHome; session: AgentSessionRecord; records: readonly AgentChangeRecord[] }) {
  const [review, setReview] = useState<SessionReview | null>(null);
  useEffect(() => {
    let live = true;
    void loadOtherCanvases(home.workspaceId, home.canvasId).then((others) => {
      if (!live) return;
      const g = buildWorkspaceGraph([{ canvasId: home.canvasId, elements: api.getSceneElements() as unknown as readonly SceneElement[] }, ...others]);
      setReview(sessionReview(g, { records, session }));
    });
    return () => {
      live = false;
    };
  }, [api, home, session, records]);
  if (!review) return null;
  const a = review.after;
  const list = (title: string, items: string[]) =>
    items.length ? (
      <p className="acute-agent-history__reason">
        <b>{title}:</b> {items.slice(0, 8).join(" · ")}
        {items.length > 8 ? ` · +${items.length - 8}` : ""}
      </p>
    ) : null;
  return (
    <div className="acute-agent-history__review" role="region" aria-label="Session review">
      {review.session?.summary && <p className="acute-agent-history__reason">Summary: {review.session.summary}</p>}
      <p className="acute-agent-history__meta">
        Before: {review.before.filter((b) => b.op !== "create").length} changed or removed objects had a prior state · During: {review.during.length} recorded · After: {a.changed.length} touched,{" "}
        {a.impact.affected.length} affected
      </p>
      {list("Recorded", review.during.map((d) => `${d.kind.replace(/_/g, " ")}: ${d.label}`))}
      {list("New risks", a.newRisks.map((r) => r.label))}
      {list("Decisions waiting for a choice", a.openDecisions.map((d) => d.label))}
      {list("Unvalidated findings", a.unvalidatedFindings.map((f) => f.label))}
      {list("Affected", a.impact.affected.map((x) => x.label))}
      {list("Needs review (touched by the session)", a.needsReview.map((n) => n.label))}
      {review.session?.next?.length ? list("Next", review.session.next) : null}
    </div>
  );
}

export function AgentHistoryTab({ api, home }: { api: ExcalidrawImperativeAPI; home: DocumentHome }) {
  const log = useAgentLog(home.workspaceId);
  const [busy, setBusy] = useState<string | null>(null);
  const [reviewing, setReviewing] = useState<string | null>(null);
  const groups = useMemo(() => groupBySession(log.changes, log.sessions), [log.changes, log.sessions]);

  const showOnCanvas = (r: AgentChangeRecord) => {
    const live = new Set(api.getSceneElements().map((e) => e.id));
    const target = r.touched.find((t) => t.op !== "remove" && live.has(t.elementId)) ?? r.touched.find((t) => live.has(t.elementId));
    if (!target || !getCanvasCommands()?.revealNode(target.elementId)) api.setToast({ message: "What it changed is no longer on this canvas.", duration: 3000 });
  };

  const revert = (r: AgentChangeRecord) => {
    setBusy(r.id);
    void stageRevert(home, [r.id], api.getSceneElementsIncludingDeleted() as unknown as readonly SceneElement[])
      .then((outcome) => api.setToast({ message: outcome.ok ? "The revert is up for review: accept it to restore the canvas." : outcome.reason, duration: 5000 }))
      .finally(() => setBusy(null));
  };

  return (
    <div className="acute-ai-panel__body acute-agent-history" role="tabpanel" aria-label="Agent log">
      {log.loading ? null : !groups.length ? (
        <p className="acute-agent-history__empty">No agent or AI changes yet. Once a change set is accepted, rejected or replaced, it is listed here.</p>
      ) : (
        groups.map((g) => (
          <section key={g.key} className="acute-agent-history__group" aria-label={g.title}>
            <h3 className="acute-agent-history__group-title">
              {g.title}
              {g.session && <span className="acute-agent-history__meta"> · started {when(g.session.startedAt)}</span>}
              {g.session && (
                <button type="button" className="acute-ask-ai__secondary acute-agent-history__review-toggle" aria-expanded={reviewing === g.key} onClick={() => setReviewing((k) => (k === g.key ? null : g.key))}>
                  Session review
                </button>
              )}
            </h3>
            {g.session && reviewing === g.key && <SessionReviewView api={api} home={home} session={g.session} records={g.records} />}
            <ul className="acute-agent-history__list">
              {g.records.map((r) => {
                const here = r.canvasId === home.canvasId;
                const canRevert = here && r.outcome === "accepted" && r.revertible && !r.revertedBy;
                return (
                  <li key={r.id} className="acute-agent-history__row" data-outcome={r.outcome} aria-label={`Change: ${r.title}`}>
                    <div className="acute-agent-history__head">
                      <span className="acute-agent-history__title">{r.title}</span>
                      <span className="acute-agent-history__badge">{r.revertedBy ? "Reverted" : OUTCOME_LABELS[r.outcome]}</span>
                    </div>
                    <div className="acute-agent-history__meta">
                      {when(r.at)} · {r.tool} · {agentLabel(r.agent)}
                      {r.touched.length > 0 && ` · ${r.touched.length} ${r.touched.length === 1 ? "object" : "objects"}`}
                      {!here && " · on another canvas"}
                    </div>
                    {r.reason && <p className="acute-agent-history__reason">Reason: {r.reason}</p>}
                    {r.rejectReason && <p className="acute-agent-history__reason">Rejected because: {r.rejectReason}</p>}
                    {r.outcome === "accepted" && (
                      <div className="acute-agent-history__actions">
                        {here && r.touched.length > 0 && (
                          <button type="button" className="acute-ask-ai__secondary" onClick={() => showOnCanvas(r)}>
                            Show on canvas
                          </button>
                        )}
                        {canRevert && (
                          <button type="button" className="acute-ask-ai__secondary" disabled={busy === r.id} onClick={() => revert(r)}>
                            Revert…
                          </button>
                        )}
                        {!r.revertible && !r.revertedBy && <span className="acute-agent-history__meta">Not revertible (its before-state is no longer kept)</span>}
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          </section>
        ))
      )}
    </div>
  );
}
