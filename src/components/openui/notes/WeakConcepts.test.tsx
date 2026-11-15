// @vitest-environment happy-dom
/**
 * The Weak list (`WeakConcepts.tsx`, study-mode plan §5, §7): rendered from stored records and a fixed `now`, so the list
 * is reproducible. Ranking, groups, retired toggle, local concepts, related context and the links back. No store, no model.
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { LoadedConcept, StudyConceptRecord } from "@/ai/study/store";
import { ago, WeakConcepts, type StudyCardRef, type WeakConceptsProps } from "./WeakConcepts";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const DAY = 24 * 60 * 60 * 1000;
const NOW = 100 * DAY;
let host: HTMLDivElement;
let root: Root;
beforeEach(() => {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

const loaded = (key: string, shardId: string, record: StudyConceptRecord): [string, LoadedConcept] => [key, { key, shardId, record }];
const STUDY = new Map<string, LoadedConcept>([
  // low accuracy (rule a): ranks first
  loaded("c:s1:u2", "s1", { title: "Purge (stored)", attempts: [[NOW - 3 * DAY, "q", 0, 0], [NOW - 2 * DAY, "q", 0, 0]], units: ["u2"], sourceVersion: 2, related: [{ key: "c:s1:u2+u3", rel: "split_from" }] }),
  // last wrong only (rule b), from a card under review
  loaded("c:s1:u1", "s1", { title: "Stale", attempts: [[NOW - DAY, "q", 1, 1], [NOW - DAY, "q", 1, 1], [NOW - DAY / 2, "q", 0, 1]], units: ["u1"], sourceVersion: 2, state: "source_changed" }),
  loaded("c:s1:u2+u3", "s1", { title: "Pair", attempts: [[NOW - 9 * DAY, "q", 1, 0], [NOW - 9 * DAY, "q", 0, 0], [NOW - 9 * DAY, "q", 1, 0]], units: ["u2", "u3"], sourceVersion: 2 }),
  // a local concept, weak, no card teaches it now
  loaded("l:cv1:el9", "local:cv1", { title: "My own card", attempts: [[NOW - 60_000 * 5, "f", 0, 0]] }),
  loaded("c:s1:u7", "s1", { title: "Gone", attempts: [[NOW - DAY, "q", 0, 0]], units: ["u7"], sourceVersion: 1, state: "retired" }),
  loaded("c:s1:u8", "s1", { title: "Fine", attempts: [[NOW - DAY, "q", 1, 0]], units: ["u8"], sourceVersion: 2 }),
]);
const CARDS: StudyCardRef[] = [
  { id: "n2", title: "Purge on deploy", conceptKey: "c:s1:u2", cites: ["u2"] },
  { id: "n1", title: "Stale edges", conceptKey: "c:s1:u1", cites: ["u1"], needsReview: "drops the 300 seconds" },
];

function render(over: Partial<WeakConceptsProps> = {}) {
  const props: WeakConceptsProps = {
    study: STUDY,
    cards: CARDS,
    now: NOW,
    unitText: (sourceId, version, u) => (sourceId === "s1" && version === 2 ? `passage ${u}` : undefined),
    openSource: vi.fn(),
    showCiting: vi.fn(),
    quizOn: vi.fn(),
    ...over,
  };
  act(() => root.render(<WeakConcepts {...props} />));
  return props;
}
const rows = () => [...host.querySelectorAll<HTMLElement>('[data-testid="acute-notes-weak-row"]')];
const btn = (label: string, from: ParentNode = host) => [...from.querySelectorAll<HTMLButtonElement>("button")].find((b) => b.textContent === label);
const click = (el: HTMLElement | undefined) => act(() => el!.click());

describe("WeakConcepts", () => {
  it("lists weak concepts in rank order (low accuracy first), under-review ones in their own group; retired and strong never weak", () => {
    render();
    expect(rows().map((r) => r.dataset.concept)).toEqual(["c:s1:u2", "l:cv1:el9", "c:s1:u1"]);
    expect(rows()[2]!.closest('[aria-label="From cards that need review"]')).not.toBeNull();
    expect(host.textContent).toContain("Checked against the source by rules, not by AI");
    expect(host.textContent).toContain("3 weak concepts");
  });

  it("shows the live title, band, mastery, attempts, last attempt, state and review badges", () => {
    render();
    const [purge, , stale] = rows();
    expect(purge!.querySelector(".acute-notes__weak-title")!.textContent).toBe("Purge on deploy");
    expect(purge!.querySelector("[data-band]")!.textContent).toBe("Weak");
    expect(purge!.textContent).toContain("2 attempts · last 2 days ago, missed · often missed");
    expect(purge!.textContent).toMatch(/Mastery \d+%/);
    expect(stale!.textContent).toContain("Source changed since you studied this");
    expect(stale!.textContent).toContain("Card needs review");
    expect(stale!.textContent).toContain("missed last time");
  });

  it("shows related context as display only (another concept's attempts)", () => {
    render();
    expect(rows()[0]!.querySelector('[data-related="split_from"]')!.textContent).toBe("Studied before as part of ‘Pair’ (2/3)");
  });

  it("links back: passage chips expand, Open in source with a live card, Show citing cards, Quiz me on these", () => {
    const props = render();
    const purge = rows()[0]!;
    click(purge.querySelector<HTMLElement>('.openui-citation-chip[data-unit="u2"]')!);
    expect(purge.querySelector(".openui-idea-card__passage")!.textContent).toBe("passage u2");
    click(btn("Open in source", purge));
    expect(props.openSource).toHaveBeenCalledWith("n2", ["u2"]);
    click(btn("Show citing cards", purge));
    expect(props.showCiting).toHaveBeenCalledWith("s1", ["u2"]);
    click(btn("Quiz me on these"));
    expect(props.quizOn).toHaveBeenCalledWith(["n2", "n1"]);
  });

  it("a local concept shows without passages or source links, and says no card teaches it now", () => {
    render();
    const mine = rows()[1]!;
    expect(mine.querySelector(".openui-citation-chip")).toBeNull();
    expect(btn("Show citing cards", mine)).toBeUndefined();
    expect(mine.textContent).toContain("no card teaches this now");
    expect(mine.textContent).toContain("5 minutes ago");
  });

  it("hides retired concepts behind Show retired (n)", () => {
    render();
    expect(host.querySelector('[data-retired="true"]')).toBeNull();
    click(btn("Show retired (1)"));
    expect(host.querySelector('[data-retired="true"]')!.textContent).toContain("Gone");
    click(btn("Hide retired"));
    expect(host.querySelector('[data-retired="true"]')).toBeNull();
  });

  it("is reproducible: the same records and now give the same list", () => {
    render();
    const first = host.innerHTML;
    render({ study: new Map(STUDY) });
    expect(host.innerHTML).toBe(first);
  });

  it("formats relative times", () => {
    expect([ago(0), ago(60_000), ago(3 * 3_600_000), ago(DAY), ago(2 * DAY)]).toEqual(["just now", "1 minute ago", "3 hours ago", "1 day ago", "2 days ago"]);
  });

  it("offers 'Clear study history' only when the host provides it and there is history; the host does the clearing", () => {
    render();
    expect(btn("Clear study history")).toBeUndefined();
    const clearHistory = vi.fn();
    render({ clearHistory, study: new Map() });
    expect(btn("Clear study history")).toBeUndefined();
    render({ clearHistory });
    act(() => btn("Clear study history")!.click());
    expect(clearHistory).toHaveBeenCalledTimes(1);
  });
});
