// @vitest-environment happy-dom
/**
 * User decision 2 (2026-11-15): a whole-block proposal (`update_block`, e.g. from MCP) must "Require a clear
 * before/after diff" in review — not only when it conflicts.
 */
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { ProposedChange } from "@/ai/changes/changeSet";
import { BlockUpdateDiffs, blockUpdateDiffs } from "./BlockUpdateDiffs";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;
beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

const changes: ProposedChange[] = [
  { kind: "update_block", target: "card", content: [{ type: "paragraph", content: "Retries happen three times." }, { type: "paragraph", content: "Calls are logged." }], expectedFingerprint: "c1" },
  { kind: "update_node", target: "n", semantics: { status: "done" } },
  { kind: "update_shape", target: "s", label: "New", stableNodeKey: "k" },
];
const now = new Map([["card", "Retries happen five times.\n\nCalls are logged."]]);

describe("BlockUpdateDiffs", () => {
  it("lists every clean update_block (not other kinds) with its text now and as proposed", () => {
    const diffs = blockUpdateDiffs(changes, (t) => now.get(t) ?? null);
    expect(diffs).toEqual([{ target: "card", name: "Retries happen three times.", before: "Retries happen five times.\n\nCalls are logged.", after: "Retries happen three times.\n\nCalls are logged." }]);
  });

  it("shows a non-conflict update_block in review, collapsed, with View changes revealing the before/after diff", () => {
    act(() => root.render(createElement(BlockUpdateDiffs, { diffs: blockUpdateDiffs(changes, (t) => now.get(t) ?? null) })));
    const item = container.querySelector('[aria-label="Update: Retries happen three times."]')!;
    expect(item).not.toBeNull();
    expect(item.textContent).toContain("Replaces this block's content: +1 −1 lines");
    expect(container.querySelector(".acute-review__diff")).toBeNull(); // collapsed by default
    const view = [...item.querySelectorAll("button")].find((b) => b.textContent === "View changes")!;
    expect(view.getAttribute("aria-expanded")).toBe("false");
    act(() => view.click());
    const diff = container.querySelector('[aria-label="Before and after: Retries happen three times."]')!;
    expect([...diff.querySelectorAll(".acute-review__diff-line--del")].map((l) => l.textContent?.trim())).toEqual(["− Retries happen five times."]);
    expect([...diff.querySelectorAll(".acute-review__diff-line--add")].map((l) => l.textContent?.trim())).toEqual(["+ Retries happen three times."]);
    expect([...diff.querySelectorAll(".acute-review__diff-line--same")].map((l) => l.textContent?.trim())).toContain("Calls are logged.");
    expect(view.textContent).toBe("Hide changes");
    act(() => view.click());
    expect(container.querySelector(".acute-review__diff")).toBeNull();
  });

  it("renders nothing without an update_block", () => {
    act(() => root.render(createElement(BlockUpdateDiffs, { diffs: blockUpdateDiffs(changes.slice(1), () => null) })));
    expect(container.innerHTML).toBe("");
  });
});
