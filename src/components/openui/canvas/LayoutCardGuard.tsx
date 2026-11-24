"use client";

/**
 * Opening a layout card for editing (note-taking-modes plan Step 7). A card drawn from its stored layout would lose that
 * drawing once its text is edited (the layout goes out of date), so opening it asks first — on an AI-managed canvas
 * ("choose"): "Ask AI to change…" or "Switch to editable"; anywhere, "ask": the instruction box for the canvas's AI.
 *
 * Asking AI is the user's click after being told it uses their AI (one request) and that nothing changes until they accept
 * the proposal in the review. Loaded only when such a card is opened, so OpenUI stays out of the main bundle.
 */
import { useEffect, useRef, useState } from "react";
import { loadDefaultParser } from "@/ai/renderer/render";
import { AIRuntime } from "@/ai/runtime";
import type { CardLayout, RichContent } from "@/domain/types";
import { canvasCards } from "./canvasCardsStore";
import { askAIForLayout, type LayoutAskOutcome } from "./layoutAI";

export type LayoutGuardView = "choose" | "ask";

export interface LayoutCardGuardProps {
  elementId: string;
  card: { snapshot: RichContent; layout?: CardLayout };
  passages: ReadonlyMap<string, string>;
  view: LayoutGuardView;
  /** Whether the canvas's AI may be offered (AI mode on). */
  aiOn: boolean;
  onView(next: LayoutGuardView | "edit"): void;
  onClose(): void;
}

export default function LayoutCardGuard({ elementId, card, passages, view, aiOn, onView, onClose }: LayoutCardGuardProps) {
  if (view === "ask" && aiOn) return <LayoutAskPanel elementId={elementId} card={card} passages={passages} onClose={onClose} onBack={() => onView("choose")} />;
  return (
    <div className="acute-layout-guard" role="group" aria-label="Layout card" data-testid="acute-layout-guard">
      <p className="acute-layout-guard__title">This card is drawn from a layout.</p>
      <div className="acute-layout-guard__actions">
        {aiOn && (
          <button type="button" data-primary onClick={() => onView("ask")}>
            Ask AI to change…
          </button>
        )}
        <button type="button" onClick={() => onView("edit")}>
          Switch to editable
        </button>
        <button type="button" onClick={onClose}>
          Cancel
        </button>
      </div>
      <p className="acute-layout-guard__hint">
        Editing its text leaves the layout out of date: the card is then drawn from its text, and its visual structure is lost
        until the layout is refreshed or removed. Undo brings it back.
      </p>
    </div>
  );
}

type Status = { state: "idle" } | { state: "busy" } | { state: "done"; result: LayoutAskOutcome };

/** The instruction box: one request to the canvas's AI, the result proposed for review. */
export function LayoutAskPanel({ elementId, card, passages, onClose, onBack }: { elementId: string; card: LayoutCardGuardProps["card"]; passages: ReadonlyMap<string, string>; onClose(): void; onBack?: () => void }) {
  const [instruction, setInstruction] = useState("");
  // On by default: asking how a card looks never rewrites what it says unless the user unticks this.
  const [layoutOnly, setLayoutOnly] = useState(true);
  const [status, setStatus] = useState<Status>({ state: "idle" });
  const request = useRef<AbortController | null>(null);
  const input = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    input.current?.focus();
    return () => request.current?.abort();
  }, []);

  const run = async () => {
    const canvasId = canvasCards.canvasId();
    if (!canvasId || !instruction.trim()) return;
    const controller = new AbortController();
    request.current = controller;
    setStatus({ state: "busy" });
    const result = await askAIForLayout(
      { canvasId, elementId, card, instruction, passages, purpose: "change", layoutOnly },
      { runtime: AIRuntime, parseMarkdown: await loadDefaultParser(), signal: controller.signal },
    );
    if (request.current !== controller) return;
    request.current = null;
    setStatus({ state: "done", result });
  };

  const result = status.state === "done" ? status.result : null;
  return (
    <div className="acute-layout-guard" role="group" aria-label="Ask AI to change this card" data-testid="acute-layout-ask">
      {result?.outcome === "proposed" ? (
        <>
          <p className="acute-layout-guard__title" role="status">
            Proposed — review it in the bar below. Nothing changes until you accept it.
          </p>
          {result.notes.length > 0 && (
            <ul className="acute-layout-guard__notes" aria-label="Flagged for your review">
              {result.notes.map((n, i) => (
                <li key={i}>{n}</li>
              ))}
            </ul>
          )}
          <div className="acute-layout-guard__actions">
            <button type="button" data-primary onClick={onClose}>
              Close
            </button>
          </div>
        </>
      ) : (
        <>
          <label className="acute-layout-guard__title" htmlFor={`acute-layout-ask-${elementId}`}>
            What should change?
          </label>
          <textarea
            id={`acute-layout-ask-${elementId}`}
            ref={input}
            rows={3}
            maxLength={2000}
            value={instruction}
            disabled={status.state === "busy"}
            placeholder="e.g. Show it as a timeline · Put the risk first · Add a callout for the deadline"
            onChange={(e) => setInstruction(e.target.value)}
          />
          <label className="acute-layout-guard__check">
            <input type="checkbox" checked={layoutOnly} disabled={status.state === "busy"} onChange={(e) => setLayoutOnly(e.target.checked)} />
            Layout only — keep the card&apos;s text
          </label>
          <p className="acute-layout-guard__hint">Uses your AI provider (one request). Nothing changes until you accept it in the review.</p>
          {result?.outcome === "refused" && (
            <div role="alert" className="acute-layout-guard__problems">
              Not proposed — the layout didn&apos;t match the card:
              <ul>
                {result.problems.map((p, i) => (
                  <li key={i}>{p}</li>
                ))}
              </ul>
            </div>
          )}
          {result?.outcome === "failed" && (
            <p role="alert" className="acute-layout-guard__problems">
              {result.message}
            </p>
          )}
          <div className="acute-layout-guard__actions">
            {status.state === "busy" ? (
              <>
                <span role="status">Asking AI…</span>
                <button
                  type="button"
                  onClick={() => {
                    request.current?.abort();
                    request.current = null;
                    setStatus({ state: "idle" });
                  }}
                >
                  Cancel
                </button>
              </>
            ) : (
              <>
                <button type="button" data-primary disabled={!instruction.trim()} onClick={() => void run()}>
                  Ask AI
                </button>
                {onBack && (
                  <button type="button" onClick={onBack}>
                    Back
                  </button>
                )}
                <button type="button" onClick={onClose}>
                  Cancel
                </button>
              </>
            )}
          </div>
        </>
      )}
    </div>
  );
}
