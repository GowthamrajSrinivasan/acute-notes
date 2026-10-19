/**
 * The unified history bound to an Excalidraw instance. The API is attached
 * once Excalidraw hands it over; until then the scene is empty.
 */
import { CaptureUpdateAction } from "@excalidraw/excalidraw";
import type { ExcalidrawElement } from "@excalidraw/excalidraw/element/types";
import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";
import { CanvasHistory } from "./canvasHistory";
import { docStepSource } from "./docSteps";

export interface ExcalidrawHistory {
  history: CanvasHistory<ExcalidrawElement>;
  attach(api: ExcalidrawImperativeAPI): void;
}

export function createExcalidrawHistory(): ExcalidrawHistory {
  let api: ExcalidrawImperativeAPI | null = null;
  const history = new CanvasHistory<ExcalidrawElement>({
    getElements: () => api?.getSceneElementsIncludingDeleted() ?? [],
    apply: (elements, select) =>
      api?.updateScene({
        elements,
        appState: { selectedElementIds: Object.fromEntries(select.map((id) => [id, true as const])), selectedGroupIds: {} },
        // Outside Excalidraw's own history, which is not used.
        captureUpdate: CaptureUpdateAction.NEVER,
      }),
    bump: (el, above) =>
      ({ ...el, version: above + 1, versionNonce: Math.floor(Math.random() * 2 ** 31), updated: Date.now() }) as ExcalidrawElement,
    markDeleted: (el) => ({ ...el, isDeleted: true }) as ExcalidrawElement,
    docs: docStepSource,
  });
  return {
    history,
    attach(next) {
      api = next;
    },
  };
}
