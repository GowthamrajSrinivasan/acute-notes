"use client";

/**
 * Ctrl/⌘+F canvas find that covers native and Acute text (plan B#10).
 * Results step with Enter / Shift+Enter; each one is selected and scrolled
 * into view, and matches inside Acute text are highlighted with the CSS
 * Custom Highlight API.
 */
import { CaptureUpdateAction } from "@excalidraw/excalidraw";
import type { ExcalidrawTextElement } from "@excalidraw/excalidraw/element/types";
import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";
import { useEffect, useMemo, useRef, useState } from "react";
import { getEmbedRef } from "@/domain/canvas/adapter";
import { toPlainText } from "@/domain/content/richContent";
import { getDocumentStore } from "@/state/documents";
import { searchSources, type SearchSource } from "./canvasSearch";
import { prefersReducedMotion } from "@/components/canvas/motion";

const HIGHLIGHT = "acute-find";

type HighlightRegistry = { set(name: string, h: unknown): void; delete(name: string): void };
function highlights(): HighlightRegistry | null {
  const css = (globalThis as { CSS?: { highlights?: HighlightRegistry } }).CSS;
  return css?.highlights ?? null;
}

/**
 * Adds the highlight's style once. It lives here rather than in globals.css
 * because Turbopack's CSS parser rejects `::highlight()` (a valid selector).
 */
function ensureHighlightStyle() {
  const id = `${HIGHLIGHT}-style`;
  if (document.getElementById(id)) return;
  const style = document.createElement("style");
  style.id = id;
  style.textContent = `::highlight(${HIGHLIGHT}) { background-color: #ffe066; color: inherit; }`;
  document.head.appendChild(style);
}

/** Highlights `query` inside rendered Acute text on screen. */
function paintHighlights(query: string) {
  const registry = highlights();
  const HighlightCtor = (globalThis as { Highlight?: new (...ranges: Range[]) => unknown }).Highlight;
  if (!registry || !HighlightCtor) return;
  ensureHighlightStyle();
  registry.delete(HIGHLIGHT);
  const q = query.trim().toLowerCase();
  if (!q) return;
  const ranges: Range[] = [];
  for (const root of document.querySelectorAll(".acute-block__content")) {
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      const text = n.textContent?.toLowerCase() ?? "";
      for (let i = text.indexOf(q); i >= 0; i = text.indexOf(q, i + q.length)) {
        const r = document.createRange();
        r.setStart(n, i);
        r.setEnd(n, i + q.length);
        ranges.push(r);
      }
    }
  }
  if (ranges.length) registry.set(HIGHLIGHT, new HighlightCtor(...ranges));
}

async function collectSources(api: ExcalidrawImperativeAPI): Promise<SearchSource[]> {
  const store = getDocumentStore();
  const out: SearchSource[] = [];
  const loads: Promise<void>[] = [];
  const rich: { elementId: string; documentId: string; page: boolean }[] = [];
  for (const el of api.getSceneElements()) {
    if (el.type === "text") {
      const t = el as ExcalidrawTextElement;
      out.push({ elementId: t.containerId ?? t.id, kind: "text", text: t.originalText || t.text });
    } else if (el.type === "embeddable") {
      const ref = getEmbedRef(el);
      if (ref?.kind === "rich-block") {
        rich.push({ elementId: el.id, documentId: ref.documentId, page: false });
        loads.push(store.load(ref.documentId));
      } else if (ref?.kind === "page-preview") {
        rich.push({ elementId: el.id, documentId: ref.pageId, page: true });
        loads.push(store.load(ref.pageId));
      }
    }
  }
  await Promise.all(loads);
  for (const r of rich) {
    const rec = store.get(r.documentId);
    if (!rec) continue;
    // A page preview matches on its title as well as its content.
    const text = r.page ? [rec.title, toPlainText(rec.snapshot)].filter(Boolean).join("\n") : toPlainText(rec.snapshot);
    out.push({ elementId: r.elementId, kind: "rich", text });
  }
  return out;
}

export function FindOverlay({ api, onClose }: { api: ExcalidrawImperativeAPI; onClose: () => void }) {
  const [query, setQuery] = useState("");
  const [sources, setSources] = useState<SearchSource[]>([]);
  const [index, setIndex] = useState(0);
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    input.current?.focus();
    void collectSources(api).then(setSources);
    return () => highlights()?.delete(HIGHLIGHT);
  }, [api]);

  const results = useMemo(() => searchSources(sources, query), [sources, query]);
  const current = results.length ? results[Math.min(index, results.length - 1)] : undefined;

  // Select + reveal the current result; repaint highlights once it is on screen.
  useEffect(() => {
    if (!current) {
      paintHighlights(query);
      return;
    }
    const el = api.getSceneElements().find((e) => e.id === current.elementId);
    if (el) {
      api.updateScene({ appState: { selectedElementIds: { [el.id]: true } }, captureUpdate: CaptureUpdateAction.NEVER });
      api.scrollToContent(el, { animate: !prefersReducedMotion(), duration: 250 });
    }
    const t = setTimeout(() => paintHighlights(query), 320);
    return () => clearTimeout(t);
  }, [api, current, query]);

  const step = (d: 1 | -1) => results.length && setIndex((i) => (i + d + results.length) % results.length);

  return (
    <div className="acute-find" role="search">
      <input
        ref={input}
        type="search"
        aria-label="Find on canvas"
        placeholder="Find on canvas"
        value={query}
        onChange={(e) => {
          setQuery(e.target.value);
          setIndex(0);
        }}
        onKeyDown={(e) => {
          e.stopPropagation();
          if (e.key === "Enter") {
            e.preventDefault();
            step(e.shiftKey ? -1 : 1);
          } else if (e.key === "Escape") {
            e.preventDefault();
            onClose();
          }
        }}
      />
      <span className="acute-find__count" aria-live="polite">
        {query.trim() ? (results.length ? `${Math.min(index, results.length - 1) + 1} of ${results.length}` : "No results") : ""}
      </span>
      <button type="button" aria-label="Previous result" disabled={!results.length} onClick={() => step(-1)}>
        ↑
      </button>
      <button type="button" aria-label="Next result" disabled={!results.length} onClick={() => step(1)}>
        ↓
      </button>
      <button type="button" aria-label="Close find" onClick={onClose}>
        ✕
      </button>
      {results.length > 0 && (
        <ul className="acute-find__results">
          {results.slice(0, 8).map((r, i) => (
            <li key={r.elementId}>
              <button type="button" aria-current={r === current || undefined} onClick={() => setIndex(i)}>
                <span className="acute-find__kind">{r.kind === "rich" ? "Aa" : "T"}</span>
                <span className="acute-find__snippet">
                  {r.snippet.before}
                  <mark>{r.snippet.match}</mark>
                  {r.snippet.after}
                </span>
                {r.count > 1 && <span className="acute-find__n">×{r.count}</span>}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
