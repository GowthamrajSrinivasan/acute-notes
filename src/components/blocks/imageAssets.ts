/**
 * Browser side of images in rich content (see `domain/content/assetUrl.ts`):
 * checking a file is a readable image, storing it in the asset store, and
 * resolving `acute-asset://` URLs for display.
 */
import { assetIdOf, assetUrl } from "@/domain/content/assetUrl";
import { getPersistence } from "@/persistence";

/** Larger files are refused rather than stored (IndexedDB copes, exports and sync would not). */
export const MAX_IMAGE_BYTES = 20 * 1024 * 1024;

/** True when the browser can decode `blob` as an image. */
export async function canDecodeImage(blob: Blob): Promise<boolean> {
  const url = URL.createObjectURL(blob);
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    return true;
  } catch {
    return false;
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** HEIC/HEIF (iPhone photos), often saved under a .jpg name: the bytes read `....ftypheic`. */
export function looksLikeHeic(head: Uint8Array): boolean {
  const brand = String.fromCharCode(...head.slice(4, 12));
  return /^ftyp(heic|heix|hevc|hevx|mif1|msf1)$/.test(brand);
}

export function unreadableImageMessage(heic: boolean): string {
  return heic
    ? "This image is a HEIC photo, which browsers can't display. Convert it to JPG or PNG and try again."
    : "This image can't be read: the file may be damaged or in a format browsers can't display. Try a PNG, JPG, GIF, WebP or SVG.";
}

async function sha1Hex(buffer: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-1", buffer);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * Stores an image file and returns its `acute-asset://` URL. Throws an Error
 * with a user-facing message when the file is not a readable image.
 */
export async function storeImage(file: Blob): Promise<string> {
  if (file.size > MAX_IMAGE_BYTES) throw new Error(`This image is larger than ${MAX_IMAGE_BYTES / 1024 / 1024} MB.`);
  const buffer = await file.arrayBuffer();
  if (!file.type.startsWith("image/") || !(await canDecodeImage(file))) {
    throw new Error(unreadableImageMessage(looksLikeHeic(new Uint8Array(buffer, 0, Math.min(16, buffer.byteLength)))));
  }
  // Content hash, as Excalidraw names canvas images: the same picture is stored once.
  const id = await sha1Hex(buffer);
  const assets = getPersistence().assets;
  if (!(await assets.has(id))) await assets.put({ id, blob: file, mimeType: file.type, createdAt: Date.now() });
  return assetUrl(id);
}

/** Blob URLs of stored assets, kept for the session (images are shown again and again). */
const resolved = new Map<string, Promise<string>>();

/** A displayable URL: stored assets become blob URLs; other URLs pass through. "" when the asset is missing. */
export function resolveImageUrl(url: string): Promise<string> {
  const id = assetIdOf(url);
  if (!id) return Promise.resolve(url);
  let hit = resolved.get(id);
  if (!hit) {
    hit = getPersistence()
      .assets.get(id)
      .then((asset) => (asset ? URL.createObjectURL(asset.blob) : ""));
    hit.then(
      (u) => u || resolved.delete(id),
      () => resolved.delete(id),
    );
    resolved.set(id, hit);
  }
  return hit.catch(() => "");
}
