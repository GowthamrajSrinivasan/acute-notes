// @vitest-environment happy-dom
/**
 * WP2.8 "Keep full detail" in the Visualize dialog (knowledge-notes-plan §6.3, OD2): hidden until R1
 * (`FIDELITY_CONFIG.showNoteModelChoice`, default false) and then the run is exactly today's (no note model passed, so
 * Visualize uses `FIDELITY_CONFIG.noteModel`). Shown: distil by default, ticked → `preserve`, passed per run on the
 * ingest request, never by changing the global config.
 */
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";
import { FIDELITY_CONFIG } from "@/config/fidelity";

const ingest = vi.hoisted(() => ({ calls: [] as unknown[] }));

vi.mock("@/ai/ingest/ingest", () => ({
  ingestContent: vi.fn(async (request: unknown) => {
    ingest.calls.push(request);
    return { changeSet: null, notices: [], choices: [] };
  }),
  prepareProposal: vi.fn(),
  sceneSourceObjects: () => () => ({ existing: [], connections: [] }),
  SourceUnavailableError: class SourceUnavailableError extends Error {},
}));
vi.mock("@/ai/runtime", () => ({ AIRuntime: {} }));
vi.mock("@/ai/connections", () => ({ getPrimaryId: () => "mock", getDescriptor: () => ({ name: "Mock", accessType: "api_key" }) }));
vi.mock("@/ai/changes/pendingChanges", () => ({ getPendingChanges: () => ({ propose: vi.fn() }) }));
vi.mock("@/config/features", () => ({ isTopicMergeEnabled: () => false }));
vi.mock("@/persistence", () => ({ getPersistence: () => ({ contentSources: {} }) }));
vi.mock("@/state/documents", () => ({ getDocumentStore: () => ({ get: () => null }) }));
vi.mock("@/state/uiPrefs", () => ({ getUiPref: () => ({ timestamps: false, citations: false }) }));
vi.mock("@/ai/content/cleanup", () => ({ cleanupAIText: (text: string) => text }));
vi.mock("@/components/canvas/renderPlanContext", () => ({ gatherRenderContext: () => ({ existing: [], viewport: { x: 0, y: 0, width: 1600, height: 900 } }) }));
vi.mock("./askAI", () => ({ openAISettings: vi.fn() }));
vi.mock("./SharedChatsPanel", () => ({ SharedChatsPanel: () => null }));
vi.mock("./TemplatePicker", () => ({
  TemplatePicker: ({ value, onChange }: { value: string; onChange: (t: string) => void }) =>
    createElement("select", { "aria-label": "Template", value, onChange: (e: { target: { value: string } }) => onChange(e.target.value) }, [
      createElement("option", { key: "auto", value: "auto" }, "Auto"),
      createElement("option", { key: "flow", value: "flow" }, "Flow"),
    ]),
}));

const { VisualizeDialog } = await import("./VisualizeDialog");
const { visualizeDialog } = await import("./visualizeStore");
const { KEEP_FULL_DETAIL_HELP, KEEP_FULL_DETAIL_LABEL } = await import("./noteModelOption");

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const api = { getSceneElements: () => [], setToast: vi.fn() } as unknown as ExcalidrawImperativeAPI;
const home = { canvasId: "canvas_1" } as Parameters<typeof VisualizeDialog>[0]["home"];

let host: HTMLDivElement;
let root: Root;
const initial = { noteModel: FIDELITY_CONFIG.noteModel, showNoteModelChoice: FIDELITY_CONFIG.showNoteModelChoice };

beforeEach(() => {
  ingest.calls.length = 0;
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => visualizeDialog.close());
  act(() => root.unmount());
  host.remove();
  FIDELITY_CONFIG.noteModel = initial.noteModel;
  FIDELITY_CONFIG.showNoteModelChoice = initial.showNoteModelChoice;
});

async function open(options: Parameters<typeof visualizeDialog.open>[0] = { text: "# Notes\n\nSome text to visualize." }) {
  await act(async () => {
    root.render(createElement(VisualizeDialog, { api, home }));
  });
  await act(async () => visualizeDialog.open(options));
}

const keepBox = () =>
  [...document.body.querySelectorAll<HTMLLabelElement>("label")].find((l) => l.textContent?.includes(KEEP_FULL_DETAIL_LABEL))?.querySelector<HTMLInputElement>("input") ?? null;
const button = (label: string) => [...document.body.querySelectorAll<HTMLButtonElement>("button")].find((b) => b.textContent?.trim() === label)!;
async function visualize() {
  await act(async () => button("Visualize").click());
}

describe("VisualizeDialog: Keep full detail (WP2.8)", () => {
  it("is hidden by default (until R1)", () => {
    expect(FIDELITY_CONFIG.showNoteModelChoice).toBe(false);
  });

  it("hidden: no control, and the run passes no note model, so it uses today's configured one", async () => {
    FIDELITY_CONFIG.showNoteModelChoice = false;
    await open();
    expect(keepBox()).toBeNull();
    expect(document.body.textContent).not.toContain(KEEP_FULL_DETAIL_HELP);
    await visualize();
    expect(ingest.calls).toHaveLength(1);
    expect(ingest.calls[0]).toMatchObject({ mode: "new", text: "# Notes\n\nSome text to visualize." });
    expect(ingest.calls[0]).not.toHaveProperty("noteModel");
    expect(FIDELITY_CONFIG.noteModel).toBe("preserve");
  });

  it("shown: unticked by default with one line of help, and the run distils", async () => {
    FIDELITY_CONFIG.showNoteModelChoice = true;
    await open();
    expect(keepBox()).not.toBeNull();
    expect(keepBox()!.checked).toBe(false);
    expect(document.body.textContent).toContain(KEEP_FULL_DETAIL_HELP);
    await visualize();
    expect(ingest.calls[0]).toMatchObject({ mode: "new", noteModel: "distil" });
    expect(FIDELITY_CONFIG.noteModel).toBe("preserve");
  });

  it("shown: ticking Keep full detail runs that Visualize with preserve, without changing the global config; a new open starts unticked", async () => {
    FIDELITY_CONFIG.showNoteModelChoice = true;
    FIDELITY_CONFIG.noteModel = "distil";
    await open();
    await act(async () => keepBox()!.click());
    expect(keepBox()!.checked).toBe(true);
    await visualize();
    expect(ingest.calls[0]).toMatchObject({ mode: "new", noteModel: "preserve" });
    expect(FIDELITY_CONFIG.noteModel).toBe("distil");
    await act(async () => visualizeDialog.open({ text: "Again." }));
    expect(keepBox()!.checked).toBe(false);
  });

  it("shown: not offered for an update or a forced template", async () => {
    FIDELITY_CONFIG.showNoteModelChoice = true;
    await open({ text: "v2", updateSourceId: "src_1" });
    expect(keepBox()).toBeNull();
    await act(async () => visualizeDialog.open({ text: "x" }));
    expect(keepBox()).not.toBeNull();
    const select = document.body.querySelector<HTMLSelectElement>('select[aria-label="Template"]')!;
    await act(async () => {
      select.value = "flow";
      select.dispatchEvent(new Event("change", { bubbles: true }));
    });
    expect(keepBox()).toBeNull();
  });
});
