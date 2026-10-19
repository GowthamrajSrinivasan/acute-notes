/**
 * The toolbar arrow tool's two modes (`uiPrefs.arrowTool`, chosen from the
 * arrow dropdown, `ArrowToolMenu`):
 * - "excalidraw": Excalidraw's own arrow (straight, curved or elbow, as its
 *   properties panel sets it);
 * - "architecture": the connector AI diagrams use — right angles, routed
 *   around other objects, ports spread when several share a side. The user
 *   draws an elbow arrow; once both ends are attached it becomes Acute-routed
 *   (`customData.acuteRouted`), so it is routed now and again whenever an
 *   object it attaches to moves (`rerouteAround`).
 */
import { CaptureUpdateAction, newElementWith } from "@excalidraw/excalidraw";
import type { ExcalidrawElement } from "@excalidraw/excalidraw/element/types";
import type { AppState, ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";
import { getUiPref, setUiPref, type ArrowTool } from "@/state/uiPrefs";
import { isAcuteRouted, rerouteAround } from "./connectorRoutes";

type Arrow = ExcalidrawElement & { elbowed?: boolean; startBinding: { elementId: string } | null; endBinding: { elementId: string } | null };

/** Switches the mode and picks the arrow tool, with the matching Excalidraw arrow type. */
export function chooseArrowTool(api: ExcalidrawImperativeAPI, mode: ArrowTool): void {
  setUiPref("arrowTool", mode);
  const current = api.getAppState().currentItemArrowType;
  const arrowType = mode === "architecture" ? "elbow" : current === "elbow" ? "sharp" : current;
  api.updateScene({ appState: { currentItemArrowType: arrowType }, captureUpdate: CaptureUpdateAction.NEVER });
  api.setActiveTool({ type: "arrow" });
}

/** Keeps Excalidraw's arrow type in step with the mode (Excalidraw's onChange; cheap). */
export function createArrowModeSync() {
  let previousTool: string | null = null;
  let previousType: AppState["currentItemArrowType"] | null = null;
  return {
    handleChange(api: ExcalidrawImperativeAPI, appState: AppState): void {
      const tool = appState.activeTool.type;
      const type = appState.currentItemArrowType;
      const architecture = getUiPref("arrowTool") === "architecture";
      if (tool === "arrow" && previousTool !== "arrow" && architecture && type !== "elbow") {
        // Picking the arrow tool (A, or its button) in architecture mode draws elbow arrows.
        queueMicrotask(() => api.updateScene({ appState: { currentItemArrowType: "elbow" }, captureUpdate: CaptureUpdateAction.NEVER }));
      } else if (tool === "arrow" && previousTool === "arrow" && architecture && previousType === "elbow" && type !== "elbow") {
        // The user chose another arrow type in the properties panel: that is Excalidraw's arrow.
        queueMicrotask(() => setUiPref("arrowTool", "excalidraw"));
      }
      previousTool = tool;
      previousType = type;
    },
  };
}

/**
 * After a gesture (pointer up): the architecture-mode arrows it drew — new since `originals`, elbow, attached at
 * both ends — become Acute-routed and are routed. Returns the ids it changed.
 */
export function routeNewArrows(api: ExcalidrawImperativeAPI, originals: ReadonlyMap<string, unknown>): string[] {
  if (getUiPref("arrowTool") !== "architecture") return [];
  const fresh = (api.getSceneElements() as readonly ExcalidrawElement[]).filter((el): el is Arrow => {
    const a = el as Arrow;
    return el.type === "arrow" && !originals.has(el.id) && !!a.elbowed && !!a.startBinding && !!a.endBinding && !isAcuteRouted(el);
  });
  if (!fresh.length) return [];
  const ids = new Set(fresh.map((a) => a.id));
  api.updateScene({
    elements: (api.getSceneElementsIncludingDeleted() as readonly ExcalidrawElement[]).map((el) =>
      ids.has(el.id) ? newElementWith(el, { customData: { ...el.customData, acuteRouted: true } }) : el,
    ),
    // Part of the user's drawing step.
    captureUpdate: CaptureUpdateAction.EVENTUALLY,
  });
  const ends = fresh.flatMap((a) => [a.startBinding!.elementId, a.endBinding!.elementId]);
  return [...ids, ...rerouteAround(api, ends).map((c) => c.id)];
}
