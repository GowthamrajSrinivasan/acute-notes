"use client";

/**
 * A before/after diff for every clean `update_block` under review (user decision 2, 2026-11-15: whole-block
 * proposals "Require a clear before/after diff"). An `update_block` replaces a block's whole content, so each one is
 * listed in the review bar, visible without opening "Review", with a "View changes" toggle (collapsed by default)
 * showing the same line diff as a conflict card's "View diff". Display only: Accept, Reject and the conflict decisions
 * are unchanged, and conflicts keep their own cards (`ConflictCard`).
 */
import { useState } from "react";
import type { ConflictItem, ProposedChange } from "@/ai/changes/changeSet";
import { conflictName, proposedText } from "@/ai/reconcile/conflicts";
import { lineDiff } from "@/ai/reconcile/diff";

type UpdateBlock = Extract<ProposedChange, { kind: "update_block" }>;

export interface BlockUpdateDiff {
  target: string;
  name: string;
  /** The block's content now, in the conflict cards' canonical form; null when it isn't loaded. */
  before: string | null;
  after: string;
}

/** The clean `update_block`s among `changes`, each with its text now and as proposed. */
export function blockUpdateDiffs(changes: readonly ProposedChange[], currentOf: (target: string) => string | null): BlockUpdateDiff[] {
  return changes
    .filter((c): c is UpdateBlock => c.kind === "update_block")
    .map((c) => {
      const item: ConflictItem = { target: c.target, apply: c };
      return { target: c.target, name: conflictName(item), before: currentOf(c.target), after: proposedText(item) };
    });
}

export function BlockUpdateDiffs({ diffs, onShow }: { diffs: readonly BlockUpdateDiff[]; onShow?: (target: string) => void }) {
  const [open, setOpen] = useState<ReadonlySet<string>>(new Set());
  if (!diffs.length) return null;
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
                Replaces this block&apos;s content: {added || removed ? `+${added} −${removed} lines` : "no visible text change"}.
              </span>
              <button type="button" className="acute-ask-ai__secondary" aria-expanded={shown} onClick={() => toggle(key)}>
                {shown ? "Hide changes" : "View changes"}
              </button>
            </div>
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
    </ul>
  );
}
