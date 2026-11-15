// @vitest-environment happy-dom
/**
 * The Notes view component (`NotesView.tsx`, `.ai/docs/openui-integration-plan.md` Phase 2 + Phase 3 Study), rendered
 * offline through the real card library and `Renderer`. Stubbed only at the app edges: the toolbar slot, the review
 * stores, persistence, the camera/Source-tab actions, the AI mode and the AI runtime (a scripted streaming reply — no
 * network), and `promoteNote` (its commit path is covered in `promoteFlow.test.ts`).
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SourceUnit } from "@/ai/fidelity/contracts";
import type { SceneElement } from "@/domain/canvas/adapter";
import type { DocumentRecord, RichContent } from "@/domain/types";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const unit = (id: string, text: string, start: number): SourceUnit => ({ id, kind: "sentence", text, hash: id, topic: "", span: { start, end: start + text.length } });
const UNITS: SourceUnit[] = [
  unit("u1", "Edge caches serve stale content for up to 300 seconds after a deploy.", 0),
  unit("u2", "Deploys purge the CDN by surrogate key.", 71),
];

const s = vi.hoisted(() => ({
  scene: [] as unknown[],
  docs: new Map<string, unknown>(),
  knowledge: [] as unknown[],
  aiMode: "off" as "on" | "off",
  sources: [] as { id: string; updatedAt: number }[],
  calls: [] as [string, ...unknown[]][],
  /** The device's meta store (study history). */
  meta: new Map<string, unknown>(),
  /** The scripted model reply: streamed in two chunks, the second released by `release`. */
  reply: { first: "", full: "", release: () => undefined as void },
}));

vi.mock("@/components/canvas/toolbarSlot", () => ({ useToolbarSlot: () => document.body }));
vi.mock("@/components/review/knowledgeStore", () => ({ useKnowledgeUI: () => ({ revision: 0 }) }));
vi.mock("@/components/review/useKnowledgeObjects", () => ({ useKnowledgeObjects: () => ({ objects: s.knowledge, sceneVersion: 0 }) }));
vi.mock("@/components/review/knowledgeActions", () => ({
  openSourceOn: (_env: unknown, id: string, units: readonly string[]) => void s.calls.push(["openSource", id, [...units]]),
  showObjects: (_api: unknown, ids: readonly string[], select?: boolean) => void s.calls.push(["show", [...ids], select]),
  outlineCiting: (_env: unknown, sourceId: string, units: readonly string[]) => (s.calls.push(["outline", sourceId, [...units]]), []),
}));
vi.mock("@/state/documents", () => ({ getDocumentStore: () => ({ get: (id: string) => s.docs.get(id) }) }));
vi.mock("@/persistence", () => ({
  getPersistence: () => ({
    contentSources: {
      get: async (id: string) => (id === "s1" ? { id, latestVersion: 2 } : null),
      getVersion: async (_id: string, version: number) => ({ version, units: { units: UNITS } }),
      listByCanvas: async () => s.sources,
    },
    meta: {
      get: async (k: string) => structuredClone(s.meta.get(k)),
      set: async (k: string, v: unknown) => void s.meta.set(k, structuredClone(v)),
      delete: async (k: string) => void s.meta.delete(k),
    },
  }),
}));
vi.mock("@/ai/content/sources", () => ({ loadLatest: async (_repo: unknown, id: string) => ({ source: { id }, version: { version: 2, units: { units: UNITS } } }) }));
vi.mock("@/components/ai/askAI", () => ({ useAIMode: () => s.aiMode }));
vi.mock("@/ai/runtime", () => ({
  AIRuntime: {
    run: async (task: string, _input: unknown, opts: { onText?: (t: string) => void }) => {
      s.calls.push(["run", task]);
      opts.onText?.(s.reply.first);
      await new Promise<void>((res) => (s.reply.release = res));
      opts.onText?.(s.reply.full);
      return { data: s.reply.full, providerId: "mock" };
    },
  },
}));
vi.mock("./promote", () => ({
  promoteNote: async (_env: unknown, note: { key: string }) => {
    s.calls.push(["promote", note]);
    return `el_${note.key}`;
  },
}));

const { NotesViewHost } = await import("./NotesView");
const { notesView } = await import("./notesViewStore");
const { generations } = await import("./generationStore");
const { checkGeneratedCards } = await import("@/ai/openui/notesCheck");
const { cardOf, splitCards } = await import("@/ai/openui/notesTask");

const el = (id: string, x: number, y: number, extra: Record<string, unknown> = {}) =>
  ({ id, type: "embeddable", x, y, width: 200, height: 100, angle: 0, locked: false, opacity: 100, isDeleted: false, groupIds: [], strokeColor: "", backgroundColor: "", strokeWidth: 1, strokeStyle: "solid", ...extra }) as unknown as SceneElement;
const block = (id: string, x: number, y: number, frameId?: string) => el(id, x, y, { customData: { acute: { kind: "rich-block", blockType: "text", documentId: `d-${id}` } }, ...(frameId ? { frameId } : {}) });
const p = (text: string) => ({ type: "paragraph" as const, content: text });
const doc = (id: string, title: string, snapshot: RichContent): DocumentRecord => ({ id, workspaceId: "w", kind: "block", title, snapshot, createdAt: 0, updatedAt: 0 });

const FIRST = "First paragraph about stale edges. ".repeat(6).trim();
const SECOND = "The second paragraph sits behind More. ".repeat(6).trim();

function seedCanvas() {
  s.scene = [
    el("f1", 0, 0, { type: "frame", width: 900, height: 600, name: "Caching" }),
    block("n1", 0, 120, "f1"),
    block("n2", 300, 120, "f1"),
    el("a1", 0, 0, { type: "arrow", startBinding: { elementId: "n1" }, endBinding: { elementId: "n2" } }),
  ];
  s.docs = new Map([
    ["d-n1", doc("d-n1", "Stale edges", [p("Stale edges"), p(FIRST), p(SECOND)])],
    ["d-n2", doc("d-n2", "Purge on deploy", [p("Purge on deploy"), p("Deploys purge the CDN by surrogate key.")])],
  ]);
  s.knowledge = [
    { objectId: "n1", sourceId: "s1", version: 2, cites: ["u1", "u2"], review: { reasons: ["drops the 300 seconds"] } },
    { objectId: "n2", sourceId: "s1", version: 2, cites: ["u2"] },
  ];
}

let host: HTMLDivElement;
let root: Root;
let canvasId: string;
let n = 0;
const env = () => ({ api: { getSceneElements: () => s.scene } as never, home: { workspaceId: "w", canvasId } as never, history: { record: () => null } });
const flush = () => act(async () => void (await new Promise((r) => setTimeout(r, 0))));
const $ = <T extends Element = HTMLElement>(sel: string, from: ParentNode = document) => from.querySelector<T>(sel);
const $$ = (sel: string, from: ParentNode = document) => [...from.querySelectorAll<HTMLElement>(sel)];
const button = (label: string, from: ParentNode = document) => $$("button", from).find((b) => b.textContent?.trim() === label);
const click = (target: HTMLElement | undefined | null) =>
  act(() => {
    if (!target) throw new Error("nothing to click");
    target.click();
  });
const view = () => $('[data-testid="acute-notes-view"]');
const note = (id: string) => $(`[data-note-anchor="${id}"]`)!;

async function mount() {
  await act(async () => root.render(<NotesViewHost {...env()} />));
}
async function openNotes() {
  await mount();
  await click($('[data-testid="toolbar-acute-notes"]'));
  await flush();
}

beforeEach(() => {
  canvasId = `cv-${++n}`;
  s.aiMode = "off";
  s.sources = [];
  s.calls = [];
  s.meta = new Map();
  seedCanvas();
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  Element.prototype.scrollIntoView = vi.fn();
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
  document.body.innerHTML = "";
});

describe("NotesViewHost (Notes/Canvas switching)", () => {
  it("mounts only the toolbar toggle; Notes opens the view, Canvas and Escape close it", async () => {
    await mount();
    const toggle = $('[data-testid="toolbar-acute-notes"]')!;
    expect(toggle.textContent).toBe("Notes");
    expect(view()).toBeNull();
    await click(toggle);
    expect(view()).not.toBeNull();
    expect(toggle.textContent).toBe("Canvas");
    expect(toggle.getAttribute("aria-pressed")).toBe("true");
    await click(button("Canvas", view()!));
    expect(view()).toBeNull();
    await click(toggle);
    await act(() => void window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" })));
    expect(view()).toBeNull();
    expect(notesView.get(canvasId).open).toBe(false);
  });
});

describe("NotesView (Read)", () => {
  it("shows the frame as a section and its cards as notes, in reading order, with a count", async () => {
    await openNotes();
    expect($(".acute-notes__count")!.textContent).toBe("2 notes · 1 section");
    expect($$(".acute-notes__section-title").map((h) => h.textContent)).toEqual(["Caching"]);
    expect($$(".openui-idea-card__title").map((h) => h.textContent)).toEqual(["Stale edges", "Purge on deploy"]);
    expect($(".openui-idea-card__body", note("n1"))!.textContent).toBe(FIRST);
  });

  it("puts a long card's second paragraph behind More", async () => {
    await openNotes();
    expect($(".openui-idea-card__detail", note("n1"))).toBeNull();
    await click(button("More", note("n1")));
    expect($(".openui-idea-card__detail", note("n1"))!.textContent).toBe(SECOND);
    expect(button("Less", note("n1"))).toBeTruthy();
  });

  it("marks an open review on the note", async () => {
    await openNotes();
    expect($(".openui-callout", note("n1"))!.textContent).toBe("Needs review: drops the 300 seconds");
    expect($(".openui-callout", note("n2"))).toBeNull();
  });

  it("expands a citation to the cited passage inline (loaded from the stored source version)", async () => {
    await openNotes();
    const chips = $$(".openui-citation-chip", note("n1"));
    expect(chips.map((c) => [c.tagName, c.dataset.unit])).toEqual([
      ["BUTTON", "u1"],
      ["BUTTON", "u2"],
    ]);
    await click(chips[0]);
    expect($(".openui-idea-card__passage", note("n1"))!.textContent).toBe(UNITS[0]!.text);
    await click(chips[0]);
    expect($(".openui-idea-card__passage", note("n1"))).toBeNull();
  });

  it("Open in source closes the view and opens the cited units; Show on canvas selects the card", async () => {
    await openNotes();
    await click(button("Open in source", note("n1")));
    expect(s.calls).toContainEqual(["openSource", "n1", ["u1", "u2"]]);
    expect(view()).toBeNull();
    await click($('[data-testid="toolbar-acute-notes"]'));
    await click(button("Show on canvas", note("n2")));
    expect(s.calls).toContainEqual(["show", ["n2"], true]);
    expect(view()).toBeNull();
  });

  it("follows a cross-note link (an arrow on the canvas) to the other note", async () => {
    await openNotes();
    const link = $<HTMLButtonElement>('.openui-note-link[data-target="n2"]', note("n1"))!;
    expect(link.textContent).toContain("Purge on deploy");
    await click(link);
    expect(Element.prototype.scrollIntoView).toHaveBeenCalled();
    expect(note("n2").classList.contains("acute-notes__note--flash")).toBe(true);
    expect($('.openui-note-link[data-target="n1"]', note("n2"))).not.toBeNull();
  });

  it("filters notes by text and shows how many match", async () => {
    await openNotes();
    const input = $<HTMLInputElement>(".acute-notes__search")!;
    await act(() => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, "surrogate");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    expect($(".acute-notes__count")!.textContent).toBe("1 of 2 notes · 1 section");
    expect($$(".openui-idea-card__title").map((h) => h.textContent)).toEqual(["Purge on deploy"]);
  });

  it("an empty canvas says so", async () => {
    s.scene = [];
    await openNotes();
    expect($(".acute-notes__empty")!.textContent).toContain("no text cards yet");
  });
});

describe("NotesView (Study)", () => {
  it("turns the notes into flashcards, then quiz cards, with no pin action", async () => {
    await openNotes();
    await click(button("Study", view()!));
    expect(button("Study", view()!)!.getAttribute("aria-pressed")).toBe("true");
    const cards = $$(".openui-flashcard");
    expect(cards).toHaveLength(2);
    expect($(".openui-flashcard__text", cards[0])!.textContent).toBe("Stale edges");
    await click($(".openui-flashcard__face", cards[0]));
    expect($(".openui-flashcard__text", cards[0])!.textContent).toBe(FIRST);
    expect(button("Show on canvas", view()!)).toBeUndefined();
    await click(button("Quiz", view()!));
    expect($$(".openui-quiz").length).toBeGreaterThan(0);
    expect($$(".openui-flashcard")).toHaveLength(0);
    await click(button("Read", view()!));
    expect($$(".openui-idea-card")).toHaveLength(2);
  });

  it("a study card from a card that needs review shows the same mark, on flashcards and quiz alike (study plan issue A)", async () => {
    await openNotes();
    await click(button("Study", view()!));
    const mark = (id: string) => $('[data-testid="acute-notes-study-review"]', note(id));
    expect(mark("n1")!.textContent).toBe("Needs review drops the 300 seconds");
    expect(mark("n2")).toBeNull();
    await click(button("Quiz", view()!));
    expect($(".openui-quiz", note("n1"))).not.toBeNull();
    expect(mark("n1")!.textContent).toBe("Needs review drops the 300 seconds");
    expect(mark("n2")).toBeNull();
  });
});

describe("NotesView (Study history — study plan Phase 3)", () => {
  type Shard = { concepts: Record<string, { attempts: [number, string, number, number][]; cardStatus?: { status: string } }> };
  const shard = () => s.meta.get("study.w.s1") as Shard | undefined;
  const choice = (id: string, text: string) => $$(".openui-quiz__choice", note(id)).find((b) => b.textContent === text);
  const badges = (id: string) => $$('[data-testid="acute-notes-study-badges"] .acute-notes__badge', note(id)).map((b) => b.textContent);
  async function openStudy(kind?: "Quiz" | "Weak") {
    await openNotes();
    await click(button("Study", view()!));
    await flush();
    if (kind) await click(button(kind, view()!));
  }
  async function remount() {
    act(() => root.unmount());
    root = createRoot(host);
    // The view's open state lives in its store (it outlives the component), so the remounted view is already open.
    await mount();
    await flush();
    await click(button("Study", view()!));
    await flush();
  }

  it("records the first quiz pick under the concept key; a miss marks the card Weak, and that survives a reload", async () => {
    await openStudy("Quiz");
    await click(choice("n2", "Stale edges"));
    await flush();
    expect(shard()!.concepts["c:s1:u2"]!.attempts.map((a) => a.slice(1))).toEqual([["q", 0, 0]]);
    expect(badges("n2")).toEqual(["Weak"]);
    expect(badges("n1")).toEqual([]);
    // "Try again" and a second pick are practice, not recorded.
    await click(button("Try again", note("n2")));
    await click(choice("n2", "Purge on deploy"));
    await flush();
    expect(shard()!.concepts["c:s1:u2"]!.attempts).toHaveLength(1);

    await remount();
    expect(badges("n2")).toEqual(["Weak"]);
  });

  it("an answer on a card that needs review is flagged unverified, and the card-status snapshot says open", async () => {
    await openStudy("Quiz");
    await click(choice("n1", "Stale edges"));
    await flush();
    const rec = shard()!.concepts["c:s1:u1+u2"]!;
    expect(rec.attempts.map((a) => a.slice(1))).toEqual([["q", 1, 1]]);
    expect(rec.cardStatus?.status).toBe("open");
  });

  it("a flashcard flip records nothing; Got it / Missed it record one self-grade per reveal", async () => {
    await openStudy();
    await click($(".openui-flashcard__face", note("n2")));
    await click($(".openui-flashcard__face", note("n2")));
    await click($(".openui-flashcard__face", note("n2")));
    await flush();
    expect(s.meta.size).toBe(0);
    await click(button("Missed it", note("n2")));
    await flush();
    expect(shard()!.concepts["c:s1:u2"]!.attempts.map((a) => a.slice(1))).toEqual([["f", 0, 0]]);
    expect(button("Got it", note("n2"))).toBeUndefined();
  });

  it("the Weak list ranks missed concepts with passages and links back; Quiz me on these limits the quiz", async () => {
    await openStudy("Quiz");
    await click(choice("n2", "Stale edges"));
    await click(choice("n1", "Purge on deploy"));
    await flush();
    await click(button("Weak", view()!));
    await flush();
    const rows = $$('[data-testid="acute-notes-weak-row"]');
    expect(rows.map((r) => $(".acute-notes__weak-title", r)!.textContent)).toEqual(["Purge on deploy", "Stale edges"]);
    // n1's card has an open review: its own group, never silently excluded.
    expect(rows[1]!.closest('[aria-label="From cards that need review"]')).not.toBeNull();
    expect(rows[0]!.textContent).toContain("1 attempt");
    expect(rows[0]!.textContent).toContain("missed");
    await click($('.openui-citation-chip[data-unit="u2"]', rows[0]));
    expect($(".openui-idea-card__passage", rows[0])!.textContent).toBe(UNITS[1]!.text);

    await click(button("Quiz me on these", view()!));
    expect(button("Quiz", view()!)!.getAttribute("aria-pressed")).toBe("true");
    expect($$(".openui-quiz")).toHaveLength(2);
    await click(button("Weak", view()!));
    await click(button("Show citing cards", $$('[data-testid="acute-notes-weak-row"]')[0]));
    expect(s.calls).toContainEqual(["outline", "s1", ["u2"]]);
    expect(view()).toBeNull();
  });

  it("an empty history says so", async () => {
    await openStudy("Weak");
    expect($('[data-testid="acute-notes-weak"]')!.textContent).toContain("Nothing weak yet");
  });
});

describe("NotesView (Generate from source → stream → check → Pin)", () => {
  const REPLY_1 = `root = IdeaCard("Stale for a while", "Edge caches serve stale content after a deploy.", null, [c1])\nc1 = CitationChip("u1")`;
  const REPLY_2 = `root = IdeaCard("Purge by key", "Deploys purge the CDN by surrogate key.", null, [c1])\nc1 = CitationChip("u2")`;

  it("hides Generate when AI is off", async () => {
    await openNotes();
    expect(button("Generate from source", view()!)).toBeUndefined();
  });

  it("streams cards in, shows the free check and per-card review, then pins a card once", async () => {
    s.aiMode = "on";
    s.sources = [{ id: "s1", updatedAt: 1 }];
    s.reply.first = REPLY_1;
    s.reply.full = `${REPLY_1}\n---\n${REPLY_2}`; // cards are separated by a `---` line (notesTask CARD_SEPARATOR)
    await openNotes();
    const generate = button("Generate from source", view()!)!;
    expect(generate.hasAttribute("disabled")).toBe(false);

    await click(generate);
    await flush();
    const section = $(".acute-notes__generated")!;
    expect(section.dataset.status).toBe("running");
    expect(button("Generating…", view()!)!.hasAttribute("disabled")).toBe(true);
    expect($$(".openui-idea-card__title", section).map((h) => h.textContent)).toEqual(["Stale for a while"]);

    await act(async () => s.reply.release());
    await flush();
    expect(section.dataset.status).toBe("done");
    expect(s.calls.filter((c) => c[0] === "run")).toEqual([["run", "generate_openui_notes"]]);
    expect($$(".openui-idea-card__title", section).map((h) => h.textContent)).toEqual(["Stale for a while", "Purge by key"]);

    // The same free check the view runs, computed here directly, decides the summary and the per-card marks.
    const known = new Set(UNITS.map((u) => u.id));
    const cards = splitCards(s.reply.full).flatMap((b, i) => cardOf(b, i, known) ?? []);
    const check = checkGeneratedCards(cards, UNITS);
    const summary = $('[data-testid="acute-notes-check"]', section)!.textContent!;
    expect(summary).toContain(`${check.units - check.unitsNotCovered} of ${check.units} passages covered`);
    const flagged = Object.entries(check.reviews).filter(([, r]) => r.reasons.length).map(([k]) => k);
    expect(flagged, "the card dropping \"300 seconds\" is flagged").toContain("g1");
    expect($$('[data-testid="acute-notes-card-review"]', section)).toHaveLength(flagged.length);
    expect(button("Pin (needs review)", note("g1"))).toBeTruthy();

    // Generated cards expand their citations from the source the run used.
    await click($(".openui-citation-chip", note("g1")));
    expect($(".openui-idea-card__passage", note("g1"))!.textContent).toBe(UNITS[0]!.text);

    await click(button("Pin (needs review)", note("g1")));
    await flush();
    const promoted = s.calls.filter((c) => c[0] === "promote").map((c) => c[1]);
    expect(promoted).toEqual([
      { key: "g1", title: "Stale for a while", body: "Edge caches serve stale content after a deploy.", cites: ["u1"], source: { sourceId: "s1", version: 2 }, review: check.reviews.g1 },
    ]);
    expect(generations.get(canvasId).pinned.get("g1")).toBe("el_g1");
    // Once pinned, the action is "Show on canvas" — a second click doesn't pin again.
    await click(button("Show on canvas", note("g1")));
    expect(s.calls.filter((c) => c[0] === "promote")).toHaveLength(1);
    expect(s.calls).toContainEqual(["show", ["el_g1"], true]);
  });

  it("the generated cards survive closing and reopening the view", async () => {
    s.aiMode = "on";
    s.sources = [{ id: "s1", updatedAt: 1 }];
    s.reply.first = REPLY_1;
    s.reply.full = REPLY_1;
    await openNotes();
    await click(button("Generate from source", view()!));
    await flush();
    await act(async () => s.reply.release());
    await flush();
    await click(button("Canvas", view()!));
    expect(view()).toBeNull();
    await click($('[data-testid="toolbar-acute-notes"]'));
    expect($(".acute-notes__generated")!.dataset.status).toBe("done");
    expect($$(".openui-idea-card__title", $(".acute-notes__generated")!).map((h) => h.textContent)).toEqual(["Stale for a while"]);
  });
});
