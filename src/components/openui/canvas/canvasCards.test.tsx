// @vitest-environment happy-dom
/**
 * The canvas's "Cards" view (`.ai/docs/openui/openui-canvas-rendering-plan-2026-11-16.md` steps 4–5), rendered offline
 * through the real `InactiveView`, card library and `Renderer`: which blocks draw as OpenUI cards, the fallbacks, the
 * citation chip's passage and "Open in source", and that drawing a card writes nothing.
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { InactiveView } from "@/components/blocks/InactiveView";
import type { RichContent } from "@/domain/types";
import { canvasCards, type CanvasCardInfo } from "./canvasCardsStore";

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
