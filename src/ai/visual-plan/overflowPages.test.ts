/**
 * Overflow pages (audit 2026-10-11, readability only; the node limits are unchanged): a "More from this section" page names its section, and a
 * fenced code block is not split across the pages of one section. Pure; no model.
 */
import { describe, expect, it } from "vitest";
import { fenceMask } from "@/ai/content/fences";
import { chunkText, foldOverflow } from "./repair";
import { TEXT_LIMITS } from "./schema";
import { templateFor } from "./templates";
import type { VisualNode } from "./types";

const caps = { plan: 0, section: 0, sectionedPlan: 0 };
const text = (id: string, markdown: string, over: Partial<VisualNode> = {}) => ({ id, type: "text", content: { markdown }, ...over }) as VisualNode;
const pagesOf = (nodes: VisualNode[]) => nodes.filter((n) => n.type === "page") as Extract<VisualNode, { type: "page" }>[];
/** Fence lines open and close in pairs: an odd count means a code block was cut. */
const fenceLines = (md: string) => md.split("\n").filter((l) => /^\s*(```|~~~)/.test(l)).length;
const squash = (s: string) => s.replace(/\s+/g, "");

describe("page titles name their section", () => {
  it("a flat sectioned plan (a merge): the last heading of the section's first unit", () => {
    const keyed = (section: string, n: number) => text(`n${n}`, `Card ${n}.`, { stableKey: `${section} § card#${n}` });
    const { nodes, details } = foldOverflow([keyed("Chat › Pricing ideas", 1), keyed("Chat › Pricing ideas", 2)], templateFor("sectioned"), caps);
    expect(pagesOf(nodes).map((p) => p.content.title)).toEqual(["More from this section — Pricing ideas"]);
    expect(details[0]).toMatchObject({ folded: 2, pages: 1 });
  });

  it("a section made of several units is named for the first; a split-part or repeat suffix is not part of the name", () => {
    const keyed = (section: string) => text("n1", "Card.", { stableKey: `${section} § card#1` });
    const title = (section: string) => pagesOf(foldOverflow([keyed(section)], templateFor("sectioned"), caps).nodes)[0]!.content.title;
    expect(title("Chat › Topic ·2 ⨁ Chat › Other")).toBe("More from this section — Topic");
    expect(title("Chat › Topic #2")).toBe("More from this section — Topic");
    expect(title("Only a heading")).toBe("More from this section — Only a heading");
  });

  it("a framed section (a first run's plan): its frame's label", () => {
    const group = { id: "g0", type: "group", content: { label: "Pricing", arrangement: "grid" } } as unknown as VisualNode;
    const { nodes } = foldOverflow([group, text("a", "One.", { parent: "g0" }), text("b", "Two.", { parent: "g0" })], templateFor("sectioned"), caps);
    expect(pagesOf(nodes).map((p) => p.content.title)).toEqual(["More from this section — Pricing"]);
  });

  it("a plan without sections keeps the plain title, and a very long section name is clipped under the title limit", () => {
    expect(pagesOf(foldOverflow([text("a", "One.")], templateFor("sectioned"), { plan: 0, section: 0, sectionedPlan: 0 }).nodes)[0]!.content.title).toBe("More from this section");
    const long = "x".repeat(500);
    const title = pagesOf(foldOverflow([text("a", "One.", { stableKey: `Chat › ${long} § k` })], templateFor("sectioned"), caps).nodes)[0]!.content.title;
    expect(title.length).toBeLessThanOrEqual(TEXT_LIMITS.title);
    expect(title.startsWith("More from this section — xxx")).toBe(true);
  });

  it("a section that needs several pages numbers them, so they can be told apart", () => {
    const cards = Array.from({ length: 60 }, (_, i) => text(`n${i}`, `${"word ".repeat(100)}${i}`, { stableKey: `Chat › Long topic § card#${i}` }));
    const pages = pagesOf(foldOverflow(cards, templateFor("sectioned"), caps).nodes);
    expect(pages.length).toBeGreaterThan(1);
    pages.forEach((p, i) => expect(p.content.title).toBe(`More from this section — Long topic (${i + 1} of ${pages.length})`));
    expect(new Set(pages.map((p) => p.id)).size).toBe(pages.length);
  });
});

describe("a fenced code block is not split across pages", () => {
  const CODE = ["```sh", ...Array.from({ length: 12 }, (_, i) => `step ${i}\n`), "make done", "```"].join("\n");

  it("chunkText with fenceSafe moves the cut to the paragraph break before the block; without it the block is cut", () => {
    const prose = Array.from({ length: 6 }, (_, i) => `Paragraph ${i} of ordinary prose, long enough to matter here.`).join("\n\n");
    const input = `${prose}\n\n${CODE}\n\nClosing words.`;
    const max = prose.length + 60; // the limit falls inside the code block
    const plain = chunkText(input, max);
    const safe = chunkText(input, max, { fenceSafe: true });
    expect(plain.some((c) => fenceLines(c) % 2 === 1)).toBe(true);
    expect(safe.every((c) => fenceLines(c) % 2 === 0)).toBe(true);
    expect(safe.length).toBeGreaterThan(1);
    expect(squash(safe.join(""))).toBe(squash(input));
    expect(safe.every((c) => c.length <= max)).toBe(true);
  });

  it("text without a fence is chunked exactly as before, with or without the option", () => {
    const input = Array.from({ length: 40 }, (_, i) => `Paragraph ${i} with some ordinary words in it.`).join("\n\n");
    expect(chunkText(input, 300, { fenceSafe: true })).toEqual(chunkText(input, 300));
  });

  it("a single code block longer than the limit still has to be cut (documented limit): nothing is lost", () => {
    const big = ["```sh", ...Array.from({ length: 60 }, (_, i) => `line ${i}\n`), "```"].join("\n");
    const chunks = chunkText(big, 200, { fenceSafe: true });
    expect(chunks.length).toBeGreaterThan(1);
    expect(squash(chunks.join(""))).toBe(squash(big));
  });

  it("through foldOverflow: a code card that straddles the page limit moves whole to the next page, with no rule inside it", () => {
    const fill = (i: number) => text(`n${i}`, `${"filler words ".repeat(90)}${i}`, { stableKey: `Chat › Topic § card#${i}` });
    // 16 cards fill about 18.9k characters of the first page; the code card (about 1.8k, blank lines inside) then crosses the 20k limit.
    const bigCode = ["```sh", ...Array.from({ length: 200 }, (_, i) => `step ${i}\n`), "make done", "```"].join("\n");
    const code = text("code", bigCode, { stableKey: "Chat › Topic § card#code" });
    const inputs = [...Array.from({ length: 16 }, (_, i) => fill(i)), code, fill(999)];
    const { nodes } = foldOverflow(inputs, templateFor("sectioned"), caps);
    const pages = pagesOf(nodes);
    expect(pages).toHaveLength(2);
    // The whole markdown puts the limit inside the code, so an unaware cut would have split it.
    const whole = inputs.map((n) => (n as { content: { markdown: string } }).content.markdown).join("\n\n---\n\n");
    expect(whole.indexOf("```sh")).toBeLessThan(TEXT_LIMITS.markdown);
    expect(whole.indexOf("make done")).toBeGreaterThan(TEXT_LIMITS.markdown);
    for (const p of pages) {
      expect(fenceLines(p.content.markdown) % 2).toBe(0);
      const lines = p.content.markdown.split("\n");
      const mask = fenceMask(lines);
      expect(lines.filter((l, i) => l === "---" && mask[i])).toEqual([]);
    }
    expect(pages.filter((p) => p.content.markdown.includes("make done"))).toHaveLength(1);
    expect(pages.filter((p) => p.content.markdown.includes("```sh"))).toHaveLength(1);
    expect(squash(pages.map((p) => p.content.markdown).join(""))).toBe(squash(whole));
  });
});

describe("overflow pages are identified by their section, not by their position", () => {
  const keyed = (section: string, n: number) => text(`n${n}`, `Card ${n}.`, { stableKey: `${section} § card#${n}` });
  const pageKeys = (nodes: VisualNode[]): string[] => pagesOf(nodes).map((p) => p.stableKey!);

  it("a page's key is its section's and its number, so pages of different sections never share one (they all used to be page#0, page#1, …)", () => {
    const { nodes } = foldOverflow([keyed("Chat › One", 1), keyed("Chat › Two", 2), keyed("Chat › Three", 3)], templateFor("sectioned"), caps);
    expect(pageKeys(nodes)).toEqual(["more~Chat › One~1", "more~Chat › Two~1", "more~Chat › Three~1"]);
    expect(new Set(pageKeys(nodes)).size).toBe(3);
    // The key has no section separator: nothing reads a page as a section's own node (frames, regrouping and orphan detection are unchanged).
    for (const k of pageKeys(nodes)) expect(k).not.toContain(" § ");
  });

  it("a section that already has a page (an earlier import's) gets its new page numbered after it, and an unrelated key never matters", () => {
    const existingPage = { id: "old", type: "page", stableKey: "more~Chat › One~1", content: { title: "More from this section — One", markdown: "earlier" } } as unknown as VisualNode;
    const legacy = { id: "legacy", type: "page", stableKey: "page#0", content: { title: "More from this section", markdown: "legacy" } } as unknown as VisualNode;
    const existing = [existingPage, legacy];
    const { nodes } = foldOverflow([existingPage, legacy, keyed("Chat › One", 1), keyed("Chat › Two", 2)], templateFor("sectioned"), { plan: 60, section: 60, sectionedPlan: 2 }, keysOf(existing));
    expect(pageKeys(nodes).filter((k) => k !== "more~Chat › One~1" && k !== "page#0").sort()).toEqual(["more~Chat › One~2", "more~Chat › Two~1"]);
    // The existing pages are kept untouched.
    expect(nodes.find((n) => n.id === "old")).toEqual(existingPage);
    expect(nodes.find((n) => n.id === "legacy")).toEqual(legacy);
  });

  it("the same section is the same section in a framed first-import plan and in a later flat one: the frame's key names it", () => {
    const frame = (stableKey: string) => ({ id: "g3", type: "group", stableKey, content: { label: "Pricing", arrangement: "grid" } }) as unknown as VisualNode;
    const first = foldOverflow([frame("Chat › Pricing § group#0"), text("a", "One.", { parent: "g3" }), text("b", "Two.", { parent: "g3" })], templateFor("sectioned"), caps);
    expect(pageKeys(first.nodes)).toEqual(["more~Chat › Pricing~1"]);
    const flat = foldOverflow([keyed("Chat › Pricing", 9)], templateFor("sectioned"), caps, new Set(pageKeys(first.nodes)));
    expect(pageKeys(flat.nodes)).toEqual(["more~Chat › Pricing~2"]);
    // A frame without a key falls back to its id; a plan without sections to "plan".
    expect(pageKeys(foldOverflow([{ id: "g1", type: "group", content: { label: "X", arrangement: "grid" } } as unknown as VisualNode, text("a", "One.", { parent: "g1" })], templateFor("sectioned"), caps).nodes)).toEqual(["more~g1~1"]);
    expect(pageKeys(foldOverflow([text("a", "One.")], templateFor("sectioned"), caps).nodes)).toEqual(["more~plan~1"]);
  });

  it("is deterministic, numbers a section's pages in order, and keeps a very long section key within the key limit", () => {
    const cards = Array.from({ length: 60 }, (_, i) => text(`n${i}`, `${"word ".repeat(100)}${i}`, { stableKey: `Chat › Long topic § card#${i}` }));
    const a = pageKeys(foldOverflow(cards, templateFor("sectioned"), caps).nodes);
    expect(a.length).toBeGreaterThan(1);
    expect(a).toEqual(a.map((_, i) => `more~Chat › Long topic~${i + 1}`));
    expect(pageKeys(foldOverflow(cards, templateFor("sectioned"), caps).nodes)).toEqual(a);
    const long = "x".repeat(600);
    const [key] = pageKeys(foldOverflow([keyed(`Chat › ${long}`, 1)], templateFor("sectioned"), caps).nodes);
    expect(key!.length).toBeLessThanOrEqual(300);
    expect(key).toMatch(/^more~.+~1$/);
  });
});

const keysOf = (nodes: VisualNode[]) => new Set(nodes.flatMap((n) => (n.stableKey ? [n.stableKey] : [])));
