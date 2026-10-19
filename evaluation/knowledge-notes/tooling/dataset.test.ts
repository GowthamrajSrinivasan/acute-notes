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
import { constraintsView } from "./constraints";
import { evaluate, verdict, type AssertionResult } from "./evaluate";
import { DATASET_ROOT, loadDataset, loadRecordings, readText, type CaseBundle } from "./load";
import { mutateLens, mutatePlan, mutateReconcile } from "./mutate";
import { renderFacts } from "./render";
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

function implementedDeterministic(results: AssertionResult[], c: CaseBundle, target: string) {
  const ids = new Set(c.evaluation.assertions.filter((a) => a.method === "deterministic" && a.support !== "future" && a.target === target).map((a) => a.id));
  return results.filter((r) => ids.has(r.id));
}

describe("golden dataset: files", () => {
  it.each(Object.keys(JSON_SCHEMAS))("schemas/%s matches tooling/schemas.ts", (file) => {
    const expected = json(z.toJSONSchema(JSON_SCHEMAS[file as keyof typeof JSON_SCHEMAS], { io: "input" }));
    const path = join(DATASET_ROOT, "schemas", file);
    writeIfUpdating(path, expected);
    expect(existsSync(path) ? readText(path) : "(missing)", `run UPDATE_GOLDEN=1 to regenerate ${file}`).toBe(expected);
  });

  it("is internally consistent", () => {
    const problems = validateDataset(dataset).filter((p) => !ONLY || p.includes(ONLY));
    expect(problems, problems.join("\n")).toEqual([]);
  });

  it.skipIf(!!ONLY)("has at least 12 cases, two of them with Lens expectations and one with a reconcile expectation", () => {
    expect(dataset.cases.length).toBeGreaterThanOrEqual(12);
    expect(dataset.cases.filter((c) => c.lens).length).toBeGreaterThanOrEqual(2);
    expect(dataset.cases.some((c) => c.lens?.levels.filter((l) => l.availability !== "unavailable").length === 6)).toBe(true);
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
    const { losses } = validatedReference(c);
    expect(losses, losses.join("\n")).toEqual([]);
  });

  it.each(dataset.cases.map((c) => [c.id, c] as const))("%s: every deterministic assertion passes on the reference", async (_id, c) => {
    const plan = validatedReference(c).plan;
    const results = evaluate(c.evaluation.assertions, c, { plan, lens: c.referenceLens, reconcile: c.referenceReconcile, render: await renderFacts(plan) });
    const failing = (["plan", "lens", "reconcile", "render"] as const).flatMap((t) => implementedDeterministic(results, c, t)).filter((r) => r.status !== "pass");
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
    const c = byCase.get(r.caseId)!;
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

describe("golden dataset: recorded runs (replayed offline)", () => {
  const { recordings, issues } = loadRecordings();
  it("recordings load", () => expect(issues).toEqual([]));
  it.runIf(recordings.length === 0)("no recording exists yet: nothing is claimed about real model output", () => {
    expect(recordings).toEqual([]);
  });
  const byCase = new Map(dataset.cases.map((c) => [c.id, c]));
  for (const rec of recordings)
    for (const entry of rec.meta.cases) {
      it(`${rec.meta.runId} / ${entry.caseId}${rec.meta.gate ? " (gating)" : " (report only)"}`, async () => {
        const c = byCase.get(entry.caseId);
        expect(c, `unknown case ${entry.caseId}`).toBeDefined();
        const read = (p?: string) => (p ? JSON.parse(readText(join(rec.dir, p))) : undefined);
        const raw = read(entry.plan);
        const plan = raw ? validateVisualPlan(raw).plan : undefined;
        const results = evaluate(c!.evaluation.assertions, c!, { plan, lens: read(entry.lens), reconcile: read(entry.reconcile), render: plan ? await renderFacts(plan) : undefined });
        const v = verdict(results);
        if (rec.meta.gate) expect(v.gates.flatMap((g) => g.failedCritical)).toEqual([]);
      });
    }
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
});
