// Content-addressed asset files beside the database. The SQLite `assets` table holds only metadata.
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

const HASH_ID = /^[0-9a-f]{40}$/;

/**
 * File name for an asset id. Real ids are SHA-1 content hashes (hex) and are used as-is, sharded by their first
 * two characters. Any other id (tests, legacy) gets a name derived from a SHA-256 of the id, so no id can ever
 * contain a path separator or `..`, or collide with another on a case-insensitive file system.
 */
function fileNameFor(id) {
  if (HASH_ID.test(id)) return path.join(id.slice(0, 2), id);
  const digest = crypto.createHash("sha256").update(id).digest("hex");
  return path.join("x", digest.slice(0, 2), digest);
}

/** @param {string} root directory that holds the asset files */
function createAssetFiles(root) {
  const resolve = (rel) => {
    const full = path.join(root, rel);
    if (path.relative(root, full).startsWith("..")) throw new Error("Invalid asset path.");
    return full;
  };
  return {
    fileNameFor,
    /** Atomic write: a temp file in the same folder, then rename, so a crash never leaves a partial asset. */
    write(rel, bytes) {
      const full = resolve(rel);
      fs.mkdirSync(path.dirname(full), { recursive: true });
      const tmp = `${full}.${process.pid}.${crypto.randomBytes(4).toString("hex")}.tmp`;
      try {
        fs.writeFileSync(tmp, bytes);
        fs.renameSync(tmp, full);
      } catch (err) {
        fs.rmSync(tmp, { force: true });
        throw err;
      }
    },
    read(rel) {
      try {
        return new Uint8Array(fs.readFileSync(resolve(rel)));
      } catch (err) {
        if (err && err.code === "ENOENT") return null;
        throw err;
      }
    },
    exists: (rel) => fs.existsSync(resolve(rel)),
    remove: (rel) => fs.rmSync(resolve(rel), { force: true }),
  };
}

module.exports = { createAssetFiles, fileNameFor };
