"use client";

/**
 * The review queue (knowledge-notes-plan §5.3, WP2.6; Lane H): "Review N" steps through the Needs review items one by
 * one, like the dense-block walk-through (`components/ai/DenseBlocks.tsx`). Each step shows the card and its cited
 * passage side by side with the reason, and one action resolves it: Keep / Edit / Use source wording for a card,
 * Include / Dismiss for a passage no card carries. Review never blocks Accept.
 *
 * Controlled: the integrator builds `items` (`buildReviewQueue`), stores each decision and drops resolved items; the
 * queue then moves on to the item that took its place. `onShow` is called for the item on show, so the integrator can
 * select and zoom to the card and open the Source tab on the passage. Not mounted yet.
 */
import { useEffect, useRef, useState } from "react";
import { ACTION_HINT, ACTION_LABEL, decisionFor, markParts, nextIndex, stepIndex, type ReviewDecision, type ReviewItem } from "./queue";
import { WEAK_MODEL_WARNING } from "./wording";
import "./review.css";

export interface ReviewQueueProps {
  items: readonly ReviewItem[];
  onDecide: (decision: ReviewDecision) => void;
  onShow?: (item: ReviewItem) => void;
  /** Shows the model-tier warning while walking. */
  weakModel?: boolean;
  /** Starts walking at once (the "Review ›" of a notice). */
  defaultOpen?: boolean;
  /** Walking stopped (Done, or nothing left). */
  onClose?: () => void;
}

function Marked({ text, fragment }: { text: string; fragment?: string }) {
  return (
    <>
      {markParts(text, fragment).map((p, i) => (p.mark ? <mark key={i}>{p.text}</mark> : <span key={i}>{p.text}</span>))}
    </>
  );
}

export function ReviewQueue({ items, onDecide, onShow, weakModel, defaultOpen = false, onClose }: ReviewQueueProps) {
  const [walking, setWalking] = useState(defaultOpen);
  const [at, setAt] = useState<{ key: string | null; index: number }>({ key: items[0]?.key ?? null, index: 0 });
  const index = nextIndex(items, at);
  const item = index >= 0 ? items[index]! : null;
  const shownKey = walking && item ? item.key : null;

  useEffect(() => {
    if (shownKey && item) onShow?.(item);
    // Only when the item on show changes, not on every new items array.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shownKey]);

  // The last item was resolved while walking: stop (state adjusted during render, not in an effect).
  if (walking && items.length === 0) setWalking(false);
  const wasWalking = useRef(walking);
  useEffect(() => {
    if (wasWalking.current && !walking) onClose?.();
    wasWalking.current = walking;
    // Only on the walking → stopped transition.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [walking]);

  if (!item) return null;

  if (!walking) {
    return (
      <button
        type="button"
        className="acute-ask-ai__secondary acute-kn-queue__open"
        title="Step through the cards and passages that need review"
        onClick={() => {
          setAt({ key: items[0]!.key, index: 0 });
          setWalking(true);
        }}
      >
        Review {items.length}
      </button>
    );
  }

  const go = (delta: number) => {
    const i = stepIndex(index, items.length, delta);
    setAt({ key: items[i]!.key, index: i });
  };
  const close = () => setWalking(false);
  const sourceFragment = item.evidence.find((e) => e.source)?.source;
  const cardFragment = item.evidence.find((e) => e.card)?.card;

  return (
    <div className="acute-review acute-kn-queue" role="region" aria-label="Needs review">
      <span className="acute-review__summary">
        Needs review {index + 1} of {items.length}
        <span className="acute-review__note"> · {item.kind === "card" ? "card" : "passage not on a card"}</span>
      </span>
      <ul className="acute-kn-queue__reasons">
        {item.reasons.map((r) => (
          <li key={r}>{r}</li>
        ))}
      </ul>
      <div className="acute-kn-queue__compare">
        {item.card && (
          <section className="acute-kn-queue__side" aria-label="Card">
            <h4>Card</h4>
            <strong>
              <Marked text={item.card.title} fragment={cardFragment} />
            </strong>
            {item.card.body && (
              <p>
                <Marked text={item.card.body} fragment={cardFragment} />
              </p>
            )}
          </section>
        )}
        <section className="acute-kn-queue__side" aria-label="Source">
          <h4>Source</h4>
          {item.units.length ? (
            item.units.map((u) => (
              <p key={u.id} data-unit={u.id}>
                <Marked text={u.text} fragment={sourceFragment} />
              </p>
            ))
          ) : (
            <p className="acute-review__note">No cited passage.</p>
          )}
        </section>
      </div>
      {weakModel && <span className="acute-kn-totals__warning">{WEAK_MODEL_WARNING}</span>}
      <span className="acute-review__actions">
        {item.actions.map((a) => (
          <button key={a} type="button" className={a === item.actions[0] ? "acute-ask-ai__primary" : "acute-ask-ai__secondary"} title={ACTION_HINT[a]} onClick={() => onDecide(decisionFor(item, a))}>
            {ACTION_LABEL[a]}
          </button>
        ))}
        {items.length > 1 && (
          <>
            <button type="button" className="acute-ask-ai__secondary" aria-label="Previous item" onClick={() => go(-1)}>
              ‹
            </button>
            <button type="button" className="acute-ask-ai__secondary" aria-label="Next item" onClick={() => go(1)}>
              Next ›
            </button>
          </>
        )}
        <button type="button" className="acute-ask-ai__secondary" onClick={close}>
          Done
        </button>
      </span>
    </div>
  );
}
