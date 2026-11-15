// @vitest-environment happy-dom
import { act, createElement, useState, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { OutcomeSummary, SectionOutcome } from "./OutcomeChips";
import { ReviewQueue, type ReviewQueueProps } from "./ReviewQueue";
import { SourceChip } from "./SourceChip";
import { buildReviewQueue, type ReviewItem } from "./queue";
import { outcomeTotals, sectionOutcomeChips } from "./sectionChips";
import { stubReview } from "./stubData";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

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

const render = (el: ReactElement) => act(() => root.render(el));
const $$ = (sel: string) => [...host.querySelectorAll<HTMLElement>(sel)];
const button = (label: string) => $$("button").find((b) => b.textContent?.trim() === label || b.getAttribute("aria-label") === label);
const click = (el: HTMLElement | undefined) => {
  expect(el).toBeTruthy();
  act(() => el!.dispatchEvent(new MouseEvent("click", { bubbles: true })));
};

describe("SourceChip", () => {
  it("opens the source on the cited passages; amber while flagged; nothing without citations", () => {
    const onOpen = vi.fn();
    render(createElement(SourceChip, { cites: ["u1", "u2", "u2"], review: { reasons: ["condition changed: x"] }, onOpen }));
    const chip = host.querySelector<HTMLButtonElement>(".acute-kn-chip")!;
    expect(chip.textContent).toBe("2 sources");
    expect(chip.className).toContain("acute-kn-chip--review");
    click(chip);
    expect(onOpen).toHaveBeenCalledWith(["u1", "u2"]);

    render(createElement(SourceChip, { cites: ["u1"], available: false }));
    expect(host.querySelector(".acute-kn-chip--unavailable")).toBeTruthy();
    expect(host.querySelector<HTMLButtonElement>(".acute-kn-chip")!.disabled).toBe(true);

    render(createElement(SourceChip, { cites: [] }));
    expect(host.querySelector(".acute-kn-chip")).toBeNull();
  });
});

describe("OutcomeChips", () => {
  it("renders section counts and the bar totals with the model-tier warning", () => {
    const { sections, labels } = stubReview();
    const chip = sectionOutcomeChips(sections, labels)[0]!;
    render(createElement("div", null, createElement(SectionOutcome, { chip }), createElement(OutcomeSummary, { totals: outcomeTotals(sections, { weakModel: true }) })));
    expect(host.querySelector('[role="note"]')!.getAttribute("aria-label")).toBe("Section Caching: 2 represented · 1 omitted · 1 needs review");
    expect(host.querySelector(".acute-kn-counts__review")!.textContent).toContain("1 needs review");
    expect(host.textContent).toContain("4 represented · 1 omitted · 4 need review");
    expect(host.textContent).toContain("This model may drop conditions");
  });
});

describe("ReviewQueue (U3)", () => {
  let setItems: (items: ReviewItem[]) => void = () => {};
  /** The integrator's side: stores decisions and drops resolved items (Edit resolves only on save). */
  function Harness(props: Omit<ReviewQueueProps, "items">) {
    const [items, set] = useState(() => buildReviewQueue(stubReview()));
    setItems = set;
    return createElement(ReviewQueue, {
      ...props,
      items,
      onDecide: (d) => {
        props.onDecide(d);
        if (d.resolution) set(items.filter((i) => i.key !== d.key));
      },
    });
  }

  it("steps through every item and each action resolves it", () => {
    const onDecide = vi.fn();
    const onShow = vi.fn();
    const onClose = vi.fn();
    render(createElement(Harness, { onDecide, onShow, onClose }));
    click(button("Review 4"));
    expect(host.textContent).toContain("Needs review 1 of 4");
    expect(onShow).toHaveBeenLastCalledWith(expect.objectContaining({ key: "card:c1" }));
    // Card and passage side by side, with what the rule compared marked.
    expect($$('section[aria-label="Card"]')).toHaveLength(1);
    expect(host.querySelector('section[aria-label="Source"] mark')!.textContent).toBe("only when the cache contains a valid result");
    expect(host.querySelector('section[aria-label="Card"] mark')!.textContent).toBe("always served from the cache");

    click(button("Edit"));
    expect(onDecide).toHaveBeenLastCalledWith(expect.objectContaining({ action: "edit", card: "c1" }));
    expect(host.textContent).toContain("Needs review 1 of 4"); // stays until the card is saved

    click(button("Next ›"));
    expect(host.textContent).toContain("Needs review 2 of 4");
    click(button("Previous item"));
    click(button("Keep"));
    expect(onDecide).toHaveBeenLastCalledWith(expect.objectContaining({ resolution: "kept" }));
    expect(host.textContent).toContain("Needs review 1 of 3");
    expect(onShow).toHaveBeenLastCalledWith(expect.objectContaining({ key: "unit:u7" }));
    expect($$('section[aria-label="Card"]')).toHaveLength(0);

    click(button("Dismiss"));
    click(button("Include"));
    expect(host.textContent).toContain("Needs review 1 of 1");
    expect(button("Dismiss")).toBeUndefined(); // not processed: Include only
    click(button("Include"));
    expect(onDecide.mock.calls.map(([d]) => d.resolution)).toEqual([undefined, "kept", "dismissed", "included", "included"]);
    expect(host.textContent).toBe("");
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("shows the model-tier warning while walking and stops on Done", () => {
    const onClose = vi.fn();
    render(createElement(Harness, { onDecide: vi.fn(), weakModel: true, defaultOpen: true, onClose }));
    expect(host.textContent).toContain("This model may drop conditions");
    click(button("Done"));
    expect(onClose).toHaveBeenCalled();
    expect(button("Review 4")).toBeTruthy();
    act(() => setItems([]));
    expect(host.textContent).toBe("");
  });
});
