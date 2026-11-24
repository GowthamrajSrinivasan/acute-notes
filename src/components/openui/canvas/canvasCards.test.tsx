// @vitest-environment happy-dom
/**
 * The canvas's "Cards" view (`.ai/docs/openui/openui-canvas-rendering-plan-2026-11-16.md` steps 4–5), rendered offline
 * through the real `InactiveView`, card library and `Renderer`: which blocks draw as OpenUI cards, the fallbacks, the
 * citation chip's passage and "Open in source", and that drawing a card writes nothing.
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { layoutFor } from "@/ai/openui/cardLayout";
import { InactiveView, type InactiveCard } from "@/components/blocks/InactiveView";
import type { RichContent } from "@/domain/types";
import { canvasCards, NO_CARD_INFO, NO_CARDS_HOST, type CanvasCardInfo } from "./canvasCardsStore";

const setLayout = vi.hoisted(() => vi.fn(async () => true));
vi.mock("@/state/documents", () => ({ getDocumentStore: () => ({ setLayout }) }));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const p = (text: string) => ({ type: "paragraph" as const, content: text });
const CONTENT: RichContent = [p("Purge on deploy"), p("Deploys purge the CDN by surrogate key.")];
const INFO: CanvasCardInfo = { cites: ["u1", "u2"], needsReview: "condition dropped", passages: new Map([["u1", "Deploys purge the CDN by surrogate key."]]) };

let root: Root;
let host: HTMLDivElement;
const opened: [string, string[]][] = [];
const cardHost = { openSource: (id: string, us: readonly string[]) => void opened.push([id, [...us]]) };

beforeEach(() => {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  opened.length = 0;
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
  canvasCards.clear();
});

async function draw(props: Partial<Parameters<typeof InactiveView>[0]>) {
  await act(async () => {
    root.render(<InactiveView content={CONTENT} placeholder="Empty" display="cards" theme="light" {...props} />);
  });
  // The OpenUI card is lazy (its Suspense fallback is the Compact preview): when a card should draw, wait for its chunk.
  const drawsCard = !!props.card && (props.display ?? "cards") === "cards" && (props.content ?? CONTENT).length > 0;
  for (let i = 0; i < 300 && drawsCard && !host.querySelector("[data-testid=acute-openui-card]"); i++) await act(async () => new Promise((r) => setTimeout(r, 10)));
}

const card = (info: CanvasCardInfo = INFO) => ({ elementId: "el1", title: "Purge on deploy", data: { info, host: cardHost } });

describe("InactiveView in the Cards view", () => {
  it("draws a source-citing AI card as an IdeaCard with its chips and Needs review callout", async () => {
    await draw({ card: card() });
    const article = host.querySelector(".openui-idea-card")!;
    expect(article).not.toBeNull();
    expect(article.getAttribute("data-note-id")).toBe("el1");
    expect(article.querySelector(".openui-idea-card__title")!.textContent).toBe("Purge on deploy");
    expect([...article.querySelectorAll(".openui-citation-chip")].map((c) => c.getAttribute("data-unit"))).toEqual(["u1", "u2"]);
    expect(article.querySelector(".openui-callout")!.textContent).toContain("Needs review: condition dropped");
  });

  it("a chip expands its passage, and Open in source goes to the canvas card with the cited units", async () => {
    await draw({ card: card() });
    const chip = host.querySelector<HTMLButtonElement>('button.openui-citation-chip[data-unit="u1"]')!;
    await act(async () => chip.click());
    expect(host.querySelector(".openui-idea-card__passage")!.textContent).toContain("Deploys purge the CDN by surrogate key.");
    const open = [...host.querySelectorAll<HTMLButtonElement>(".openui-idea-card__action")].find((b) => /source/i.test(b.textContent ?? ""))!;
    await act(async () => open.click());
    expect(opened).toEqual([["el1", ["u1", "u2"]]]);
  });

  it("a button's pointerdown never reaches the canvas (no drag starts)", async () => {
    await draw({ card: card() });
    // Excalidraw's own pointer handlers sit above the React root (document/window), so that is where it must not arrive.
    const seen: string[] = [];
    const onDoc = () => seen.push("canvas");
    document.addEventListener("pointerdown", onDoc);
    try {
      host.querySelector<HTMLButtonElement>("button.openui-citation-chip")!.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }));
      expect(seen).toEqual([]);
      // Control: the same event from outside the card does reach it.
      host.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }));
      expect(seen).toEqual(["canvas"]);
    } finally {
      document.removeEventListener("pointerdown", onDoc);
    }
  });

  it("falls back to Compact: no card data (a manual card), empty content, other display modes", async () => {
    await draw({});
    expect(host.querySelector("[data-testid=acute-openui-card]")).toBeNull();
    expect(host.querySelector(".acute-preview")).not.toBeNull();

    await draw({ card: card(), content: [] });
    expect(host.querySelector("[data-testid=acute-openui-card]")).toBeNull();

    await draw({ card: card(), display: "compact" });
    expect(host.querySelector("[data-testid=acute-openui-card]")).toBeNull();
  });
});

describe("stored layouts and modes (note-taking modes Step 3)", () => {
  const STORED = `root = IdeaCard("Stored layout title", "Drawn from the stored layout.")`;
  const current = () => layoutFor({ title: "Purge on deploy", snapshot: CONTENT }, STORED);
  const plain = (extra: Partial<InactiveCard> = {}): InactiveCard => ({
    elementId: "el1",
    documentId: "doc1",
    title: "Purge on deploy",
    data: { info: NO_CARD_INFO, host: NO_CARDS_HOST },
    noteMode: "manual",
    ...extra,
  });
  const titleShown = () => host.querySelector(".openui-idea-card__title")?.textContent;
  const drawn = () => host.querySelector<HTMLElement>("[data-testid=acute-openui-card]");

  it("draws a current stored layout instead of the derived card, in manual mode, with no citations", async () => {
    await draw({ card: plain({ layout: current() }) });
    expect(drawn()?.dataset.layout).toBe("stored");
    expect(titleShown()).toBe("Stored layout title");
    expect(host.querySelector("[data-testid=acute-layout-stale]")).toBeNull();
  });

  it("a stale layout: the card is drawn from its text, with the out-of-date chip; Remove layout clears only the layout", async () => {
    const stale = { ...current(), contentHash: "an-older-text" };
    await draw({ card: plain({ layout: stale }) });
    expect(drawn()?.dataset.layout).toBe("derived");
    expect(titleShown()).toBe("Purge on deploy");
    const chip = host.querySelector("[data-testid=acute-layout-stale]")!;
    expect(chip.textContent).toContain("Layout out of date");
    const button = (name: string) => [...host.querySelectorAll("[data-testid=acute-layout-stale] button")].find((b) => b.textContent === name) as HTMLButtonElement | undefined;
    // "Ask AI to refresh" (Step 7) only asks first: a confirmation, no AI call; Cancel returns to the chip.
    expect(button("Ask AI to refresh")).toBeDefined();
    await act(async () => button("Ask AI to refresh")!.click());
    expect(host.querySelector("[data-testid=acute-layout-stale]")!.textContent).toContain("Refresh with AI? One request; you review it first.");
    await act(async () => button("Cancel")!.click());
    await act(async () => button("Remove layout")!.click());
    expect(setLayout).toHaveBeenCalledWith("doc1", null);
  });

  it("a stored layout that doesn't parse falls back to the derived card", async () => {
    await draw({ card: plain({ layout: { ...current(), lang: `root = NoSuchComponent(` } }) });
    for (let i = 0; i < 100 && drawn()?.dataset.layout !== "derived"; i++) await act(async () => new Promise((r) => setTimeout(r, 10)));
    expect(drawn()?.dataset.layout).toBe("derived");
    expect(titleShown()).toBe("Purge on deploy");
  });

  it("AI-managed: an uncited card draws as a derived card; manual: it stays Compact (D5)", async () => {
    await draw({ card: plain({ noteMode: "ai" }) });
    expect(drawn()?.dataset.layout).toBe("derived");
    expect(titleShown()).toBe("Purge on deploy");

    // Nothing is drawn here, so render without `draw`'s wait for a card; give the lazy chunk time to resolve anyway.
    await act(async () => {
      root.render(<InactiveView content={CONTENT} placeholder="Empty" display="cards" theme="light" card={plain({ noteMode: "manual" })} />);
    });
    await act(async () => new Promise((r) => setTimeout(r, 300)));
    expect(drawn()).toBeNull();
    expect(host.querySelector(".acute-preview")).not.toBeNull();
  });

  it("the store keeps the canvas's mode when the Cards view is left, and drops it when the canvas closes", () => {
    canvasCards.setNoteMode("ai");
    canvasCards.publish(new Map([["a", INFO]]), cardHost);
    canvasCards.clearCards();
    expect(canvasCards.get("a")).toBeNull();
    expect(canvasCards.noteMode()).toBe("ai");
    canvasCards.clear();
    expect(canvasCards.noteMode()).toBe("manual");
  });
});

describe("canvasCards store", () => {
  it("keeps a card's object when its data didn't change, and replaces it when it did", () => {
    canvasCards.publish(new Map([["a", INFO]]), cardHost);
    const first = canvasCards.get("a");
    canvasCards.publish(new Map([["a", { ...INFO, passages: new Map(INFO.passages) }]]), cardHost);
    expect(canvasCards.get("a")).toBe(first);
    canvasCards.publish(new Map([["a", { ...INFO, needsReview: undefined }]]), cardHost);
    expect(canvasCards.get("a")).not.toBe(first);
    canvasCards.clear();
    expect(canvasCards.get("a")).toBeNull();
  });
});
