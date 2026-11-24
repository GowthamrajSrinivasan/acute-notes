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
 *
 * Knowledge Notes (knowledge-notes-plan §4.1, §6.2, WP1.3) adds `sourceUnits`, `noteModel` and `review`. "review" is an
 * everyday word in this code base (the review bar, "up for review: …"), so it is matched only as a property read
 * (`ai.review`, `meta?.review`) or an optional field declaration (`review?:`), never as a word in a string. A module path
 * (`@/ai/fidelity/sourceUnits`) isn't a field either.
 */
const RECONCILIATION_FIELD =
  /(?<![/\w])(contentSourceId|contentSourceVersion|stableNodeKey|contentFingerprint|modificationState|excludeFromReconciliation|splitOf|splitFingerprint|sourceUnits|noteModel)\b|(?<=[\w)\]?])\.review\b|\breview\?:/;
const RECONCILIATION_DIR = rel("ai/reconcile/");
const RECONCILIATION_READERS: Record<string, string> = {
  [rel("domain/types.ts")]: "declares the fields",
  [rel("domain/provenance.ts")]: "normalizes them (only on request) and reads an object's link",
  [rel("ai/changes/changeSet.ts")]: "carries each created/updated object's stable key to the writer",
  [rel("components/ai/unapplied.ts")]: "Stage 1 gate 4 follow-up (2026-11-15): reads the stable node key of a dropped patch or an undecided conflict (change-set items, never an object's metadata) so the recorded source version keeps that node as it was",
  [rel("ai/changes/staleTarget.ts")]: "stale-target protection (2026-11-15): copies an update_block's stable node key onto the Keep mine / Use proposed decision it becomes (change-set items, never an object's metadata)",
  [rel("ai/renderer/mapNode.ts")]: "copies a node's stableKey onto its create change",
  [rel("components/canvas/changeSetWriter.ts")]: "stamps the link and baseline fingerprint on write",
  [rel("components/canvas/reconcileActions.ts")]: "the explicit user actions: opt out, update the source from an edit",
  [rel("testUtils/reconcileHarness.ts")]: "test-only: stamps accepted objects as the writer would, for the update and topic-merge tests",
  [rel("testUtils/repoMapWorld.ts")]: "test-only: the Repo Map test world's writer stamps the link and fingerprints as changeSetWriter.ts does",
  [rel("ai/fidelity/contracts.ts")]: "declares the Knowledge Notes types the fields hold (NoteModel, CardReview) and the run output the evaluation reads",
  [rel("config/fidelity.ts")]: "declares the noteModel switch (a developer setting until R1); never reads an object's metadata",
  [rel("ai/visualize/tasks.ts")]: "the generation input's noteModel picks the distil wording rules (§4.4); never reads an object's metadata",
  [rel("ai/visualize/outlined.ts")]: "reads the noteModel switch to send distil section prompts with labelled units; never reads an object's metadata",
  [rel("ai/visualize/types.ts")]: "VisualizeInput.noteModel: the run's own note model (WP2.8 'Keep full detail'); never reads an object's metadata",
  [rel("ai/ingest/ingest.ts")]: "passes the dialog's per-run noteModel through to visualizeContent (WP2.8); never reads an object's metadata",
  [rel("components/ai/VisualizeDialog.tsx")]: "the note model choice ('Distil into key ideas' before R1, 'Keep full detail' from R1) sets the run's noteModel (WP2.8); never reads an object's metadata",
  [rel("ai/visualize/analysisPatch.ts")]: "the analysis patch's input noteModel picks the distil analysis wording (§4.4); never reads an object's metadata",
  [rel("ai/visualize/visualize.ts")]: "stamps noteModel on a distil run's change set and its cards' units on the content source it records (WP1.10); never reads an object's metadata",
  [rel("components/canvas/ExcalidrawCanvas.tsx")]: "dev builds only: __acuteDev.setNoteModel switches the noteModel developer setting for the fidelity e2e (§6.3); never reads an object's metadata",
  [rel("components/review/chipView.ts")]: "Lane H (not mounted): a card's source chip shows amber while its review is open; given the card's review by the caller, never reads object metadata itself",
  [rel("components/review/queue.ts")]: "Lane H (not mounted): the review queue is rebuilt from cards' stored reviews; given them by the caller, never reads object metadata itself",
  [rel("ai/fidelity/knowledgeRun.ts")]: "builds a distil run's per-card sourceUnits and review for the writer (by stable key) and the run output; never reads an object's metadata",
  [rel("components/review/knowledgeObjects.ts")]:
    "the review UI's one reader of a distil object's link (`reconciliationOf`): its source version, cited units and review, for the Source tab, chips and queue (knowledge-notes-plan §5); never for preserve objects",
  [rel("components/review/knowledgeActions.ts")]:
    "the user's own review actions (Keep, Use source wording, Pin quote, Include): resolves a card's review and adds a passage card citing its unit; given the objects by knowledgeObjects.ts",
  [rel("components/review/KnowledgeOverlay.tsx")]: "draws a distil card's source chip from the review knowledgeObjects.ts gives it (amber while open)",
  [rel("components/review/KnowledgeReviewBar.tsx")]: "builds the review queue from the cards' stored reviews and the source version's passage record (U3, U8); given the objects by knowledgeObjects.ts",
  [rel("components/openui/notes/notesModel.ts")]:
    "the OpenUI Notes view (openui-integration-plan Phase 2): shows a distil card's cited units and whether its review is open, read-only, from the objects knowledgeObjects.ts gives it",
  [rel("components/openui/notes/promotion.ts")]:
    "pins a generated note as a new card (openui-integration-plan Phase 2): stamps its cited units and the distil note model through the change set's `passage` path, as knowledgeActions.ts's Add to canvas does",
  [rel("components/ai/ChangeSetReview.tsx")]:
    "names a citation-driven update's `mark_review` change in the review list by its first reason (the proposed change's own review, §6.1); never reads object metadata",
  [rel("portability/sanitize.ts")]:
    "export/import with sources (knowledge-notes-plan §6.4): keeps an object's link only when its source is in the file, and remaps it to the imported source's new id",
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
