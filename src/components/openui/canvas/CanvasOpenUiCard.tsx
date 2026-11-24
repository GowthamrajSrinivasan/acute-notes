"use client";

/**
 * One canvas card drawn as an OpenUI card (the "Cards" view, `.ai/docs/openui/openui-canvas-rendering-plan-2026-11-16.md`
 * step 5). Loaded only when that view is chosen, so OpenUI stays out of the main bundle otherwise.
 *
 * What it draws is `cardRenderPlan`'s order (note-taking-modes plan §4.2): the card's stored layout while it is current,
 * else the card derived from its text (`cardLangOf`); a Lang that doesn't parse falls through to the next, and the last to
 * `fallback` (Compact). A stale stored layout shows a "Layout out of date" chip with "Ask AI to refresh" (asked first,
 * reviewed before it applies) and "Remove layout".
 *
 * Read-only otherwise: double-click opens the block (a card drawn from its stored layout asks first: `LayoutCardGuard`). Only its buttons (citation chips, "More",
 * "Open in source", "Remove layout") take clicks, and those never start a canvas drag.
 */
import type { OpenUIError } from "@openuidev/react-lang";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { cardRenderPlan } from "@/ai/openui/cardLayout";
import { checkLayoutStructure } from "@/ai/openui/layoutCheck";
import { NotesHostProvider, type NotesHost } from "@/ai/openui/hostContext";
import { OpenUiCardRenderer } from "@/components/openui/OpenUiCardRenderer";
import type { CardLayout, NoteMode, RichContent } from "@/domain/types";
import { getDocumentStore } from "@/state/documents";
import { loadDefaultParser } from "@/ai/renderer/render";
import { AIRuntime } from "@/ai/runtime";
import { useAIMode } from "@/components/ai/askAI";
import { canvasCards } from "./canvasCardsStore";
import { askAIForLayout, REFRESH_INSTRUCTION } from "./layoutAI";
import type { CanvasCard } from "./canvasCardsStore";
import "../interactions.css";
import "../notes/notes.css";

export interface CanvasOpenUiCardProps {
  elementId: string;
  /** The block's document; without it a stale layout can't be removed from here (the chip says so only). */
  documentId?: string;
  title: string;
  content: RichContent;
  card: CanvasCard;
  layout?: CardLayout;
  noteMode: NoteMode;
  /** What is drawn instead when the card can't be (nothing to draw, or no Lang that parses). */
  fallback: ReactNode;
}

export default function CanvasOpenUiCard({ elementId, documentId, title, content, card, layout, noteMode, fallback }: CanvasOpenUiCardProps) {
  const { info, host } = card;
  const plan = useMemo(
    () =>
      cardRenderPlan(
        { title, snapshot: content, ...(layout ? { layout } : {}) },
        { noteMode, cites: info.cites, needsReview: info.needsReview, drawable: (lang) => checkLayoutStructure(lang).ok },
      ),
    [title, content, layout, noteMode, info],
  );
  // Langs that failed to parse, remembered by their text: an edit that changes the Lang draws it again.
  const [failed, setFailed] = useState<ReadonlySet<string>>(new Set());
  const lang = plan?.langs.find((l) => !failed.has(l)) ?? null;
  const onError = useCallback(
    (errors: OpenUIError[]) => {
      if (errors.length && lang) setFailed((f) => new Set([...f, lang]));
    },
    [lang],
  );
  const notesHost = useMemo<NotesHost>(
    () => ({
      noteId: elementId,
      unitText: (u: string) => info.passages.get(u),
      openSource: (us: readonly string[]) => host.openSource(elementId, us),
    }),
    [elementId, info, host],
  );
  if (!lang) return <>{fallback}</>;
  return (
    <div className="acute-openui-card" data-testid="acute-openui-card" data-layout={lang === layout?.lang ? "stored" : "derived"} onPointerDown={(e) => e.stopPropagation()}>
      <NotesHostProvider value={notesHost}>
        <OpenUiCardRenderer key={lang} response={lang} onError={onError} />
      </NotesHostProvider>
      {plan?.stale && <StaleLayoutChip documentId={documentId} elementId={elementId} card={{ snapshot: content, ...(layout ? { layout } : {}) }} passages={info.passages} />}
    </div>
  );
}

/**
 * The card's text changed after its layout was written, so the card is drawn from its text. "Remove layout" drops the
 * stored layout (the text is untouched). "Ask AI to refresh" (Step 7) asks first — one request to the canvas's AI — and
 * puts the refreshed layout up for review; nothing changes until it is accepted.
 */
function StaleLayoutChip({ documentId, elementId, card, passages }: { documentId?: string; elementId: string; card: { snapshot: RichContent; layout?: CardLayout }; passages: ReadonlyMap<string, string> }) {
  const [busy, setBusy] = useState(false);
  const aiOn = useAIMode() === "on";
  const [refresh, setRefresh] = useState<"idle" | "confirm" | "busy" | "proposed" | { problem: string }>("idle");
  const request = useRef<AbortController | null>(null);
  useEffect(() => () => request.current?.abort(), []);
  const run = async () => {
    const canvasId = canvasCards.canvasId();
    if (!canvasId) return;
    const controller = new AbortController();
    request.current = controller;
    setRefresh("busy");
    const result = await askAIForLayout(
      { canvasId, elementId, card, instruction: REFRESH_INSTRUCTION, passages, purpose: "refresh" },
      { runtime: AIRuntime, parseMarkdown: await loadDefaultParser(), signal: controller.signal },
    );
    if (request.current !== controller) return;
    request.current = null;
    setRefresh(result.outcome === "proposed" ? "proposed" : { problem: result.outcome === "refused" ? `Not proposed: ${result.problems[0]}` : result.message });
  };
  if (refresh === "confirm") {
    return (
      <div className="acute-openui-card__stale" role="group" aria-label="Refresh layout with AI" data-testid="acute-layout-stale">
        <span>Refresh with AI? One request; you review it first.</span>
        <button type="button" onClick={() => void run()}>
          Refresh
        </button>
        <button type="button" onClick={() => setRefresh("idle")}>
          Cancel
        </button>
      </div>
    );
  }
  return (
    <div className="acute-openui-card__stale" role="status" data-testid="acute-layout-stale">
      <span title="The card's text changed after its layout was made, so it is drawn from its text.">
        {refresh === "busy" ? "Asking AI…" : refresh === "proposed" ? "Refresh proposed — review it below" : typeof refresh === "object" ? refresh.problem : "Layout out of date"}
      </span>
      {aiOn && refresh !== "busy" && refresh !== "proposed" && (
        <button type="button" onClick={() => setRefresh("confirm")}>
          Ask AI to refresh
        </button>
      )}
      {documentId && refresh !== "busy" && (
        <button
          type="button"
          disabled={busy}
          onClick={() => {
            setBusy(true);
            void getDocumentStore()
              .setLayout(documentId, null)
              .finally(() => setBusy(false));
          }}
        >
          Remove layout
        </button>
      )}
    </div>
  );
}
