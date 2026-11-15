/**
 * Replays a recorded run (README "Record and replay"): reads each case's recorded output from the run directory,
 * derives what the canvas gives (Lens projection, update outcome) when only the scene was recorded, evaluates every
 * assertion, and reports the three gates separately. Offline and free: no model is called.
 *
 * A `gate: false` run is reported only. A `gate: true` run fails on any critical deterministic failure
 * (`gatingFailures`), in any gate.
 */
import { existsSync } from "node:fs";
import { isAbsolute, relative, resolve } from "node:path";
import type { z } from "zod";
import { validateVisualPlan } from "@/ai/visual-plan/validate";
import type { VisualPlan } from "@/ai/visual-plan/types";
import { evaluate, verdict, type AssertionResult } from "./evaluate";
import { readText, type CaseBundle, type Recording } from "./load";
import { lensProjectionOfScene, reconcileOutcomeFromScenes, recordedSceneSchema } from "./recordedScene";
import { renderFacts } from "./render";
import { runEvidenceSchema, type RunEvidence } from "./runOutput";
import { lensProjectionSchema, reconcileOutcomeSchema, type LensProjection, type ReconcileOutcome, type RecordingMeta } from "./schemas";

export type Verdict = ReturnType<typeof verdict>;

export interface CaseReplay {
  caseId: string;
  attempt: number;
  /** Where each input came from: a recorded file, derived from the scene, or absent. */
  inputs: { plan: boolean; lens: "file" | "scene" | "none"; reconcile: "file" | "scenes" | "none"; run: boolean };
  /** What `validateVisualPlan` dropped from the recorded plan (a recording should already be validated: normally none). */
  planLosses: string[];
  results: AssertionResult[];
  verdict: Verdict;
  note?: string;
}

export interface RecordingReplay {
  meta: RecordingMeta;
  dir: string;
  cases: CaseReplay[];
  /** Files that are missing, unreadable or invalid, unknown cases. A run with issues is reported, and fails the suite. */
  issues: string[];
}

/** A path inside the run directory (a recording never points outside its own directory). */
function inside(dir: string, path: string): string | undefined {
  const full = resolve(dir, path);
  const r = relative(dir, full);
  return r && !r.startsWith("..") && !isAbsolute(r) ? full : undefined;
}

function readJson<T>(dir: string, path: string | undefined, schema: z.ZodType<T> | undefined, issues: string[], where: string): T | undefined {
  if (!path) return undefined;
  const full = inside(dir, path);
  if (!full) {
    issues.push(`${where}: ${path} is outside the run directory`);
    return undefined;
  }
  if (!existsSync(full)) {
    issues.push(`${where}: ${path} is missing`);
    return undefined;
  }
  let raw: unknown;
  try {
    raw = JSON.parse(readText(full));
  } catch (e) {
    issues.push(`${where}: ${path} is not JSON (${(e as Error).message})`);
    return undefined;
  }
  if (!schema) return raw as T;
  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    for (const i of parsed.error.issues.slice(0, 5)) issues.push(`${where}: ${path}: ${i.path.join(".") || "(root)"}: ${i.message}`);
    return undefined;
  }
  return parsed.data;
}

export async function replayRecording(rec: Recording, cases: ReadonlyMap<string, CaseBundle>): Promise<RecordingReplay> {
  const issues: string[] = [];
  const out: CaseReplay[] = [];
  const attempts = new Map<string, number>();
  for (const entry of rec.meta.cases) {
    const attempt = entry.attempt ?? (attempts.get(entry.caseId) ?? 0) + 1;
    attempts.set(entry.caseId, attempt);
    const where = `${rec.meta.runId}/${entry.caseId}#${attempt}`;
    const c = cases.get(entry.caseId);
    if (!c) {
      issues.push(`${where}: unknown case`);
      continue;
    }
    const rawPlan = readJson<unknown>(rec.dir, entry.plan, undefined, issues, where);
    const validated = rawPlan === undefined ? undefined : validateVisualPlan(rawPlan);
    const plan: VisualPlan | undefined = validated?.plan;

    let lens: LensProjection | undefined = readJson(rec.dir, entry.lens, lensProjectionSchema, issues, where);
    let lensFrom: CaseReplay["inputs"]["lens"] = lens ? "file" : "none";
    const scene = readJson(rec.dir, entry.scene, recordedSceneSchema, issues, where);
    if (!lens && scene && c.lens) {
      lens = lensProjectionOfScene(scene);
      lensFrom = "scene";
    }

    let reconcile: ReconcileOutcome | undefined = readJson(rec.dir, entry.reconcile, reconcileOutcomeSchema, issues, where);
    let reconcileFrom: CaseReplay["inputs"]["reconcile"] = reconcile ? "file" : "none";
    const before = readJson(rec.dir, entry.sceneBefore, recordedSceneSchema, issues, where);
    if (!reconcile && before && scene && c.reconcile) {
      reconcile = reconcileOutcomeFromScenes(before, scene);
      reconcileFrom = "scenes";
    }

    const run: RunEvidence | undefined = readJson(rec.dir, entry.run, runEvidenceSchema, issues, where);
    if (run && run.noteModel !== rec.meta.pipeline.noteModel) issues.push(`${where}: run.json says noteModel ${run.noteModel}, meta.json ${rec.meta.pipeline.noteModel}`);

    const results = evaluate(c.evaluation.assertions, c, { plan, lens, reconcile, run, render: plan ? await renderFacts(plan) : undefined });
    out.push({
      caseId: c.id,
      attempt,
      inputs: { plan: !!plan, lens: lensFrom, reconcile: reconcileFrom, run: !!run },
      planLosses: validated?.losses ?? [],
      results,
      verdict: verdict(results),
      ...(entry.note ? { note: entry.note } : {}),
    });
  }
  return { meta: rec.meta, dir: rec.dir, cases: out, issues };
}

/** What makes a gating run fail: critical deterministic failures, per case and gate. Always empty for `gate: false`. */
export function gatingFailures(replay: RecordingReplay): string[] {
  if (!replay.meta.gate) return [];
  return replay.cases.flatMap((c) => c.verdict.gates.flatMap((g) => g.failedCritical.map((id) => `${c.caseId}#${c.attempt} gate ${g.gate}: ${id}`)));
}

