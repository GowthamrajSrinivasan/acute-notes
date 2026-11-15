// Writes FREEZE-v3.1.json: sha256 of every file in dataset-v3.1/ except the freeze itself.
// Provisional (v3.1-pre): the re-adjudication queue is open, so this is not the reference freeze.
// Refuses if FREEZE-v3 does not match. Run after migrate.mjs and after any edit to this folder.
import { createHash } from "node:crypto";
import { readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";
import { verifyFreezeV3 } from "./migrate.mjs";

const HERE = import.meta.dirname;
const v3 = verifyFreezeV3();
if (v3.bad.length || v3.ok !== 41) throw new Error("FREEZE-v3 mismatch");
const walk = (d, out = []) => {
  for (const n of readdirSync(d)) {
    const p = join(d, n);
    statSync(p).isDirectory() ? walk(p, out) : out.push(p);
  }
  return out;
};
const sha256 = {};
for (const p of walk(HERE).map((p) => relative(HERE, p).replaceAll("\\", "/")).filter((f) => f !== "FREEZE-v3.1.json").sort())
  sha256[p] = createHash("sha256").update(readFileSync(join(HERE, p))).digest("hex");
writeFileSync(join(HERE, "FREEZE-v3.1.json"), JSON.stringify({
  version: "v3.1-pre",
  status: "provisional freeze: the re-adjudication queue (READJUDICATION-QUEUE.json) is open; not yet the reference dataset",
  frozenOn: "2026-11-15",
  base: { file: "phase4/FREEZE-v3.json", filesVerified: v3.ok },
  sha256,
}, null, 2) + "\n");
console.log(`FREEZE-v3.1 (provisional): ${Object.keys(sha256).length} files; FREEZE-v3 ${v3.ok}/${v3.total}`);
