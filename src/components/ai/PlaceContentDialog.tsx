"use client";

/**
 * "Where should this go?" (intelligent-update-engine-plan Stage 2d): content with no source — a pasted line, an Ask AI
 * answer — placed where it belongs in the notes on this canvas. The router (no AI) ranks the cards, says what it would
 * do at each (update the card that holds the claim, or add a card beside it) and why, with two separate confidences:
 * where (is this the right place?) and edit (does the change take the new information in correctly?). The user picks
 * one or more destinations — or a new card — and the choice becomes an ordinary change set, reviewed before anything
 * is written. When two places fit about equally, AI can be asked to decide (one explicit call; it may ask back).
 */
import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";
import { useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { getPendingChanges } from "@/ai/changes/pendingChanges";
import { AIRuntime } from "@/ai/runtime";
import { placeContent, type PlacementChoice } from "@/ai/router/placement";
import { routeContent, type RouteCandidate } from "@/ai/router/router";
import { refineRoute, type RefinedRoute } from "@/ai/router/task";
import type { SceneElement } from "@/domain/canvas/adapter";
import { newId } from "@/domain/ids";
import type { DocumentHome } from "@/domain/types";
import { getDocumentStore } from "@/state/documents";
import { useAIMode } from "./askAI";
import { placeDialog, recordPlacement, routerFor, usePlaceDialog } from "./placeContent";

const pct = (n: number) => `${Math.round(n * 100)}%`;
const NEW = "__new__";

function actionLabel(c: RouteCandidate, asNew: boolean): string {
  if (asNew || c.action === "insert_near") return "Add a new card beside it";
  if (c.action === "none") return "Already says this — nothing to add";
  const claim = c.claim!;
  return claim.escalate ? `Update it — but this ${claim.intent === "CONTRADICTS" ? "contradicts" : "rewrites"} what it says` : `Update the card (${claim.intent.toLowerCase()})`;
}

export function PlaceContentDialog({ api, home }: { api: ExcalidrawImperativeAPI; home: DocumentHome }) {
  const store = usePlaceDialog();
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
    const r = routeContent({ text, canvasId: home.canvasId, tier, scene: scene(), descriptors, signals });
    setResult(r);
    // The router's own pick is preselected only when it is sure; otherwise the user chooses.
    setPicked(new Set(r.decision === "route" && r.candidates[0] ? [r.candidates[0].id] : r.decision === "NEW" ? [NEW] : []));
    setAsNew(new Set());
  };

  const askAI = async () => {
    if (!result) return;
    setAsking(true);
    try {
      const r = await refineRoute(result, text, AIRuntime, { force: true });
      setResult(r);
      if (r.model?.decision === "route") setPicked(new Set(r.model.targets));
      else if (r.model?.decision === "new") setPicked(new Set([NEW]));
    } finally {
      setAsking(false);
    }
  };

  const propose = () => {
    if (!result) return;
    const byId = new Map(result.candidates.map((c) => [c.id, c] as const));
    const choices: PlacementChoice[] = [...picked].map((id) =>
      id === NEW ? { target: null, action: "new" } : { target: id, action: asNew.has(id) ? "insert_near" : byId.get(id)!.action, candidate: byId.get(id)! },
    );
    const s = api.getAppState();
    const at = { x: -s.scrollX + s.width / s.zoom.value / 2 - 160, y: -s.scrollY + s.height / s.zoom.value / 2 - 60 };
    const { set, notes } = placeContent({ text, choices, scene: scene(), getDocument, at, operationId: newId("op") });
    recordPlacement(home.workspaceId, text, [...picked].filter((id) => id !== NEW));
    placeDialog.close();
    if (set) getPendingChanges().propose(home.canvasId, set);
    if (notes.length || !set) api.setToast({ message: notes.length ? notes.join(" ") : "Nothing to add: the notes already say this.", closable: true, duration: 8000 });
  };

  const toggle = (id: string) =>
    setPicked((p) => {
      const next = new Set(p);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const banner = useMemo(() => {
    if (!result) return null;
    if (result.decision === "NEW") return "No card is close to this: it can go in as a new card.";
    if (result.decision === "NEEDS_CLARIFICATION") return `It could go in more than one place — choose. ${result.model?.question ?? ""}`.trim();
    return `Best fit: ${result.reason.replace(/^best fit: /, "")}`;
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
              {result.candidates.map((c) => (
                <li key={c.id} className="acute-place-dialog__item" data-action={c.action}>
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
                  {c.action === "update" && (
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
              <li className="acute-place-dialog__item">
                <label className="acute-place-dialog__choice">
                  <input type="checkbox" checked={picked.has(NEW)} onChange={() => toggle(NEW)} />
                  <span className="acute-place-dialog__title">A new card on its own</span>
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
