import type { OrderedExcalidrawElement } from "@excalidraw/excalidraw/element/types";
import type { AppState, ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";
import { describe, expect, it } from "vitest";
import type { CanvasDocument } from "@/domain/types";
import { createMemoryServices } from "@/persistence/repositories/memory";
import { CanvasSession } from "./CanvasSession";

const canvas = { id: "c1", workspaceId: "w1", title: "Canvas", createdAt: 1, updatedAt: 1 } as CanvasDocument;
const el = (id: string, version: number, text = "") => ({ id, version, index: `a${id}`, type: "text", text, isDeleted: false }) as unknown as OrderedExcalidrawElement;
const appState = { cursorButton: "up", multiElement: null, viewBackgroundColor: "#ffffff", theme: "light", scrollX: 0, scrollY: 0, zoom: { value: 1 } } as unknown as AppState;

/** An Excalidraw API stand-in whose scene the test sets, as `updateScene` would, without an onChange. */
function fakeApi(scene: { elements: OrderedExcalidrawElement[] }) {
  return { getSceneElementsIncludingDeleted: () => scene.elements, addFiles: () => undefined } as unknown as ExcalidrawImperativeAPI;
}

describe("CanvasSession.flush (#34)", () => {
  it("saves a change written through the API that onChange hasn't reported yet (an accepted change set)", async () => {
    const services = createMemoryServices();
    const session = await CanvasSession.open(canvas, services);
    const scene = { elements: [el("a", 1, "six servers")] };
    session.attach(fakeApi(scene));
    session.handleChange(scene.elements, appState, {}); // the scene is initialised
    // Accept: the card is rewritten through the API in the same task, then saved at once.
    scene.elements = [el("a", 2, "seven servers"), el("b", 1, "new card")];
    await session.flush();

    // A reload: a new session reads what was saved.
    const reopened = await CanvasSession.open(canvas, services);
    const saved = reopened.getInitialData().elements as unknown as { id: string; version: number; text: string }[];
    expect(saved.map((e) => [e.id, e.version, e.text])).toEqual([["a", 2, "seven servers"], ["b", 1, "new card"]]);
  });

  it("before the scene is initialised it saves nothing from the API (never an empty or half-loaded scene)", async () => {
    const services = createMemoryServices();
    const first = await CanvasSession.open(canvas, services);
    const scene = { elements: [el("a", 1)] };
    first.attach(fakeApi(scene));
    first.handleChange(scene.elements, appState, {});
    await first.flush();

    const second = await CanvasSession.open(canvas, services);
    second.attach(fakeApi({ elements: [] })); // Excalidraw hands over its API before its scene is loaded
    await second.flush();
    const third = await CanvasSession.open(canvas, services);
    expect((third.getInitialData().elements ?? []).map((e) => e.id)).toEqual(["a"]);
  });
});
