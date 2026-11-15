// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SourcePanelProps } from "@/ai/fidelity/contracts";
import { SourcePanel } from "./SourcePanel";
import { spreadSelection, stubLongSourceData, stubSourcePanelData, withoutUnits } from "./stubData";

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

function render(props: SourcePanelProps) {
  act(() => root.render(createElement(SourcePanel, props)));
}
const $ = (sel: string) => host.querySelector<HTMLElement>(sel);
const $$ = (sel: string) => [...host.querySelectorAll<HTMLElement>(sel)];
const button = (label: string | RegExp) => $$("button").find((b) => (typeof label === "string" ? b.textContent?.trim() === label : label.test(b.textContent ?? "") || label.test(b.getAttribute("aria-label") ?? "")));
const click = (el: HTMLElement | undefined | null) => {
  expect(el).toBeTruthy();
  act(() => el!.dispatchEvent(new MouseEvent("click", { bubbles: true })));
};

describe("SourcePanel states", () => {
  it("shows loading and the unavailable message (U6)", () => {
    render({ state: { kind: "loading" }, selection: { units: [] } });
    expect(host.textContent).toContain("Loading source");
    render({ state: { kind: "unavailable" }, selection: { units: ["u1"] } });
    expect(host.textContent).toContain("Source not on this device");
    expect($$("a")).toHaveLength(0);
  });
});

describe("SourcePanel ready", () => {
  const data = stubSourcePanelData();

  it("highlights the selection, steps through it and shows the newer-version bar (U1)", () => {
    const onViewLatest = vi.fn();
    render({ state: { kind: "ready", data }, selection: { units: ["u8", "u2", "u5"] }, onViewLatest, reducedMotion: true });
    expect(host.textContent).toContain("Source updated since this card");
    click(button("View latest"));
    expect(onViewLatest).toHaveBeenCalled();

    expect($$(".acute-source__unit.is-selected").map((e) => e.dataset.unit)).toEqual(["u2", "u5", "u8"]);
    expect(host.textContent).toContain("Passage 1 of 3");
    expect($('[aria-current="true"]')?.dataset.unit).toBe("u2");
    click(button(/Next passage/));
    expect(host.textContent).toContain("Passage 2 of 3");
    expect($('[aria-current="true"]')?.dataset.unit).toBe("u5");
    click(button(/Previous passage/));
    click(button(/Previous passage/));
    expect(host.textContent).toContain("Passage 3 of 3");
  });

  it("lists what changed from the lineage and jumps to a changed passage", () => {
    render({ state: { kind: "ready", data }, selection: { units: [] }, reducedMotion: true });
    expect($("#acute-source-changes")).toBeNull();
    click(button("What changed"));
    const changes = $("#acute-source-changes")!;
    expect(changes.textContent).toContain("1 changed · 1 moved · 1 removed · 1 unclear · 1 added");
    expect(changes.textContent).toContain("Removed");
    expect(changes.textContent).toContain("As discussed last week.");
    // "Moved" names u7, in a folded section: jumping unfolds it and makes it the active passage.
    expect($('[data-unit="u7"]')).toBeNull();
    click($$("#acute-source-changes button").find((b) => b.textContent?.includes("Moved")));
    expect($('[data-unit="u7"]')?.classList.contains("is-active")).toBe(true);
  });

  it("marks outcomes with reasons and calls back on a passage", () => {
    const onSelectPassage = vi.fn();
    const onAddToCanvas = vi.fn();
    const onPinQuote = vi.fn();
    const onInclude = vi.fn();
    render({ state: { kind: "ready", data }, selection: { units: [] }, onSelectPassage, onAddToCanvas, onPinQuote, onInclude });
    const review = $('[data-unit="u3"]')!;
    expect(review.classList.contains("acute-source__unit--review")).toBe(true);
    expect(review.title).toContain("Needs review: condition changed");
    const omitted = $('[data-unit="u4"]')!;
    expect(omitted.classList.contains("acute-source__unit--omitted")).toBe(true);
    expect(omitted.title).toBe("Intentionally omitted: filler");
    const plain = $('[data-unit="u2"]')!;
    expect(plain.className).toBe("acute-source__unit");
    expect(plain.title).toBe("");

    click(plain);
    expect(onSelectPassage).toHaveBeenCalledWith(["u2"]);
    const bar = $(".acute-source__active")!;
    expect(bar.textContent).toContain("Represented");
    expect(bar.textContent).not.toContain("Include");
    click([...bar.querySelectorAll<HTMLElement>("button")].find((b) => b.textContent === "Add to canvas"));
    expect(onAddToCanvas).toHaveBeenCalledWith("u2");

    click(omitted);
    const include = [...$(".acute-source__active")!.querySelectorAll<HTMLElement>("button")].find((b) => b.textContent === "Include");
    click(include);
    expect(onInclude).toHaveBeenCalledWith("u4");
    click([...$(".acute-source__active")!.querySelectorAll<HTMLElement>("button")].find((b) => b.textContent === "Pin quote"));
    expect(onPinQuote).toHaveBeenCalledWith("u4");
  });

  it("falls back to 'not Represented' for Not on canvas without onCanvas", () => {
    render({ state: { kind: "ready", data: { ...data, onCanvas: undefined } }, selection: { units: [] } });
    const notOnCanvas = button(/^Not on canvas/)!;
    expect(notOnCanvas.textContent).toBe("Not on canvas 4");
    click(notOnCanvas);
    expect($$(".acute-source__item")).toHaveLength(4);
  });

  it("hides actions without a callback", () => {
    render({ state: { kind: "ready", data }, selection: { units: ["u4"] } });
    expect(button("Add to canvas")).toBeUndefined();
    expect(button("Include")).toBeUndefined();
    expect(button("View latest")).toBeUndefined();
  });

  it("filters to omitted passages with their reasons and Include (U2)", () => {
    const onInclude = vi.fn();
    render({ state: { kind: "ready", data }, selection: { units: [] }, onInclude });
    click(button(/^Omitted/));
    const items = $$(".acute-source__item");
    expect(items.map((i) => i.querySelector<HTMLElement>("[data-unit]")!.dataset.unit)).toEqual(["u4", "u9"]);
    expect(items[0]!.textContent).toContain("Intentionally omitted · filler");
    click([...items[1]!.querySelectorAll<HTMLElement>("button")].find((b) => b.textContent === "Include"));
    expect(onInclude).toHaveBeenCalledWith("u9");
    click(button(/^Needs review/));
    expect($$(".acute-source__item")).toHaveLength(2);
    const notOnCanvas = button(/^Not on canvas/)!;
    expect(notOnCanvas.textContent).toBe("Not on canvas 3");
    click(notOnCanvas);
    // u3 needs review but is cited, so it is on the canvas.
    expect($$(".acute-source__item").map((i) => i.querySelector<HTMLElement>("[data-unit]")!.dataset.unit)).toEqual(["u4", "u8", "u9"]);
  });

  it("folds sections with nothing selected or flagged, and the outline unfolds them", () => {
    render({ state: { kind: "ready", data }, selection: { units: [] }, reducedMotion: true });
    const heading = $$(".acute-source__body button.acute-source__heading").find((b) => b.textContent?.includes("Open questions"))!;
    expect(heading.getAttribute("aria-expanded")).toBe("false");
    expect($('[data-unit="u10"]')).toBeNull();
    click($$(".acute-source__outline button").find((b) => b.textContent?.includes("Open questions")));
    expect($('[data-unit="u10"]')).not.toBeNull();
    const again = $$(".acute-source__body button.acute-source__heading").find((b) => b.textContent?.includes("Open questions"))!;
    click(again);
    expect($('[data-unit="u10"]')).toBeNull();
  });

  it("highlights by span when the source has no units", () => {
    const bare = withoutUnits(data);
    const u5 = data.units.find((u) => u.id === "u5")!;
    render({ state: { kind: "ready", data: bare }, selection: { units: ["u5"], spans: [u5.span] } });
    const marks = $$("mark.is-selected");
    expect(marks.map((m) => m.textContent)).toEqual([u5.text]);
    expect($(".acute-source__filters")).toBeNull();
  });

  it("resets to the first passage when another card is selected", () => {
    render({ state: { kind: "ready", data }, selection: { units: ["u2", "u5"] } });
    click(button(/Next passage/));
    expect(host.textContent).toContain("Passage 2 of 2");
    render({ state: { kind: "ready", data }, selection: { units: ["u6", "u7", "u10"] } });
    expect(host.textContent).toContain("Passage 1 of 3");
    expect($('[aria-current="true"]')?.dataset.unit).toBe("u6");
  });
});

describe("SourcePanel on a 200k-character source (U4)", () => {
  it("renders a window, not the whole text, and reaches the last cited passage", () => {
    const data = stubLongSourceData(200_000);
    const units = spreadSelection(data, 3);
    const t0 = performance.now();
    render({ state: { kind: "ready", data }, selection: { units }, reducedMotion: true });
    const openMs = performance.now() - t0;
    const renderedChars = $(".acute-source__body")!.textContent!.length;
    expect(renderedChars).toBeLessThan(data.text.length / 10);
    expect(host.textContent).toContain("Passage 1 of 3");
    expect($(`[data-unit="${units[0]}"]`)).not.toBeNull();

    const t1 = performance.now();
    click(button(/Previous passage/)); // wraps to the last passage, at the far end of the source
    const stepMs = performance.now() - t1;
    expect($(`[data-unit="${units[2]}"]`)?.getAttribute("aria-current")).toBe("true");
    console.info(`[perf] SourcePanel 200k (happy-dom): open ${openMs.toFixed(0)} ms, step to far passage ${stepMs.toFixed(0)} ms, rendered ${renderedChars} of ${data.text.length} chars`);
  });
});
