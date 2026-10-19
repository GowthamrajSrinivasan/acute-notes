/**
 * Standing invariant (PRD §5.1, F25): provenance is descriptive only.
 *
 * 1. Nothing branches on `createdBy`. The only comparison allowed is in
 *    `domain/provenance.ts`, which decides whether there is an origin to show.
 * 2. Object provenance (`metadata.ai`, `customData.acuteMeta`) is read only in
 *    the files that stamp, sanitize, serialize or display it. A new reader
 *    fails this test until it is reviewed and added below with its reason.
 *
 * (The F37–F39 reconciliation fields are the one planned exception; see the
 * second suite below.)
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const SRC = join(fileURLToPath(new URL(".", import.meta.url)), "..");
const rel = (p: string) => p.split("/").join(sep);

/** Files allowed to read object provenance, and why. */
const READERS: Record<string, string> = {
  [rel("domain/provenance.ts")]: "the provenance module: sanitize, describe, find an operation's objects",
  [rel("domain/canvas/adapter.ts")]: "renderer ⇄ domain conversion (sanitized via provenance.ts)",
  [rel("portability/sanitize.ts")]: "import/export sanitizing",
  [rel("portability/exportOptions.ts")]: "removes provenance from a canvas export when the user turns Origin off (never reads or branches on it)",
  [rel("components/canvas/changeSetWriter.ts")]: "stamps provenance on created shapes and arrows",
  [rel("components/properties/ProvenanceSection.tsx")]: "displays an object's origin",
  [rel("mcp/context/currentContext.ts")]: "serializes provenance for MCP clients: acute://context/current, every resource and the read tools (via describeObject / documentProvenance)",
  [rel("components/canvas/reconcileActions.ts")]: "patches the reconciliation fields in metadata.ai on explicit user actions (F39)",
  [rel("testUtils/repoMapWorld.ts")]: "test-only: the Repo Map test world's fake canvas stamps and reads provenance as changeSetWriter.ts does",
};

const CREATED_BY_BRANCH = /createdBy\s*[!=]==?|switch\s*\([^)]*createdBy|createdBy\s*\?(?!\?)/;
const PROVENANCE_READ = /metadata\??\.ai\b|\bacuteMeta\b|provenanceOf\(|getObjectMetadata\(|objectsFromOperation\(|describeProvenance\(/;

function sources(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (entry === "node_modules" || entry === ".next") continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) sources(full, out);
    else if (/\.(ts|tsx)$/.test(entry) && !/\.test\.tsx?$/.test(entry)) out.push(full);
  }
  return out;
}

/** Code without comments (so documentation may mention the fields). */
function code(file: string): string {
  return readFileSync(file, "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:"'`])\/\/.*$/gm, "$1");
}

describe("provenance is descriptive only", () => {
  const files = sources(SRC).map((f) => ({ path: relative(SRC, f), code: code(f) }));

  it("no code branches on createdBy outside domain/provenance.ts", () => {
    const offenders = files.filter((f) => f.path !== rel("domain/provenance.ts") && CREATED_BY_BRANCH.test(f.code)).map((f) => f.path);
    expect(offenders).toEqual([]);
  });

  it("object provenance is read only by the reviewed readers", () => {
    const offenders = files.filter((f) => !(f.path in READERS) && PROVENANCE_READ.test(f.code)).map((f) => f.path);
    expect(offenders).toEqual([]);
  });

  it("every listed reader still exists and still reads provenance (the list stays honest)", () => {
    for (const path of Object.keys(READERS)) {
      const file = files.find((f) => f.path === path);
      expect(file, path).toBeDefined();
      expect(PROVENANCE_READ.test(file!.code), path).toBe(true);
    }
  });
});

/**
 * F37: the reconciliation fields are the one planned exception to "descriptive
 * only" — read by the reconciliation engine (F38) and the code that stamps or
 * maintains them, and by nothing else: never by editing, rendering, search,
 * export or MCP.
 */
const RECONCILIATION_FIELD = /\b(contentSourceId|contentSourceVersion|stableNodeKey|contentFingerprint|modificationState|excludeFromReconciliation|splitOf|splitFingerprint)\b/;
const RECONCILIATION_DIR = rel("ai/reconcile/");
const RECONCILIATION_READERS: Record<string, string> = {
  [rel("domain/types.ts")]: "declares the fields",
  [rel("domain/provenance.ts")]: "normalizes them (only on request) and reads an object's link",
  [rel("ai/changes/changeSet.ts")]: "carries each created/updated object's stable key to the writer",
  [rel("ai/renderer/mapNode.ts")]: "copies a node's stableKey onto its create change",
  [rel("components/canvas/changeSetWriter.ts")]: "stamps the link and baseline fingerprint on write",
  [rel("components/canvas/reconcileActions.ts")]: "the explicit user actions: opt out, update the source from an edit",
  [rel("testUtils/reconcileHarness.ts")]: "test-only: stamps accepted objects as the writer would, for the update and topic-merge tests",
  [rel("testUtils/repoMapWorld.ts")]: "test-only: the Repo Map test world's writer stamps the link and fingerprints as changeSetWriter.ts does",
};

/**
 * Acute Lens Phase 2 (plan D21, signed off 2026-10-03): a Repo Map / Visualize object's reconciliation key is its Lens
 * identity, read through `lensIdentityOf` and nowhere else — by the one module that states the Lens identity rule.
 */
const LENS_IDENTITY_READ = /\blensIdentityOf\(/;
const LENS_IDENTITY_READERS: Record<string, string> = {
  [rel("domain/provenance.ts")]: "defines lensIdentityOf over the object's normalised provenance",
  [rel("domain/lens/identity.ts")]: "the Lens identity rule (D21): acuteNode.key, else the map identity unless the node is a copy, else the id",
};

describe("the Lens identity of map objects is read only by the Lens identity rule (D21)", () => {
  const files = sources(SRC).map((f) => ({ path: relative(SRC, f), code: code(f) }));

  it("lensIdentityOf is called only by the reviewed readers", () => {
    const offenders = files.filter((f) => !(f.path in LENS_IDENTITY_READERS) && LENS_IDENTITY_READ.test(f.code)).map((f) => f.path);
    expect(offenders).toEqual([]);
  });

  it("every listed reader still uses it (the list stays honest)", () => {
    for (const path of Object.keys(LENS_IDENTITY_READERS)) {
      const file = files.find((f) => f.path === path);
      expect(file, path).toBeDefined();
      expect(LENS_IDENTITY_READ.test(file!.code), path).toBe(true);
    }
  });
});

describe("reconciliation fields are inert outside the reconciliation engine (F37)", () => {
  const files = sources(SRC).map((f) => ({ path: relative(SRC, f), code: code(f) }));

  it("are named only in the engine and the reviewed files that stamp or carry them", () => {
    const offenders = files.filter((f) => !f.path.startsWith(RECONCILIATION_DIR) && !(f.path in RECONCILIATION_READERS) && RECONCILIATION_FIELD.test(f.code)).map((f) => f.path);
    expect(offenders).toEqual([]);
  });

  it("every listed file still uses them (the list stays honest)", () => {
    for (const path of Object.keys(RECONCILIATION_READERS)) {
      const file = files.find((f) => f.path === path);
      expect(file, path).toBeDefined();
      expect(RECONCILIATION_FIELD.test(file!.code), path).toBe(true);
    }
  });
});
