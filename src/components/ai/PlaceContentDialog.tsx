"use client";

/**
 * "Where should this go?" (intelligent-update-engine-plan Stage 2d): content with no source — a pasted line, an Ask AI
 * answer — placed where it belongs in the notes on this canvas. The router (no AI) ranks the cards, says what it would
 * do at each (update the card that holds the claim, or add a card beside it) and why, with two separate confidences:
 * where (is this the right place?) and edit (does the change take the new information in correctly?). The user picks
 * one or more destinations — or a new card, or "Keep existing — no change" — and the choice becomes an ordinary change
 * set, reviewed before anything is written. When two places fit about equally, AI can be asked to decide (one explicit
 * call; it may ask back).
 *
 * Only a confident route to a card whose edit needs no decision is preselected (user decisions 2026-11-15): "no card is
 * close" (NEW), "more than one place fits" and an update that contradicts or rewrites the card start with nothing picked,
 * and Propose waits for the user's choice (`defaultPicks`, `ai/router/placement.ts`).
 *
 * Semantic placement (Stage 5, §18, behind `NEXT_PUBLIC_SEMANTIC_PLACEMENT` and the server's local model): the cards are
 * ranked by meaning instead (`semanticPlacement.ts`), and a card can take the content inside it — after a list item, at a
 * list's end, as a table row or a changed cell. When the note belongs nowhere, "A new card on its own" is listed first as
 * the suggestion, the closest cards still offered; nothing is preselected for it.
 */
import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";
import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { getPendingChanges } from "@/ai/changes/pendingChanges";
import { AIRuntime } from "@/ai/runtime";
import { choicesFor, defaultPicks, isEscalated, KEEP_EXISTING, modelPicks, NEW_CARD, placeContent, togglePick } from "@/ai/router/placement";
import { routeContent, type RouteCandidate } from "@/ai/router/router";
import { refineRoute, type RefinedRoute } from "@/ai/router/task";
import type { SceneElement } from "@/domain/canvas/adapter";
import { newId } from "@/domain/ids";
import type { DocumentHome } from "@/domain/types";
import { getDocumentStore } from "@/state/documents";
import { useAIMode } from "./askAI";
import { placeDialog, recordPlacement, routerFor, usePlaceDialog } from "./placeContent";
import { onCommitted } from "./commitOnCanvas";
import { semanticFind, warmSemanticIndex } from "./semanticPlacement";
import { isSemanticPlacementUiEnabled } from "@/config/features";

const pct = (n: number) => `${Math.round(n * 100)}%`;
const NEW = NEW_CARD;

function actionLabel(c: RouteCandidate, asNew: boolean): string {
  if (asNew || c.action === "insert_near") return "Add a new card beside it";
  if (c.action === "none") return "Already says this — nothing to add";
  if (c.action === "anchor") return c.anchor!.label;
  const claim = c.claim!;
  return claim.escalate ? `Update it — but this ${claim.intent === "CONTRADICTS" ? "contradicts" : "rewrites"} what it says` : `Update the card (${claim.intent.toLowerCase()})`;
}

export function PlaceContentDialog({ api, home }: { api: ExcalidrawImperativeAPI; home: DocumentHome }) {
  const store = usePlaceDialog();
  // Semantic placement: the canvas's item index follows every accepted change, in the background (Stage 5b, §18).
  useEffect(() => {
    if (!isSemanticPlacementUiEnabled()) return;
    return onCommitted((_revision, at) => {
      if (at.canvasId !== home.canvasId) return;
      warmSemanticIndex(home.canvasId, api.getSceneElements() as unknown as readonly SceneElement[], (id) => getDocumentStore().get(id));
    });
  }, [api, home.canvasId]);
  // Keyed by the open request: every open starts from its own text, with nothing found or picked yet.
  return store.open ? <PlaceContentBody key={store.seq} api={api} home={home} initialText={store.text} /> : null;
}

function PlaceContentBody({ api, home, initialText }: { api: ExcalidrawImperativeAPI; home: DocumentHome; initialText: string }) {
  const mode = useAIMode();
  const [text, setText] = useState(initialText);
  const [result, setResult] = useState<RefinedRoute | null>(null);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [asNew, setAsNew] = useState<Set<string>>(new Set());
  const [asking, setAsking] = useState(false);

  const scene = () => api.getSceneElements() as unknown as readonly SceneElement[];
  const getDocument = (id: string) => getDocumentStore().get(id);

  const find = async () => {
    const { tier, descriptors, signals } = await routerFor(home.workspaceId, home.canvasId, scene(), getDocument);
    const routed = routeContent({ text, canvasId: home.canvasId, tier, scene: scene(), descriptors, signals });
    // By meaning, when the local model is there (Stage 5); else the router's answer stands.
    const r = (await semanticFind({ canvasId: home.canvasId, text, scene: scene(), getDocument, tier, descriptors })) ?? routed;
    setResult(r);
    // The router's own pick is preselected only when it is sure and its edit needs no decision; otherwise the user chooses.
    setPicked(defaultPicks(r));
    setAsNew(new Set());
  };

  const askAI = async () => {
    if (!result) return;
    setAsking(true);
    try {
      const r = await refineRoute(result, text, AIRuntime, { force: true });
      setResult(r);
      // The model's cards are picked, never an escalated update, and never "a new card" on its say alone.
      setPicked((p) => modelPicks(r, p));
    } finally {
      setAsking(false);
    }
  };

  const propose = () => {
    if (!result) return;
    if (picked.has(KEEP_EXISTING)) {
      // Nothing proposed and nothing recorded: keeping the notes as they are says nothing about where content belongs.
      placeDialog.close();
      api.setToast({ message: "No change: the notes are kept as they are.", closable: true, duration: 5000 });
      return;
    }
    const choices = choicesFor(picked, asNew, result.candidates);
    const s = api.getAppState();
    const at = { x: -s.scrollX + s.width / s.zoom.value / 2 - 160, y: -s.scrollY + s.height / s.zoom.value / 2 - 60 };
    const { set, notes } = placeContent({ text, choices, scene: scene(), getDocument, at, operationId: newId("op") });
    recordPlacement(home.workspaceId, text, [...picked].filter((id) => id !== NEW));
    placeDialog.close();
    if (set) getPendingChanges().propose(home.canvasId, set);
    if (notes.length || !set) api.setToast({ message: notes.length ? notes.join(" ") : "Nothing to add: the notes already say this.", closable: true, duration: 8000 });
  };

  const toggle = (id: string) => setPicked((p) => togglePick(p, id));

  // "Belongs nowhere" (semantic placement, §13.14): listed first and marked as the suggestion, never picked for the user.
  const newCardItem = (suggested: boolean) => (
    <li className="acute-place-dialog__item" data-suggested={suggested || undefined}>
      <label className="acute-place-dialog__choice">
        <input type="checkbox" checked={picked.has(NEW)} onChange={() => toggle(NEW)} />
        <span className="acute-place-dialog__title">A new card on its own{suggested ? " (suggested)" : ""}</span>
      </label>
    </li>
  );

  const banner = useMemo(() => {
    if (!result) return null;
    if (result.semantic?.nowhere) return "Nothing on this canvas is about this: a new card on its own is suggested (listed first). The closest cards are still offered.";
    if (result.decision === "NEW" && result.semantic && result.candidates.length) return `Suggested: ${result.reason}. Choose where it goes — a new card on its own, one of these, or keep the notes as they are.`;
    if (result.decision === "NEW") return "No confident match: no card is close to this. Choose where it goes — a new card on its own, one of these, or keep the notes as they are.";
    if (result.decision === "NEEDS_CLARIFICATION") return `It could go in more than one place — choose. ${result.model?.question ?? ""}`.trim();
    const best = `Best fit: ${result.reason.replace(/^best fit: /, "")}`;
    // The route's card (or a card the model picked) holds a claim the content contradicts or rewrites: left unpicked.
    const chosen = result.model?.decision === "route" ? result.candidates.filter((c) => result.model!.targets.includes(c.id)) : result.candidates.slice(0, 1);
    const escalated = chosen.find(isEscalated);
    return escalated ? `${best} — but the change ${escalated.claim!.intent === "CONTRADICTS" ? "contradicts" : "rewrites"} what it says. Nothing is picked: choose what to do, or keep the notes as they are.` : best;
  }, [result]);

  return createPortal(
    <div className="acute-dialog__backdrop" onMouseDown={(e) => e.target === e.currentTarget && placeDialog.close()}>
      <div className="acute-dialog acute-place-dialog" role="dialog" aria-modal="true" aria-labelledby="acute-place-title">
        <h2 id="acute-place-title">Where should this go?</h2>
        <textarea
          className="acute-visualize-dialog__text"
          aria-label="Content to place"
          placeholder="Paste a line, a note or an AI answer…"
          value={text}
          onChange={(e) => {
            setText(e.target.value);
            setResult(null);
          }}
          rows={4}
        />
        {result && (
          <>
            <p className="acute-place-dialog__banner" data-decision={result.decision} role="status">
              {banner}
            </p>
            <ul className="acute-place-dialog__list" aria-label="Places it could go">
              {result.semantic?.nowhere && newCardItem(true)}
              {result.candidates.map((c) => (
                <li key={c.id} className="acute-place-dialog__item" data-action={c.action} data-escalated={isEscalated(c) || undefined}>
                  <label className="acute-place-dialog__choice">
                    <input type="checkbox" checked={picked.has(c.id)} onChange={() => toggle(c.id)} disabled={c.action === "none"} />
                    <span className="acute-place-dialog__title">{c.descriptor.title}</span>
                    {c.descriptor.section && <span className="acute-place-dialog__section"> · {c.descriptor.section.name}</span>}
                  </label>
                  <div className="acute-place-dialog__meta">
                    <span className="acute-place-dialog__action">{actionLabel(c, asNew.has(c.id))}</span>
                    <span className="acute-place-dialog__scores">
                      <span title="Is this the right place? (routing confidence)">Where {pct(c.routing)}</span>
                      <span title="Does the change take the new information in correctly? (update confidence)">Edit {pct(c.update)}</span>
                    </span>
                  </div>
                  {(c.action === "update" || c.action === "anchor") && (
                    <label className="acute-place-dialog__alt">
                      <input
                        type="checkbox"
                        checked={asNew.has(c.id)}
                        onChange={() =>
                          setAsNew((s) => {
                            const next = new Set(s);
                            if (next.has(c.id)) next.delete(c.id);
                            else next.add(c.id);
                            return next;
                          })
                        }
                      />
                      Add as a new card beside it instead
                    </label>
                  )}
                  <ul className="acute-place-dialog__evidence" aria-label="Why">
                    {c.evidence.slice(0, 4).map((e, i) => (
                      <li key={i}>{e}</li>
                    ))}
                  </ul>
                </li>
              ))}
              {!result.semantic?.nowhere && newCardItem(false)}
              <li className="acute-place-dialog__item">
                <label className="acute-place-dialog__choice">
                  <input type="checkbox" checked={picked.has(KEEP_EXISTING)} onChange={() => toggle(KEEP_EXISTING)} />
                  <span className="acute-place-dialog__title">Keep existing — no change</span>
                </label>
              </li>
            </ul>
          </>
        )}
        <div className="acute-dialog__actions">
          {result?.decision === "NEEDS_CLARIFICATION" && mode === "on" && !result.model && (
            <button type="button" className="acute-ask-ai__secondary" onClick={() => void askAI()} disabled={asking} title="One AI call: it picks among these places, or asks you a question">
              {asking ? "Asking AI…" : "Ask AI to decide"}
            </button>
          )}
          <button type="button" className="acute-ask-ai__secondary" onClick={() => placeDialog.close()}>
            Cancel
          </button>
          {result ? (
            <button type="button" className="acute-ask-ai__primary" onClick={propose} disabled={!picked.size}>
              Propose
            </button>
          ) : (
            <button type="button" className="acute-ask-ai__primary" onClick={() => void find()} disabled={!text.trim()}>
              Find a place
            </button>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}
