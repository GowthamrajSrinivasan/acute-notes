/**
 * Native (free) Excalidraw text → Acute text items.
 *
 * - `convertNativeText`: "Convert to rich text" on one selected element.
 * - `convertNativeTexts`: many at once, in one scene update (one undo step).
 * - `NativeTextIntake`: one text system whatever the source. Free native text
 *   that *enters* the scene — pasted from Excalidraw (or another canvas),
 *   inserted from the library, dropped as a scene file, written by a tool — is
 *   converted as it arrives. Text already on the canvas when it opened is left
 *   alone (it can still be converted explicitly).
 *
 * Conversion keeps position, rotation, width behaviour, font, size, colour,
 * alignment, z-order, groups, frame, lock and the arrows bound to the text.
 * Labels bound to shapes/arrows (`containerId`) stay native: they belong to
 * their container.
 */
import { CaptureUpdateAction, newElementWith } from "@excalidraw/excalidraw";
import type { ExcalidrawElement, ExcalidrawTextElement } from "@excalidraw/excalidraw/element/types";
import type { AppState, ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";
import type { DocumentHome, RichContent } from "@/domain/types";
import { createBlockElement } from "./richBlocks";
import { styleFromNative } from "./textTool";

type CaptureUpdate = (typeof CaptureUpdateAction)[keyof typeof CaptureUpdateAction];
type Binding = { elementId: string } | null;

/** Plain text lines → paragraphs (native text has no markup to interpret). */
export function contentFromPlainText(text: string): RichContent {
  return text.split(/\r?\n/).map((line) => ({ type: "paragraph" as const, content: line }));
}

/** A live, free-standing native text element with content. */
export function isFreeNativeText(el: ExcalidrawElement): el is ExcalidrawTextElement {
  if (el.type !== "text" || el.isDeleted) return false;
  const text = el as ExcalidrawTextElement;
  return !text.containerId && !!(text.originalText || text.text).trim();
}

function textItemFor(home: DocumentHome, text: ExcalidrawTextElement): ExcalidrawElement {
  const item = createBlockElement(home, "text", {
    box: { x: text.x, y: text.y, width: Math.max(24, text.width), height: text.height },
    style: { ...styleFromNative(text), autoWidth: text.autoResize !== false },
    content: contentFromPlainText(text.originalText || text.text),
    angle: text.angle,
  });
  return newElementWith(item, {
    // Placed right after the original in the scene array; a null index is regenerated there (same z-order).
    index: null,
    groupIds: text.groupIds,
    frameId: text.frameId,
    locked: text.locked,
    opacity: text.opacity,
    boundElements: text.boundElements?.filter((b) => b.type === "arrow") ?? null,
  } as never);
}

/**
 * Converts the given free native text elements in one scene update. Returns
 * the old → new element id map (empty when nothing qualified).
 */
export function convertNativeTexts(
  api: ExcalidrawImperativeAPI,
  home: DocumentHome,
  ids: Iterable<string>,
  captureUpdate: CaptureUpdate = CaptureUpdateAction.IMMEDIATELY,
): Map<string, string> {
  const wanted = new Set(ids);
  const scene = api.getSceneElementsIncludingDeleted();
  const items = new Map<string, ExcalidrawElement>();
  for (const el of scene) if (wanted.has(el.id) && isFreeNativeText(el)) items.set(el.id, textItemFor(home, el));
  const renamed = new Map([...items].map(([oldId, item]) => [oldId, item.id]));
  if (!items.size) return renamed;

  const retarget = (b: Binding): Binding => (b && renamed.has(b.elementId) ? { ...b, elementId: renamed.get(b.elementId)! } : b);
  const elements = scene.flatMap((el): ExcalidrawElement[] => {
    const item = items.get(el.id);
    if (item) return [newElementWith(el, { isDeleted: true, boundElements: null }), item];
    if (el.type === "arrow" && !el.isDeleted) {
      const { startBinding, endBinding } = el as unknown as { startBinding: Binding; endBinding: Binding };
      if (retarget(startBinding) !== startBinding || retarget(endBinding) !== endBinding) {
        return [newElementWith(el, { startBinding: retarget(startBinding), endBinding: retarget(endBinding) } as never)];
      }
    }
    return [el];
  });

  const selectedElementIds: Record<string, true> = {};
  for (const id of Object.keys(api.getAppState().selectedElementIds)) selectedElementIds[renamed.get(id) ?? id] = true;
  api.updateScene({ elements, appState: { selectedElementIds } as Partial<AppState> as never, captureUpdate });
  return renamed;
}

/** "Convert to rich text" on one element: one undo step. Returns the new element id. */
export function convertNativeText(api: ExcalidrawImperativeAPI, home: DocumentHome, elementId: string): string | null {
  return convertNativeTexts(api, home, [elementId]).get(elementId) ?? null;
}

/**
 * Converts free native text as it enters the scene (see the file comment).
 * Call `handleChange` from Excalidraw `onChange`: O(1) unless the scene array
 * was replaced, then one pass over the elements.
 */
export class NativeTextIntake {
  private readonly known = new Set<string>();
  private readonly pending = new Set<string>();
  private lastElements: readonly ExcalidrawElement[] | null = null;
  private paused = 0;

  constructor(
    private readonly home: DocumentHome,
    /** The scene the canvas opened with: its native text is not converted. */
    initialElements: readonly ExcalidrawElement[] = [],
  ) {
    for (const el of initialElements) this.known.add(el.id);
  }

  /**
   * Native text added while `run` is in flight stays native (dev/perf seeding
   * measures native text on purpose). The scene is read directly at the end:
   * Excalidraw's change event for the last update may arrive later.
   */
  async keepNative<T>(api: ExcalidrawImperativeAPI, run: () => Promise<T>): Promise<T> {
    this.paused++;
    try {
      return await run();
    } finally {
      for (const el of api.getSceneElementsIncludingDeleted()) this.known.add(el.id);
      this.paused--;
    }
  }

  handleChange(api: ExcalidrawImperativeAPI, elements: readonly ExcalidrawElement[], appState: AppState): void {
    if (elements === this.lastElements) return;
    this.lastElements = elements;
    if (this.paused) {
      for (const el of elements) this.known.add(el.id);
      return;
    }
    const editing = appState.editingTextElement?.id;
    const wasPending = this.pending.size > 0;
    for (const el of elements) {
      if (this.known.has(el.id)) continue;
      // Undecided while being typed (the T tool's takeover owns that) or while still empty.
      const undecided = el.type === "text" && !el.isDeleted && !(el as ExcalidrawTextElement).containerId && (el.id === editing || !isFreeNativeText(el));
      if (undecided) continue;
      this.known.add(el.id);
      if (isFreeNativeText(el)) this.pending.add(el.id);
    }
    if (wasPending || !this.pending.size) return;
    // After the update that added them (not inside Excalidraw's own update) and well
    // inside the history settle time, so e.g. a paste and its conversion are one undo step.
    queueMicrotask(() => {
      const editingNow = api.getAppState().editingTextElement?.id;
      const ids = [...this.pending].filter((id) => id !== editingNow);
      this.pending.clear();
      for (const newId of convertNativeTexts(api, this.home, ids).values()) this.known.add(newId);
    });
  }
}
