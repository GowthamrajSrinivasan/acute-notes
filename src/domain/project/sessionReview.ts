/**
 * A session's review (plan D47, vision spec workflow 3): **before** — the prior state of every element it touched,
 * from the change records' inverses; **during** — what it found and decided (the project-knowledge nodes it created)
 * and its own summary; **after** — what changed, the impact of those changes (`impactOf`), new risks, proposed
 * decisions still waiting for a choice, unvalidated findings, and what needs a human look. Pure: shared by the
 * `get_session_review` tool and the Agent log's "Session review" view.
 *
 * `needsReview` lists the architecture nodes the session created or changed. The plan's "that the user hasn't opened in
 * Lens" needs a per-node "seen" record that nothing keeps yet, so every touched node is listed (the basis is named).
 */
import type { AgentChangeRecord, AgentSessionRecord } from "@/ai/changes/agentState";
import { impactOf, type Impact } from "./impact";
import { resolve, type GraphNode, type WorkspaceGraph } from "./workspaceGraph";

export interface SessionReview {
  session?: { id: string; agent?: string; startedAt: number; lastWriteAt?: number; summary?: string; changed?: { path: string; what: string }[]; next?: string[] };
  changeIds: string[];
  before: { elementId: string; key?: string; op: string; prior: { type: string; label?: string; kind?: string; fields?: Record<string, unknown> } | null }[];
  during: { key: string; kind: string; label: string; status?: string }[];
  after: {
    changed: { elementId: string; key?: string; op: string; label?: string }[];
    impact: Impact;
    newRisks: { key: string; label: string; severity?: string }[];
    openDecisions: { key: string; label: string; options: string[] }[];
    unvalidatedFindings: { key: string; label: string; note?: string }[];
    needsReview: { ref: string; label: string }[];
    needsReviewBasis: "touched by the session";
  };
}

const KNOWLEDGE = new Set(["decision", "constraint", "finding", "open_question", "risk", "annotation", "milestone", "progress_item", "project"]);

/** A stored snapshot, summarised: its type, its text when it's a label, and its node fields. */
function summarize(snapshot: Record<string, unknown> | undefined): SessionReview["before"][number]["prior"] {
  if (!snapshot) return null;
  const node = snapshot.customData && typeof snapshot.customData === "object" ? ((snapshot.customData as Record<string, unknown>).acuteNode as Record<string, unknown> | undefined) : undefined;
  const text = typeof snapshot.originalText === "string" ? snapshot.originalText : typeof snapshot.text === "string" ? snapshot.text : undefined;
  return {
    type: String(snapshot.type),
    ...(text ? { label: text.slice(0, 200) } : {}),
    ...(typeof node?.kind === "string" ? { kind: node.kind } : {}),
    ...(node ? { fields: Object.fromEntries(Object.entries(node).filter(([k]) => k !== "key" && k !== "sources" && k !== "expandsTo")) } : {}),
  };
}

export function sessionReview(g: WorkspaceGraph, input: { records: readonly AgentChangeRecord[]; session?: AgentSessionRecord; changeIds?: readonly string[] }): SessionReview {
  const wanted = input.changeIds?.length ? new Set(input.changeIds) : null;
  const records = input.records
    .filter((r) => r.outcome === "accepted" && (wanted ? wanted.has(r.id) : !!input.session && r.session === input.session.id))
    .sort((a, b) => a.at - b.at);

  // Before: each touched element's state before the earliest change that touched it.
  const before: SessionReview["before"] = [];
  const seenBefore = new Set<string>();
  for (const r of records) {
    for (const t of r.touched) {
      if (seenBefore.has(t.elementId)) continue;
      seenBefore.add(t.elementId);
      const snap = r.inverse.find((i) => i.op === "restore" && i.element.id === t.elementId);
      before.push({ elementId: t.elementId, ...(t.key ? { key: t.key } : {}), op: t.op, prior: t.op === "create" ? null : summarize(snap?.op === "restore" ? snap.element : undefined) });
    }
  }

  // What the session's elements are now.
  const touchedNodes: GraphNode[] = [];
  const changed: SessionReview["after"]["changed"] = [];
  for (const b of before) {
    const now = resolve(g, b.elementId);
    if (now?.what === "node") touchedNodes.push(now);
    changed.push({ elementId: b.elementId, ...(b.key ? { key: b.key } : {}), op: b.op, ...(now?.what === "node" ? { label: now.label } : now?.what === "frame" ? { label: now.title } : {}) });
  }
  const created = new Set(before.filter((b) => b.op === "create").map((b) => b.elementId));
  const knowledge = touchedNodes.filter((n) => n.kind && KNOWLEDGE.has(n.kind));
  const architecture = touchedNodes.filter((n) => !n.kind || !KNOWLEDGE.has(n.kind));
  const during = knowledge.filter((n) => created.has(n.id)).map((n) => ({ key: n.ref, kind: n.kind!, label: n.label, ...(n.project?.status ? { status: n.project.status } : {}) }));

  return {
    ...(input.session
      ? {
          session: {
            id: input.session.id,
            ...(input.session.agent ? { agent: input.session.agent } : {}),
            startedAt: input.session.startedAt,
            ...(input.session.lastWriteAt ? { lastWriteAt: input.session.lastWriteAt } : {}),
            ...(input.session.summary ? { summary: input.session.summary } : {}),
            ...(input.session.changed?.length ? { changed: input.session.changed } : {}),
            ...(input.session.next?.length ? { next: input.session.next } : {}),
          },
        }
      : {}),
    changeIds: records.map((r) => r.id),
    before,
    during,
    after: {
      changed,
      impact: impactOf(g, architecture.map((n) => n.ref)),
      newRisks: knowledge.filter((n) => n.kind === "risk" && created.has(n.id)).map((n) => ({ key: n.ref, label: n.label, ...(n.project?.severity ? { severity: n.project.severity } : {}) })),
      openDecisions: knowledge
        .filter((n) => n.kind === "decision" && (n.project?.status ?? "proposed") === "proposed" && !n.project?.chosen)
        .map((n) => ({ key: n.ref, label: n.label, options: (n.project?.options ?? []).map((o) => o.label) })),
      unvalidatedFindings: knowledge.filter((n) => n.kind === "finding" && n.project?.stage !== "validated").map((n) => ({ key: n.ref, label: n.label, ...(n.project?.note ? { note: n.project.note } : {}) })),
      needsReview: architecture.map((n) => ({ ref: n.ref, label: n.label })),
      needsReviewBasis: "touched by the session",
    },
  };
}
