/**
 * BlockNote file hooks for images in pages: `uploadFile` stores the picked,
 * pasted or dropped file in the asset store; `resolveFileUrl` turns the
 * stored reference back into something an <img> can show.
 */
import { getCanvasCommands } from "@/components/canvas/canvasCommands";
import { resolveImageUrl, storeImage } from "../imageAssets";

/**
 * On failure the block becomes an empty paragraph again (rather than an image
 * block with nothing in it) and the user is told why.
 */
export async function uploadImage(file: File): Promise<Record<string, unknown>> {
  try {
    return { props: { name: file.name, url: await storeImage(file) } };
  } catch (err) {
    const message = err instanceof Error ? err.message : "This image could not be added.";
    const canvas = getCanvasCommands();
    if (canvas) canvas.notify(message);
    else console.warn("[acute-notes]", message);
    return { type: "paragraph", props: {}, content: [] };
  }
}

export const resolveFileUrl = resolveImageUrl;
