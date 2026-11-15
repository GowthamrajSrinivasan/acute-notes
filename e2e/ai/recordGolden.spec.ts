/**
 * Golden-dataset recorder (`evaluation/knowledge-notes/README.md` "Record and replay"): for each case, runs Visualize
 * on its `source.md` with a real model, accepts the result, and saves what the offline replay scores:
 *
 *   evaluation/knowledge-notes/recordings/<run>/meta.json            recording-meta.schema.json, `gate: false`
 *   evaluation/knowledge-notes/recordings/<run>/<case>/plan.json     the merged, validated VisualPlan (the content
 *                                                                    source's accepted version: `validateVisualPlan`
 *                                                                    + stable keys, exactly what was rendered)
 *   …/<case>/scene.json        the accepted canvas (elements + their documents): Lens projection derived offline
 *   …/<case>/scene-before.json the update case only: the v1 canvas with the user's edit, before "Update from new content"
 *   …/<case>/run.json          the run's own output (units, cites, …) when the app exposes it (`__acuteDev.knowledgeRun`)
 *   …/<case>/replies.json      every AI call's prompt and raw reply, for debugging
 *
 * It costs money (one Visualize per case and attempt, plus one update) and needs the user's approval for each run, so
 * it REFUSES to run unless `GOLDEN_RECORD_RUN` names the approved run (`YYYY-MM-DD-name`, a new directory: never
 * re-record over an existing run) and `GOLDEN_RECORD_APPROVED_BY` says who approved it. Like every `e2e/ai` spec it
 * only exists for Playwright under `npm run test:e2e:ai` (which asks before anything runs):
 *
 *   GOLDEN_RECORD_RUN=2026-11-02-preserve-baseline GOLDEN_RECORD_APPROVED_BY="<name>" \
 *     npm run test:e2e:ai -- --provider=aicredits e2e/ai/recordGolden.spec.ts --trace off --output test-results/golden-record
 *
 * Optional: GOLDEN_RECORD_CASES=kn-01,kn-08 (case id prefixes; default all), GOLDEN_RECORD_ATTEMPTS=3 (§7.3: gating
 * cases are recorded 3 times; default 1), GOLDEN_RECORD_NOTE_MODEL (default preserve: what the app runs today),
 * GOLDEN_RECORD_PROMPT_VERSION (default the git commit). Then `npm run test:golden` replays it offline.
 *
 * Deliberately free of `@/` and evaluation imports: everything it saves is raw, and every derivation (Lens projection,
 * update outcome, scoring) happens in the replay, so a better adapter re-scores old recordings for free.
 */
import { execSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test, type Page, type Request } from "@playwright/test";
import { action, aiTaskOf, openApp, openAskAI, recordAIRequests } from "../helpers";
import { AI_PROVIDER, AI_PROVIDER_NAME, connectAI } from "../aiProvider";
import { AI_TIMEOUT, nothingChanged, reviewBar, updateDialog, visualizeDialog } from "../aiReview";

const ROOT = fileURLToPath(new URL("../../", import.meta.url));
const DATASET = join(ROOT, "evaluation", "knowledge-notes");
const RUN_ID = process.env.GOLDEN_RECORD_RUN ?? "";
const APPROVED_BY = (process.env.GOLDEN_RECORD_APPROVED_BY ?? "").trim();
const RUN_DIR = join(DATASET, "recordings", RUN_ID);
const ATTEMPTS = Math.max(1, Number(process.env.GOLDEN_RECORD_ATTEMPTS) || 1);
const NOTE_MODEL = process.env.GOLDEN_RECORD_NOTE_MODEL === "distil" ? "distil" : "preserve";
const ONLY = (process.env.GOLDEN_RECORD_CASES ?? "").split(",").map((s) => s.trim()).filter(Boolean);
const CANVAS_ID = "recorded";

/** Why this run must not happen, or "" when it was approved and named properly. */
function refusal(): string {
  if (!RUN_ID) return "GOLDEN_RECORD_RUN is not set: recording costs money and needs an approved, named run";
  if (!/^\d{4}-\d{2}-\d{2}-[a-z0-9-]+$/.test(RUN_ID)) return `GOLDEN_RECORD_RUN "${RUN_ID}" must look like 2026-11-02-preserve-baseline`;
  if (!APPROVED_BY) return "GOLDEN_RECORD_APPROVED_BY is not set: say who approved this run";
  if (process.env.ACUTE_AI_E2E !== "1") return "run it through `npm run test:e2e:ai`, which asks before spending";
  if (existsSync(join(RUN_DIR, "meta.json"))) return `recordings/${RUN_ID} already exists: a new recording is a new run directory`;
  return "";
}

// ---------------------------------------------------------------- the dataset (read as plain JSON)

interface CaseEntry {
  id: string;
  directory: string;
  files: { case: string; reconcile?: string; lens?: string };
}
interface CaseFile {
  sourceFiles: { version: number; path: string }[];
}
interface UserEdit {
  before: string;
  after: string;
}

const readJson = <T,>(path: string): T => JSON.parse(readFileSync(path, "utf8").replace(/^﻿/, "")) as T;
const readSource = (path: string) => readFileSync(path, "utf8").replace(/^﻿/, "").replace(/\r\n?/g, "\n");

function casesToRecord(): CaseEntry[] {
  const manifest = readJson<{ cases: CaseEntry[] }>(join(DATASET, "dataset-manifest.json"));
  return manifest.cases.filter((c) => !ONLY.length || ONLY.some((p) => c.id.startsWith(p)));
}

// ---------------------------------------------------------------- what the recording says about itself

type MetaCase = { caseId: string; attempt?: number; plan?: string; scene?: string; sceneBefore?: string; run?: string; replies?: string; note?: string };
const metaCases: MetaCase[] = [];
const modelsSeen = new Set<string>();

function gitVersion(): string {
  try {
    const sha = execSync("git rev-parse --short HEAD", { cwd: ROOT }).toString().trim();
    const dirty = execSync("git status --porcelain", { cwd: ROOT }).toString().trim() ? "-dirty" : "";
    return `git-${sha}${dirty}`;
  } catch {
    return "unknown";
  }
}

/** Written after every case, so a run that stops half-way still replays what it recorded. */
function writeMeta(): void {
  const meta = {
    datasetVersion: readJson<{ datasetVersion: string }>(join(DATASET, "dataset-manifest.json")).datasetVersion,
    runId: RUN_ID,
    recordedAt: new Date().toISOString(),
    approvedBy: APPROVED_BY,
    provider: AI_PROVIDER_NAME[AI_PROVIDER],
    model: [...modelsSeen].join(", ") || process.env[`ACUTE_TEST_${AI_PROVIDER.toUpperCase()}_MODEL`] || "unknown",
    pipeline: {
      noteModel: NOTE_MODEL,
      promptVersion: process.env.GOLDEN_RECORD_PROMPT_VERSION || gitVersion(),
      appVersion: readJson<{ version: string }>(join(ROOT, "package.json")).version,
    },
    // A first run is reported only; set true by hand once its results are reviewed (recordings/README.md).
    gate: false,
    cases: metaCases,
  };
  mkdirSync(RUN_DIR, { recursive: true });
  writeFileSync(join(RUN_DIR, "meta.json"), `${JSON.stringify(meta, null, 2)}\n`);
}

// ---------------------------------------------------------------- the app, through its dev hooks

type Dev = {
  api: { getSceneElements(): { id: string; type: string; isDeleted?: boolean; customData?: { acute?: { documentId?: string; pageId?: string } } }[]; updateScene(s: { elements: unknown[] }): void };
  store: { get(id: string): { snapshot?: unknown[] } | null | undefined; updateSnapshot(id: string, snapshot: unknown[], title?: string): void };
  reconciliation(id: string): Promise<{ link: { contentSourceId: string } | null } | null>;
  contentSource(id: string): Promise<{ version: { version: number; plan: unknown } } | null>;
  callStats(clear?: boolean): Promise<{ records: { model?: string }[] }>;
  /** Not in the app yet (requested from the integrator): the run's KnowledgeRunOutput without its plan. */
  knowledgeRun?: (sourceId: string) => Promise<unknown>;
  /** Dev builds: switches `FIDELITY_CONFIG.noteModel` (a developer setting until R1) and returns the model now in force. */
  setNoteModel?: (model: "preserve" | "distil") => Promise<string>;
};

const dev = <T, A = string>(p: Page, fn: (d: Dev, arg: A) => Promise<T> | T, arg?: A) =>
  p.evaluate(({ f, a }) => new Function("d", "a", `return (${f})(d, a)`)((window as unknown as { __acuteDev: Dev }).__acuteDev, a), { f: fn.toString(), a: arg }) as Promise<T>;

/** The accepted canvas: live elements and every block/page document they show. */
function sceneOf(p: Page): Promise<{ canvasId: string; elements: unknown[]; documents: Record<string, unknown> }> {
  return dev(
    p,
    (d, canvasId) => {
      const elements = d.api.getSceneElements().filter((e) => !e.isDeleted);
      const documents: Record<string, unknown> = {};
      for (const e of elements) {
        const id = e.customData?.acute?.documentId ?? e.customData?.acute?.pageId;
        if (id) documents[id] = d.store.get(id) ?? null;
      }
      return { canvasId, elements: JSON.parse(JSON.stringify(elements)), documents: JSON.parse(JSON.stringify(documents)) };
    },
    CANVAS_ID,
  );
}

/** An element linked to a content source, and that source's id (`reconciliation` link, F37). */
function linkedObject(p: Page): Promise<{ elementId: string; sourceId: string } | null> {
  return dev(p, async (d) => {
    for (const el of d.api.getSceneElements()) {
      if (el.isDeleted) continue;
      const link = (await d.reconciliation(el.id))?.link;
      if (link) return { elementId: el.id, sourceId: link.contentSourceId };
    }
    return null;
  });
}

/**
 * The user's edit of the update case: their text appended to the block that says `before` ("exact"). In distil mode a
 * card paraphrases its passage, so no block holds the source's wording: then the block sharing the most content words
 * with `before` takes it ("closest", at least 4 shared words). False when neither is found.
 */
function applyUserEdit(p: Page, edit: UserEdit): Promise<"exact" | "closest" | false> {
  return dev(
    p,
    (d, e) => {
      const norm = (s: string) => s.replace(/\s+/g, " ").trim().toLowerCase();
      const head = norm(e.before).slice(0, 60);
      const added = e.after.startsWith(e.before) ? e.after.slice(e.before.length).trim() : e.after;
      const texts = (v: unknown, out: string[]) => {
        if (typeof v === "string") out.push(v);
        else if (Array.isArray(v)) v.forEach((x) => texts(x, out));
        else if (v && typeof v === "object") for (const [k, x] of Object.entries(v)) if (k !== "id" && k !== "type" && k !== "props" && k !== "styles") texts(x, out);
      };
      const append = (id: string, snapshot: unknown[]) => {
        const paragraph = { id: `golden-user-edit-${Date.now()}`, type: "paragraph", props: { textColor: "default", backgroundColor: "default", textAlignment: "left" }, content: [{ type: "text", text: added, styles: {} }], children: [] };
        d.store.updateSnapshot(id, [...snapshot, paragraph]);
      };
      const words = (s: string) => new Set(norm(s).split(/[^a-z0-9%]+/).filter((w) => w.length > 3));
      const wanted = words(e.before);
      let best: { id: string; snapshot: unknown[]; shared: number } | null = null;
      for (const el of d.api.getSceneElements()) {
        if (el.isDeleted) continue;
        const id = el.customData?.acute?.documentId;
        const doc = id ? d.store.get(id) : null;
        if (!id || !doc?.snapshot) continue;
        const out: string[] = [];
        texts(doc.snapshot, out);
        if (norm(out.join(" ")).includes(head)) {
          append(id, doc.snapshot);
          return "exact";
        }
        const shared = [...words(out.join(" "))].filter((w) => wanted.has(w)).length;
        if (!best || shared > best.shared) best = { id, snapshot: doc.snapshot, shared };
      }
      if (best && best.shared >= 4) {
        append(best.id, best.snapshot);
        return "closest";
      }
      return false;
    },
    edit,
  );
}

async function clearCanvas(p: Page): Promise<void> {
  await dev(p, (d) => d.api.updateScene({ elements: [] }));
}

async function saveReplies(requests: Request[], path: string): Promise<void> {
  const replies = await Promise.all(
    requests.filter((r) => r.method() === "POST").map(async (r) => ({
      task: aiTaskOf(r),
      prompt: (r.postDataJSON() as { request?: { prompt?: string } } | null)?.request?.prompt ?? "",
      reply: (await (await r.response())?.text().catch(() => "")) ?? "",
    })),
  );
  writeFileSync(path, `${JSON.stringify(replies, null, 2)}\n`);
}

const writeJson = (path: string, value: unknown) => writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);

// ---------------------------------------------------------------- the run

test.describe("golden dataset recorder", () => {
  test.describe.configure({ mode: "serial", timeout: 1_800_000 });
  const why = refusal();
  // No approved run named: nothing below runs, and no AI request is made.
  test.skip(!!why, `golden recorder refused: ${why}`);

  let page: Page;
  let aiRequests: Request[];

  test.beforeAll(async ({ browser }) => {
    page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
    aiRequests = recordAIRequests(page);
    await openApp(page);
    await connectAI(page);
    // The app's note model must be the one meta.json records (else replay flags the mismatch): distil is a developer setting until R1.
    if (NOTE_MODEL === "distil") {
      const model = await dev(page, (d) => (d.setNoteModel ? d.setNoteModel("distil") : null));
      if (model !== "distil") throw new Error(`golden recorder: the app didn't switch to the distil note model (got ${String(model)})`);
    }
  });

  test.afterAll(async () => {
    if (metaCases.length) writeMeta();
    await page?.context().close();
  });

  for (const c of casesToRecord()) {
    for (let attempt = 1; attempt <= ATTEMPTS; attempt++) {
      test(`${c.id}${ATTEMPTS > 1 ? ` #${attempt}` : ""}`, async () => {
        const caseFile = readJson<CaseFile>(join(DATASET, c.directory, c.files.case));
        const versions = [...caseFile.sourceFiles].sort((a, b) => a.version - b.version);
        const sub = ATTEMPTS > 1 ? `${c.id}/attempt-${attempt}` : c.id;
        const dir = join(RUN_DIR, sub);
        mkdirSync(dir, { recursive: true });
        const entry: MetaCase = { caseId: c.id, ...(ATTEMPTS > 1 ? { attempt } : {}) };
        metaCases.push(entry);
        const done = () => writeMeta();

        await clearCanvas(page);
        await dev(page, (d) => d.callStats(true));
        aiRequests.length = 0;

        // 1. Visualize the (first) source and accept it.
        await page.getByRole("button", { name: "More", exact: true }).click();
        await page.getByRole("menuitem", { name: "Visualize content…" }).click();
        await visualizeDialog(page).getByRole("textbox").fill(readSource(join(DATASET, c.directory, versions[0]!.path)));
        await visualizeDialog(page).getByRole("button", { name: "Visualize", exact: true }).click();
        await expect(reviewBar(page).or(visualizeDialog(page).getByRole("alert"))).toBeVisible({ timeout: AI_TIMEOUT * 3 });
        await saveReplies(aiRequests, join(dir, "replies.json"));
        entry.replies = `${sub}/replies.json`;
        if (!(await reviewBar(page).isVisible())) {
          entry.note = `Visualize failed: ${((await visualizeDialog(page).getByRole("alert").first().textContent()) ?? "").trim()}`;
          await page.keyboard.press("Escape");
          return done();
        }
        await reviewBar(page).getByRole("button", { name: "Accept all" }).click();
        await expect(page.getByRole("status", { name: "AI changes" })).toContainText("Added");
        for (const r of (await dev(page, (d) => d.callStats())).records) if (r.model) modelsSeen.add(r.model);

        // 2. The merged, validated plan: the accepted content source version (recorded on Accept, asynchronously).
        const linked = await linkedObject(page);
        if (!linked) {
          entry.note = "no object is linked to a content source: the plan could not be read";
          return done();
        }
        await expect.poll(() => dev(page, (d, id) => d.contentSource(id).then((s) => !!s), linked.sourceId), { timeout: 15_000 }).toBe(true);
        const source = await dev(page, (d, id) => d.contentSource(id), linked.sourceId);
        writeJson(join(dir, "plan.json"), source!.version.plan);
        entry.plan = `${sub}/plan.json`;
        const runOutput = await dev(page, (d, id) => (d.knowledgeRun ? d.knowledgeRun(id) : null), linked.sourceId);
        if (runOutput) {
          writeJson(join(dir, "run.json"), runOutput);
          entry.run = `${sub}/run.json`;
        }

        // 3. Single-version cases: the accepted canvas (Lens is derived from it offline).
        if (versions.length < 2 || !c.files.reconcile) {
          writeJson(join(dir, "scene.json"), await sceneOf(page));
          entry.scene = `${sub}/scene.json`;
          return done();
        }

        // 4. The update case: the user's edit, then "Update from new content" with the next version, then Accept.
        const edits = readJson<{ userEdits: UserEdit[] }>(join(DATASET, c.directory, c.files.reconcile)).userEdits;
        const missed: string[] = [];
        const closest: string[] = [];
        for (const e of edits) {
          const applied = await applyUserEdit(page, e);
          if (!applied) missed.push(e.before.slice(0, 40));
          else if (applied === "closest") closest.push(e.before.slice(0, 40));
        }
        writeJson(join(dir, "scene-before.json"), await sceneOf(page));
        entry.sceneBefore = `${sub}/scene-before.json`;
        aiRequests.length = 0;
        const surface = await openAskAI(page, linked.elementId);
        await (await action(surface, "Update from new content")).click();
        await updateDialog(page).getByRole("textbox").fill(readSource(join(DATASET, c.directory, versions[1]!.path)));
        await updateDialog(page).getByRole("button", { name: "Update", exact: true }).click();
        await expect(reviewBar(page).or(nothingChanged(page))).toBeVisible({ timeout: AI_TIMEOUT * 2 });
        await saveReplies(aiRequests, join(dir, "replies-update.json"));
        // Accept all: clean updates, adds and removes are written; a conflict over the user's edit stays undecided
        // (their text kept), which is what the case expects of an edited card.
        if (await reviewBar(page).isVisible()) await reviewBar(page).getByRole("button", { name: "Accept all" }).click();
        writeJson(join(dir, "scene.json"), await sceneOf(page));
        entry.scene = `${sub}/scene.json`;
        const latest = await dev(page, (d, id) => d.contentSource(id), linked.sourceId);
        if (latest && latest.version.version > 1) writeJson(join(dir, "plan-v2.json"), latest.version.plan);
        const notes = [
          ...(missed.length ? [`user edit not applied (no block matched): ${missed.join("; ")}`] : []),
          ...(closest.length ? [`user edit applied to the card sharing the most words (no card holds the source's wording): ${closest.join("; ")}`] : []),
        ];
        if (notes.length) entry.note = notes.join(" / ");
        done();
      });
    }
  }
});
