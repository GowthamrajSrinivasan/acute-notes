// @vitest-environment happy-dom
/**
 * Phase 3 acceptance (`.ai/docs/openui-integration-plan.md`): "meaningful interaction without additional model calls for
 * basic UI actions". Each card is rendered from OpenUI Lang through the real `Renderer`, clicked, and checked — no
 * mocks of the runtime, no network.
 */
import { createParser, Renderer } from "@openuidev/react-lang";
import { act, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NotesHostProvider, type NotesHost } from "./hostContext";
import { acuteCardLibrary } from "./library";

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
const renderLang = (lang: string, notesHost: NotesHost = {}, onStateUpdate?: (s: Record<string, unknown>) => void) =>
  render(
    <NotesHostProvider value={notesHost}>
      <Renderer response={lang} library={acuteCardLibrary} isStreaming={false} onStateUpdate={onStateUpdate} />
    </NotesHostProvider>,
  );
const $ = (sel: string) => host.querySelector(sel) as HTMLElement | null;
const $$ = (sel: string) => [...host.querySelectorAll(sel)] as HTMLElement[];
const click = (el: Element | null | undefined) => {
  expect(el).toBeTruthy();
  act(() => el!.dispatchEvent(new MouseEvent("click", { bubbles: true })));
};
const parse = (lang: string) => createParser(acuteCardLibrary.toJSONSchema()).parse(lang);

const DECISION = `
root = DecisionCard("Which queue should orders use?", [a, b], "SQS FIFO", "Orders need strict per-customer ordering.", ["u3"])
a = DecisionOption("SQS Standard", ["Cheap", "Unlimited throughput"], ["Best-effort ordering"])
b = DecisionOption("SQS FIFO", ["Strict ordering per group"], ["300 msg/s per group"])
`.trim();

const TIMELINE = `
root = Timeline("Rollout", [e1, e2])
e1 = TimelineEvent("Mon", "Canary at 5%", "Error rate held at baseline.", "u2")
e2 = TimelineEvent("Wed", "Full rollout")
`.trim();

const FLOW = `root = FlowDiagram("Blue-green deploy", ["Deploy green", "Smoke test", "Switch traffic"], ["New version beside the old.", "Checks against green only.", "Load balancer flips."])`;
const QUIZ = `root = QuizCard("What does an idempotency key prevent?", ["Slow responses", "Duplicate charges", "Expired tokens"], 1, "Retries return the original result.", "u4")`;
const FLASH = `root = Flashcard("Idempotency keys", "Retries with the same key return the original result.", "u4")`;

describe("every Phase 3 card parses cleanly", () => {
  it.each([
    ["DecisionCard", DECISION],
    ["Timeline", TIMELINE],
    ["FlowDiagram", FLOW],
    ["QuizCard", QUIZ],
    ["Flashcard", FLASH],
    ["NoteLink", `root = NoteLink("n2", "See also")`],
  ])("%s", (name, lang) => {
    const r = parse(lang);
    expect(r.meta.errors).toEqual([]);
    expect(r.meta.incomplete).toBe(false);
    expect(r.root?.typeName).toBe(name);
  });
});

describe("DecisionCard", () => {
  it("highlights the decision and lets the reader select options to compare", () => {
    renderLang(DECISION);
    const options = $$(".openui-decision__option");
    expect(options).toHaveLength(2);
    expect(options[1]!.dataset.chosen).toBe("true");
    expect(options[0]!.dataset.chosen).toBeUndefined();
    expect(host.textContent).toContain("Orders need strict per-customer ordering.");
    expect(host.textContent).toContain("Best-effort ordering");

    click(options[0]);
    expect(options[0]!.getAttribute("aria-pressed")).toBe("true");
    click(options[1]);
    expect(options[0]!.getAttribute("aria-pressed")).toBe("false");
    expect(options[1]!.getAttribute("aria-pressed")).toBe("true");
    click(options[1]);
    expect(options[1]!.getAttribute("aria-pressed")).toBe("false");
  });

  it("expands a cited passage only when the host can supply it", () => {
    renderLang(DECISION);
    expect($('span.openui-citation-chip[data-unit="u3"]')).toBeTruthy();
    renderLang(DECISION, { unitText: (u) => (u === "u3" ? "FIFO queues keep order within a message group." : undefined) });
    click($('button.openui-citation-chip[data-unit="u3"]'));
    expect($(".openui-idea-card__passage")?.textContent).toBe("FIFO queues keep order within a message group.");
  });
});

describe("Timeline", () => {
  it("toggles an event's detail and passage; an event without either can't expand", () => {
    renderLang(TIMELINE, { unitText: () => "Canary served 5% of traffic for 24 hours." });
    const heads = $$(".openui-timeline__head");
    expect(heads).toHaveLength(2);
    // e2 has no detail and no unit.
    expect((heads[1] as HTMLButtonElement).disabled).toBe(true);
    expect($(".openui-timeline__detail")).toBeNull();

    click(heads[0]);
    expect($(".openui-timeline__detail")?.textContent).toContain("Error rate held at baseline.");
    expect($(".openui-timeline__detail")?.textContent).toContain("Canary served 5% of traffic");
    click(heads[0]);
    expect($(".openui-timeline__detail")).toBeNull();
  });
});

describe("FlowDiagram", () => {
  it("renders connected steps and shows the selected step's detail", () => {
    renderLang(FLOW);
    const nodes = $$(".openui-flow__node");
    expect(nodes).toHaveLength(3);
    expect($$(".openui-flow__arrow")).toHaveLength(2);
    expect($(".openui-flow__detail")).toBeNull();
    click(nodes[2]);
    expect(nodes[2]!.getAttribute("aria-pressed")).toBe("true");
    expect($(".openui-flow__detail")?.textContent).toContain("Load balancer flips.");
    click(nodes[2]);
    expect($(".openui-flow__detail")).toBeNull();
  });
});

describe("QuizCard", () => {
  it("marks a wrong pick, shows the answer and explanation, and resets on Try again", () => {
    renderLang(QUIZ);
    const choices = $$(".openui-quiz__choice");
    click(choices[0]);
    expect($(".openui-quiz")?.dataset.state).toBe("incorrect");
    expect($(".openui-quiz__verdict")?.textContent).toContain("Duplicate charges");
    expect($(".openui-quiz__explanation")?.textContent).toBe("Retries return the original result.");
    expect(choices[1]!.dataset.result).toBe("answer");
    expect(choices[0]!.dataset.result).toBe("wrong");

    click($(".openui-quiz__retry"));
    expect($(".openui-quiz")?.dataset.state).toBe("open");
    click($$(".openui-quiz__choice")[1]);
    expect($(".openui-quiz")?.dataset.state).toBe("correct");
  });

  it("binds `selected` to a $variable: the pick lands in the Renderer's store (what a host persists) — no model round-trip", () => {
    // The store is observed through onStateUpdate (what a host would persist via `initialState`).
    const bound = `
$pick = null
root = QuizCard("What does an idempotency key prevent?", ["Slow responses", "Duplicate charges"], 1, "Retries return the original result.", null, $pick)
`.trim();
    const parsed = parse(bound);
    expect(parsed.meta.errors).toEqual([]);

    const updates: Record<string, unknown>[] = [];
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    renderLang(bound, {}, (s) => updates.push({ ...s }));
    click($$(".openui-quiz__choice")[1]);
    expect($(".openui-quiz")?.dataset.state).toBe("correct");
    expect(updates.at(-1)).toMatchObject({ $pick: 1 });

    click($(".openui-quiz__retry"));
    expect($(".openui-quiz")?.dataset.state).toBe("open");
    expect(updates.at(-1)?.$pick ?? null).toBeNull();
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });
});

describe("Flashcard", () => {
  it("flips between prompt and answer", () => {
    renderLang(FLASH);
    const face = $(".openui-flashcard__face");
    expect(face?.textContent).toContain("Idempotency keys");
    click(face);
    expect($(".openui-flashcard__face")?.textContent).toContain("Retries with the same key");
    expect($('[data-unit="u4"]')).toBeTruthy();
    click($(".openui-flashcard__face"));
    expect($(".openui-flashcard__face")?.textContent).toContain("Prompt");
  });
});

describe("NoteLink", () => {
  it("navigates through the host, labelled with the target note's title", () => {
    const navigate = vi.fn();
    renderLang(`root = NoteLink("n2")`, { navigate, noteTitle: (id) => (id === "n2" ? "Keys expire" : undefined) });
    const link = $("button.openui-note-link");
    expect(link?.textContent).toContain("Keys expire");
    click(link);
    expect(navigate).toHaveBeenCalledWith("n2");
  });

  it("is plain text with no host, falling back to the label then the id", () => {
    renderLang(`root = NoteLink("n2", "See also")`);
    expect($("button.openui-note-link")).toBeNull();
    expect($("span.openui-note-link")?.textContent).toBe("See also");
    renderLang(`root = NoteLink("n9")`);
    expect($("span.openui-note-link")?.textContent).toBe("n9");
  });
});
