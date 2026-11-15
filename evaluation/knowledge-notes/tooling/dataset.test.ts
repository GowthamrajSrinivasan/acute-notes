/**
 * The Knowledge Notes golden dataset's own regression suite (README "Running the checks"). Offline, no AI calls.
 *
 *   npm run test:golden                          run it
 *   UPDATE_GOLDEN=1 npm run test:golden          rewrite the generated files (schemas, constraints views, report)
 */
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { validateVisualPlan } from "@/ai/visual-plan/validate";
import type { VisualPlan } from "@/ai/visual-plan/types";
import type { Organisation } from "@/ai/visual-plan/grouping";
import { constraintsView } from "./constraints";
import { evaluate, verdict, type AssertionResult } from "./evaluate";
import { frameOrderRobustness } from "./frameOrder";
import { buildGateReport, type ReferenceRow, type RobustnessRow } from "./gateReport";
import { DATASET_ROOT, loadDataset, loadRecordings, readText, type CaseBundle } from "./load";
import { mutateLens, mutatePlan, mutateReconcile } from "./mutate";
import { renderFacts } from "./render";
import { gatingFailures, replayRecording, type RecordingReplay } from "./replay";
import { buildInventory, buildReport } from "./report";
import { JSON_SCHEMAS, lensProjectionSchema, reconcileOutcomeSchema } from "./schemas";
import { validateDataset } from "./validateDataset";

const UPDATE = process.env.UPDATE_GOLDEN === "1";
/** GOLDEN_CASE=kn-03 focuses every check on matching cases (for authoring one case at a time). */
const ONLY = process.env.GOLDEN_CASE;
const full = loadDataset();
const dataset = ONLY ? { ...full, cases: full.cases.filter((c) => c.id.includes(ONLY)), regressions: full.regressions.filter((r) => r.caseId.includes(ONLY)), issues: full.issues.filter((i) => i.includes(ONLY)) } : full;

function writeIfUpdating(path: string, content: string): void {
  if (!UPDATE) return;
  mkdirSync(join(path, ".."), { recursive: true });
  writeFileSync(path, content);
}

const json = (value: unknown) => `${JSON.stringify(value, null, 2)}\n`;

/** The reference plan as the product would render it: through `validateVisualPlan`, the same gate a model reply goes through. */
function validatedReference(c: CaseBundle) {
  return validateVisualPlan(c.referencePlan);
}

/** Implemented deterministic assertions on `target`, minus those scoped to other organisation rules than `organisation`. */
function implementedDeterministic(results: AssertionResult[], c: CaseBundle, target: string, organisation: Organisation = "v1") {
  const ids = new Set(
    c.evaluation.assertions.filter((a) => a.method === "deterministic" && a.support !== "future" && a.target === target && (!a.organisation || a.organisation === organisation)).map((a) => a.id),
  );
  return results.filter((r) => ids.has(r.id));
}

describe("golden dataset: files", () => {
  it.each(Object.keys(JSON_SCHEMAS))("schemas/%s matches tooling/schemas.ts", (file) => {
    const expected = json(z.toJSONSchema(JSON_SCHEMAS[file as keyof typeof JSON_SCHEMAS], { io: "input" }));
    const path = join(DATASET_ROOT, "schemas", file);
    if (!ONLY) writeIfUpdating(path, expected);
    expect(existsSync(path) ? readText(path) : "(missing)", `run UPDATE_GOLDEN=1 to regenerate ${file}`).toBe(expected);
  });

  it("is internally consistent", () => {
    const problems = validateDataset(dataset).filter((p) => !ONLY || p.includes(ONLY));
    expect(problems, problems.join("\n")).toEqual([]);
  });

  it.skipIf(!!ONLY)("has at least 12 cases, two of them with Lens expectations and one with a reconcile expectation", () => {
    expect(dataset.cases.length).toBeGreaterThanOrEqual(12);
    expect(dataset.cases.filter((c) => c.lens).length).toBeGreaterThanOrEqual(2);
    // One case covers the complete journey: all six levels L0–L5 available.
    expect(dataset.cases.some((c) => new Set(c.lens?.levels.filter((l) => l.availability === "available").map((l) => l.level)).size === 6)).toBe(true);
    expect(dataset.cases.some((c) => c.reconcile)).toBe(true);
  });

  it.each(dataset.cases.map((c) => [c.id, c] as const))("%s: constraints.json is the derived view", (_id, c) => {
    const expected = json(constraintsView(c));
    writeIfUpdating(c.constraintsPath, expected);
    expect(existsSync(c.constraintsPath) ? readText(c.constraintsPath) : "(missing)", "run UPDATE_GOLDEN=1").toBe(expected);
  });
});

describe("golden dataset: reference outputs satisfy their cases", () => {
  it.each(dataset.cases.map((c) => [c.id, c] as const))("%s: the reference plan renders today without losing anything", (_id, c) => {
    const { losses, plan } = validatedReference(c);
    expect(losses, losses.join("\n")).toEqual([]);
    // An over-long shape sublabel/detail is shortened by the schema (ending "…") and the repair step reports it, keeping
    // the full text in a linked block (Lane K); a reference should never need that, so its shape text must come
    // through validation unchanged. Compared directly: a shortened shape is a changed card, whatever `losses` says.
    type Shape = { id: string; type: string; content: { sublabel?: string; details?: string[] } };
    const before = (c.referencePlan as { nodes: Shape[] }).nodes.filter((n) => n.type === "shape");
    const after = new Map((plan.nodes as unknown as Shape[]).map((n) => [n.id, n]));
    const dropped = before.filter((n) => JSON.stringify([n.content.sublabel, n.content.details]) !== JSON.stringify([after.get(n.id)?.content.sublabel, after.get(n.id)?.content.details])).map((n) => n.id);
    expect(dropped, "shape text shortened or dropped by validateVisualPlan").toEqual([]);
  });

  // Every reference passes in both sets of organisation rules (organisation-layout plan §4.2): today's (v1) and the
  // distil mode's (v2: frame order, sub-groups, frame splitting). An assertion scoped to one is decided only on it.
  for (const organisation of ["v1", "v2"] as const)
    it.each(dataset.cases.map((c) => [c.id, c] as const))(`%s: every deterministic assertion passes on the reference (organisation ${organisation})`, async (_id, c) => {
      const plan = validatedReference(c).plan;
      const results = evaluate(c.evaluation.assertions, c, { plan, lens: c.referenceLens, reconcile: c.referenceReconcile, render: await renderFacts(plan, { organisation }) });
      const failing = (["plan", "lens", "reconcile", "render"] as const).flatMap((t) => implementedDeterministic(results, c, t, organisation)).filter((r) => r.status !== "pass");
      expect(failing.map((r) => `${r.id}: ${r.status} ${r.detail}`)).toEqual([]);
      expect(verdict(results).pass).toBe(true);
    });

  it.each(dataset.cases.filter((c) => c.lens).map((c) => [c.id, c] as const))("%s: has a reference Lens projection", (_id, c) => {
    expect(lensProjectionSchema.safeParse(c.referenceLens).success).toBe(true);
  });

  it.each(dataset.cases.filter((c) => c.reconcile).map((c) => [c.id, c] as const))("%s: has a reference reconcile outcome", (_id, c) => {
    expect(reconcileOutcomeSchema.safeParse(c.referenceReconcile).success).toBe(true);
  });
});

describe("golden dataset: planted distortions are caught", () => {
  const byCase = new Map(dataset.cases.map((c) => [c.id, c]));
  it.each(dataset.regressions.map((r) => [`${r.id} (${r.distortion})`, r] as const))("%s", async (_name, r) => {
    const c = byCase.get(r.caseId);
    if (!c) throw new Error(`${r.id}: case ${r.caseId} didn't load (see "is internally consistent")`);
    const reference = validatedReference(c).plan;
    const plan = r.target === "plan" ? validateVisualPlan(mutatePlan(reference as VisualPlan, r.mutations)).plan : reference;
    const actual = {
      plan,
      lens: r.target === "lens" ? mutateLens(c.referenceLens!, r.mutations) : c.referenceLens,
      reconcile: r.target === "reconcile" ? mutateReconcile(c.referenceReconcile!, r.mutations) : c.referenceReconcile,
      render: await renderFacts(plan),
    };
    const results = evaluate(c.evaluation.assertions, c, actual);
    const status = new Map(results.map((x) => [x.id, x]));
    for (const id of r.expectFailing) expect(status.get(id)?.status, `${id} should fail: ${status.get(id)?.detail}`).toBe("fail");
    expect(verdict(results).pass).toBe(false);
  });
});

/** Filled by the recorded-runs tests (they run first, in file order), read by the per-gate report. */
const replays: RecordingReplay[] = [];

describe("golden dataset: recorded runs (replayed offline)", () => {
  // Every run directory under recordings/: meta.json valid against its schema, each case evaluated through the three
  // gates. `gate: false` runs are reported (reports/gates.md) and never fail; `gate: true` runs fail on any critical
  // deterministic failure. Integrity problems (missing or invalid files, unknown cases) fail either way.
  const { recordings, issues } = loadRecordings();
  it("recordings load: every meta.json is valid and named after its directory", () => expect(issues).toEqual([]));
  it.runIf(recordings.length === 0)("no recording exists yet: nothing is claimed about real model output", () => {
    expect(recordings).toEqual([]);
  });
  const byCase = new Map(full.cases.map((c) => [c.id, c]));
  for (const rec of recordings)
    it(`${rec.meta.runId}${rec.meta.gate ? " (gating)" : " (report only)"}`, async () => {
      const replay = await replayRecording(rec, byCase);
      replays.push(replay);
      expect(replay.issues).toEqual([]);
      expect(replay.cases.length).toBe(rec.meta.cases.length);
      expect(gatingFailures(replay)).toEqual([]);
    });
});

describe("golden dataset: report", () => {
  it.skipIf(!!ONLY)("builds the validation and coverage report", () => {
    const report = buildReport(dataset, validateDataset(dataset));
    writeIfUpdating(join(DATASET_ROOT, "reports", "validation-report.md"), report);
    expect(report).toContain("# Validation and coverage report");
    const inventory = buildInventory(dataset);
    const inventoryPath = join(DATASET_ROOT, "reports", "capability-inventory.md");
    writeIfUpdating(inventoryPath, inventory);
    expect(existsSync(inventoryPath) ? readText(inventoryPath) : "(missing)", "run UPDATE_GOLDEN=1").toBe(inventory);
  });

  it.skipIf(!!ONLY)("builds the per-gate report (reports/gates.md)", async () => {
    const references: ReferenceRow[] = [];
    const robustness: RobustnessRow[] = [];
    for (const c of dataset.cases) {
      const plan = validatedReference(c).plan;
      const inputs = { plan, lens: c.referenceLens, reconcile: c.referenceReconcile };
      const results = evaluate(c.evaluation.assertions, c, { ...inputs, render: await renderFacts(plan) });
      const v2 = evaluate(c.evaluation.assertions, c, { ...inputs, render: await renderFacts(plan, { organisation: "v2" }) });
      references.push({ caseId: c.id, results, verdict: verdict(results), v2: { results: v2, verdict: verdict(v2) } });
      robustness.push({ caseId: c.id, v1: await frameOrderRobustness(plan), v2: await frameOrderRobustness(plan, { organisation: "v2" }) });
    }
    const report = buildGateReport(references, replays, robustness);
    const path = join(DATASET_ROOT, "reports", "gates.md");
    writeIfUpdating(path, report);
    expect(existsSync(path) ? readText(path) : "(missing)", "run UPDATE_GOLDEN=1").toBe(report);
    // Frame order robustness renders every linked reference 240 times (v1 and v2): a few seconds.
  }, 120_000);
});
