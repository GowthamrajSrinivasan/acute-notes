// @vitest-environment happy-dom
/**
 * WP2.8 note model choice in the Visualize dialog (knowledge-notes-plan §6.3, OD2), by `FIDELITY_CONFIG.noteModelChoice`:
 * hidden → the run passes no note model (today's configured one); opt-in (early access before R1) → no note model (the
 * configured one) unless "Distil into key ideas" is ticked; default (R1) → distil unless "Keep full detail" is ticked. Always passed per run on
 * the ingest request, never by changing the global config.
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
const { DISTIL_OPT_IN_HELP, DISTIL_OPT_IN_LABEL, KEEP_FULL_DETAIL_HELP, KEEP_FULL_DETAIL_LABEL } = await import("./noteModelOption");

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const api = { getSceneElements: () => [], setToast: vi.fn() } as unknown as ExcalidrawImperativeAPI;
const home = { canvasId: "canvas_1" } as Parameters<typeof VisualizeDialog>[0]["home"];

let host: HTMLDivElement;
let root: Root;
const initial = { noteModel: FIDELITY_CONFIG.noteModel, noteModelChoice: FIDELITY_CONFIG.noteModelChoice };

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
  FIDELITY_CONFIG.noteModelChoice = initial.noteModelChoice;
});

async function open(options: Parameters<typeof visualizeDialog.open>[0] = { text: "# Notes\n\nSome text to visualize." }) {
  await act(async () => {
    root.render(createElement(VisualizeDialog, { api, home }));
  });
  await act(async () => visualizeDialog.open(options));
}

const boxLabelled = (label: string) =>
  [...document.body.querySelectorAll<HTMLLabelElement>("label")].find((l) => l.textContent?.includes(label))?.querySelector<HTMLInputElement>("input") ?? null;
const keepBox = () => boxLabelled(KEEP_FULL_DETAIL_LABEL);
const distilBox = () => boxLabelled(DISTIL_OPT_IN_LABEL);
const button = (label: string) => [...document.body.querySelectorAll<HTMLButtonElement>("button")].find((b) => b.textContent?.trim() === label)!;
async function visualize() {
  await act(async () => button("Visualize").click());
}

describe("VisualizeDialog: note model choice (WP2.8)", () => {
  it("before R1 it is the early-access opt-in", () => {
    expect(FIDELITY_CONFIG.noteModelChoice).toBe("opt-in");
  });

  it("hidden: no control, and the run passes no note model, so it uses today's configured one", async () => {
    FIDELITY_CONFIG.noteModelChoice = "hidden";
    await open();
    expect(keepBox()).toBeNull();
    expect(distilBox()).toBeNull();
    expect(document.body.textContent).not.toContain(KEEP_FULL_DETAIL_HELP);
    await visualize();
    expect(ingest.calls).toHaveLength(1);
    expect(ingest.calls[0]).toMatchObject({ mode: "new", text: "# Notes\n\nSome text to visualize." });
    expect(ingest.calls[0]).not.toHaveProperty("noteModel");
    expect(FIDELITY_CONFIG.noteModel).toBe("preserve");
  });

  it("opt-in: unticked by default with its help, and the run passes no note model (today's configured preserve)", async () => {
    FIDELITY_CONFIG.noteModelChoice = "opt-in";
    await open();
    expect(keepBox()).toBeNull();
    expect(distilBox()!.checked).toBe(false);
    expect(document.body.textContent).toContain(DISTIL_OPT_IN_HELP);
    await visualize();
    expect(ingest.calls[0]).toMatchObject({ mode: "new" });
    expect(ingest.calls[0]).not.toHaveProperty("noteModel");
    expect(FIDELITY_CONFIG.noteModel).toBe("preserve");
  });

  it("opt-in: ticking it distils that Visualize only, without changing the global config; a new open starts unticked", async () => {
    FIDELITY_CONFIG.noteModelChoice = "opt-in";
    await open();
    await act(async () => distilBox()!.click());
    await visualize();
    expect(ingest.calls[0]).toMatchObject({ mode: "new", noteModel: "distil" });
    expect(FIDELITY_CONFIG.noteModel).toBe("preserve");
    await act(async () => visualizeDialog.open({ text: "Again." }));
    expect(distilBox()!.checked).toBe(false);
  });

  it("default (R1): unticked with one line of help, and the run distils", async () => {
    FIDELITY_CONFIG.noteModelChoice = "default";
    await open();
    expect(keepBox()!.checked).toBe(false);
    expect(document.body.textContent).toContain(KEEP_FULL_DETAIL_HELP);
    await visualize();
    expect(ingest.calls[0]).toMatchObject({ mode: "new", noteModel: "distil" });
    expect(FIDELITY_CONFIG.noteModel).toBe("preserve");
  });

  it("default (R1): ticking Keep full detail runs that Visualize with preserve, without changing the global config", async () => {
    FIDELITY_CONFIG.noteModelChoice = "default";
    FIDELITY_CONFIG.noteModel = "distil";
    await open();
    await act(async () => keepBox()!.click());
    await visualize();
    expect(ingest.calls[0]).toMatchObject({ mode: "new", noteModel: "preserve" });
    expect(FIDELITY_CONFIG.noteModel).toBe("distil");
  });

  it("not offered for an update or a forced template", async () => {
    FIDELITY_CONFIG.noteModelChoice = "opt-in";
    await open({ text: "v2", updateSourceId: "src_1" });
    expect(distilBox()).toBeNull();
    await act(async () => visualizeDialog.open({ text: "x" }));
    expect(distilBox()).not.toBeNull();
    const select = document.body.querySelector<HTMLSelectElement>('select[aria-label="Template"]')!;
    await act(async () => {
      select.value = "flow";
      select.dispatchEvent(new Event("change", { bubbles: true }));
    });
    expect(distilBox()).toBeNull();
  });
});
