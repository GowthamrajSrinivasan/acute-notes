/**
 * An image added to the canvas that the browser can't decode (a HEIC photo
 * saved as .jpg, a damaged file) would stay on the canvas as a broken image
 * (Excalidraw marks it `status: "error"`). Such a new image is removed again,
 * with a message saying why.
 *
 * Only images added in this session count: an image whose stored file fails
 * to load on open is kept, so nothing the user saved disappears.
 */
import { CaptureUpdateAction, newElementWith } from "@excalidraw/excalidraw";
import type { ExcalidrawElement } from "@excalidraw/excalidraw/element/types";
import type { BinaryFiles, ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";
import { looksLikeHeic, unreadableImageMessage } from "@/components/blocks/imageAssets";

function headOfDataURL(dataURL: string | undefined): Uint8Array {
  const base64 = dataURL?.split(",", 2)[1]?.slice(0, 24) ?? "";
  try {
    return Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
  } catch {
    return new Uint8Array();
  }
}

export function createBrokenImageGuard() {
  /** Images present when the canvas opened, or already judged. */
  const settled = new Set<string>();
  let started = false;
  let lastElements: readonly ExcalidrawElement[] | null = null;

  return {
    handleChange(api: ExcalidrawImperativeAPI, elements: readonly ExcalidrawElement[], files: BinaryFiles): void {
      if (elements === lastElements) return;
      lastElements = elements;
      const broken: ExcalidrawElement[] = [];
      for (const el of elements) {
        if (el.type !== "image" || el.isDeleted || settled.has(el.id)) continue;
        if (!started || el.status === "saved") settled.add(el.id);
        else if (el.status === "error") {
          settled.add(el.id);
          broken.push(el);
        }
      }
      started = true;
      if (!broken.length) return;
      const ids = new Set(broken.map((el) => el.id));
      const first = broken[0]!;
      const heic = first.type === "image" && !!first.fileId && looksLikeHeic(headOfDataURL(files[first.fileId]?.dataURL));
      queueMicrotask(() => {
        api.updateScene({
          elements: api.getSceneElementsIncludingDeleted().map((el) => (ids.has(el.id) ? newElementWith(el, { isDeleted: true }) : el)),
          captureUpdate: CaptureUpdateAction.NEVER,
        });
        api.setToast({ message: unreadableImageMessage(heic), closable: true, duration: 8000 });
      });
    },
  };
}
