// Builds the desktop app icons from src/asset/logo.png (1536x1024 on black):
// crops the centred 1024x1024 square, writes build/icon.png (used by
// electron-builder for macOS .icns and as the window icon) and build/icon.ico.
import sharp from "sharp";
import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const src = join(root, "src", "asset", "logo.png");
const { width, height } = await sharp(src).metadata();
const side = Math.min(width, height);
const square = sharp(src).extract({ left: Math.round((width - side) / 2), top: 0, width: side, height: side });

await square.clone().resize(1024, 1024).png().toFile(join(root, "build", "icon.png"));

// ICO with PNG-compressed entries (supported by Windows Vista+).
const sizes = [16, 24, 32, 48, 64, 128, 256];
const pngs = await Promise.all(sizes.map((s) => square.clone().resize(s, s).png().toBuffer()));
const header = Buffer.alloc(6);
header.writeUInt16LE(1, 2);
header.writeUInt16LE(sizes.length, 4);
let offset = 6 + 16 * sizes.length;
const entries = sizes.map((s, i) => {
  const e = Buffer.alloc(16);
  e.writeUInt8(s === 256 ? 0 : s, 0);
  e.writeUInt8(s === 256 ? 0 : s, 1);
  e.writeUInt16LE(1, 4);
  e.writeUInt16LE(32, 6);
  e.writeUInt32LE(pngs[i].length, 8);
  e.writeUInt32LE(offset, 12);
  offset += pngs[i].length;
  return e;
});
writeFileSync(join(root, "build", "icon.ico"), Buffer.concat([header, ...entries, ...pngs]));
console.log("[icons] wrote build/icon.png and build/icon.ico");
