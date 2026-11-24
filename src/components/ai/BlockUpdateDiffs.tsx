"use client";

/**
 * A before/after diff for every clean `update_block` under review (user decision 2, 2026-11-15: whole-block
 * proposals "Require a clear before/after diff"). An `update_block` replaces a block's whole content, so each one is
 * listed in the review bar, visible without opening "Review", with a "View changes" toggle (collapsed by default)
 * showing the same line diff as a conflict card's "View diff". Display only: Accept, Reject and the conflict decisions
 * are unchanged, and conflicts keep their own cards (`ConflictCard`).
 *
 * A change that sets or removes a card's layout (note-taking modes: MCP layout tools, "Ask AI to change", Visualize flow
 * cards) says so, with a "Preview layout" toggle drawing it beside the layout now (`LayoutPreview`, lazy: OpenUI loads only
 * when one is opened); a new card created with a layout is listed for its preview too.
 */
import { lazy, Suspense, useState } from "react";
import { inlineText } from "@/domain/content/richContent";
import type { ConflictItem, ProposedChange } from "@/ai/changes/changeSet";
import { conflictName, proposedText } from "@/ai/reconcile/conflicts";
import { lineDiff } from "@/ai/reconcile/diff";

type UpdateBlock = Extract<ProposedChange, { kind: "update_block" }>;
type CreateBlock = Extract<ProposedChange, { kind: "create_block" }>;

const LayoutPreview = lazy(() => import("@/components/openui/canvas/LayoutPreview"));

/** A layout an update sets or removes: the card's layout now, and as proposed (null: removed). */
export interface LayoutChange {
  current: string | null;
  proposed: string | null;
}

export interface BlockUpdateDiff {
  target: string;
  name: string;
  /** The block's content now, in the conflict cards' canonical form; null when it isn't loaded. */
  before: string | null;
  after: string;
  /** Set when the update sets or removes the card's layout. */
  layout?: LayoutChange;
}

/** A card the set creates with a layout, for its preview. */
export interface NewLayoutCard {
  key: string;
  name: string;
  lang: string;
}

/** The clean `update_block`s among `changes`, each with its text now and as proposed. */
export function blockUpdateDiffs(changes: readonly ProposedChange[], currentOf: (target: string) => string | null, layoutOf?: (target: string) => string | null): BlockUpdateDiff[] {
  return changes
    .filter((c): c is UpdateBlock => c.kind === "update_block")
    .map((c) => {
      const item: ConflictItem = { target: c.target, apply: c };
      const layout = c.layout === undefined ? undefined : { current: layoutOf?.(c.target) ?? null, proposed: c.layout ? c.layout.lang : null };
      return { target: c.target, name: conflictName(item), before: currentOf(c.target), after: proposedText(item), ...(layout ? { layout } : {}) };
    });
}

/** The new text cards among `changes` that come with a layout, named by their first line. */
export function newLayoutCards(changes: readonly ProposedChange[]): NewLayoutCard[] {
  return changes
    .filter((c): c is CreateBlock & { layout: { lang: string } } => c.kind === "create_block" && c.blockType === "text" && !!c.layout)
    .map((c) => {
      const first = c.content.map((b) => inlineText(b.content).trim()).find(Boolean) ?? "New card";
      return { key: c.key, name: first.length > 60 ? `${first.slice(0, 59)}…` : first, lang: c.layout.lang };
    });
}

const layoutNote = (l: LayoutChange) => (l.proposed === null ? "removes its layout" : l.current ? "changes its layout" : "adds a layout");

export function BlockUpdateDiffs({ diffs, created = [], onShow }: { diffs: readonly BlockUpdateDiff[]; created?: readonly NewLayoutCard[]; onShow?: (target: string) => void }) {
  const [open, setOpen] = useState<ReadonlySet<string>>(new Set());
  if (!diffs.length && !created.length) return null;
  const toggle = (key: string) =>
    setOpen((s) => {
      const next = new Set(s);
      if (!next.delete(key)) next.add(key);
      return next;
    });
  return (
    <ul className="acute-review__conflicts" aria-label="Block updates to check">
      {diffs.map((d, i) => {
        const key = `${d.target}#${i}`;
        const shown = open.has(key);
        const previewKey = `${key}#layout`;
        const previewing = open.has(previewKey);
        const lines = lineDiff(d.before ?? "", d.after);
        const added = lines.filter((l) => l.op === "add").length;
        const removed = lines.filter((l) => l.op === "del").length;
        return (
          <li key={key} className="acute-review__conflict" data-decision="update" aria-label={`Update: ${d.name}`}>
            <div className="acute-review__conflict-head">
              <button type="button" className="acute-review__conflict-name" onClick={() => onShow?.(d.target)}>
                ~ {d.name}
              </button>
              <span className="acute-review__note">
                Replaces this block&apos;s content: {added || removed ? `+${added} −${removed} lines` : "no visible text change"}
                {d.layout ? `; ${layoutNote(d.layout)}` : ""}.
              </span>
              <button type="button" className="acute-ask-ai__secondary" aria-expanded={shown} onClick={() => toggle(key)}>
                {shown ? "Hide changes" : "View changes"}
              </button>
              {d.layout && (
                <button type="button" className="acute-ask-ai__secondary" aria-expanded={previewing} onClick={() => toggle(previewKey)}>
                  {previewing ? "Hide layout" : "Preview layout"}
                </button>
              )}
            </div>
            {d.layout && previewing && (
              <Suspense fallback={<p className="acute-review__note">Loading the preview…</p>}>
                <LayoutPreview current={d.layout.current} proposed={d.layout.proposed} name={d.name} />
              </Suspense>
            )}
            {shown && (
              <pre className="acute-review__diff" aria-label={`Before and after: ${d.name}`}>
                {lines.map((l, n) => (
                  <span key={n} className={`acute-review__diff-line acute-review__diff-line--${l.op}`}>
                    {l.op === "add" ? "+ " : l.op === "del" ? "− " : "  "}
                    {l.text}
                    {"\n"}
                  </span>
                ))}
              </pre>
            )}
          </li>
        );
      })}
      {created.map((c) => {
        const key = `new:${c.key}`;
        const previewing = open.has(key);
        return (
          <li key={key} className="acute-review__conflict" data-decision="create" aria-label={`New layout card: ${c.name}`}>
            <div className="acute-review__conflict-head">
              <span className="acute-review__conflict-name">+ {c.name}</span>
              <span className="acute-review__note">New card drawn from a layout.</span>
              <button type="button" className="acute-ask-ai__secondary" aria-expanded={previewing} onClick={() => toggle(key)}>
                {previewing ? "Hide layout" : "Preview layout"}
              </button>
            </div>
            {previewing && (
              <Suspense fallback={<p className="acute-review__note">Loading the preview…</p>}>
                <LayoutPreview proposed={c.lang} name={c.name} />
              </Suspense>
            )}
          </li>
        );
      })}
    </ul>
  );
}
