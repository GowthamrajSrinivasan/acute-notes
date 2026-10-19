/** Reads the dataset from disk and parses every file with its schema. Problems are collected, not thrown. */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { z } from "zod";
import {
  capabilitiesSchema,
  caseEvaluationSchema,
  expectedCanvasSchema,
  expectedKnowledgeSchema,
  expectedLensSchema,
  expectedReconcileSchema,
  lensProjectionSchema,
  manifestSchema,
  reconcileOutcomeSchema,
  recordingMetaSchema,
  regressionSchema,
  rubricSchema,
  sourceCaseSchema,
  type Capabilities,
  type CaseEvaluation,
  type ExpectedCanvas,
  type ExpectedKnowledge,
  type ExpectedLens,
  type ExpectedReconcile,
  type LensProjection,
  type Manifest,
  type ReconcileOutcome,
  type RecordingMeta,
  type Regression,
  type Rubric,
  type SourceCase,
} from "./schemas";

export const DATASET_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

export interface CaseBundle {
  id: string;
  dir: string;
  source: SourceCase;
  /** Source text per version, line endings normalised to \n. */
  texts: Map<number, string>;
  knowledge: ExpectedKnowledge;
  canvas: ExpectedCanvas;
  evaluation: CaseEvaluation;
  lens?: ExpectedLens;
  reconcile?: ExpectedReconcile;
  /** Hand-authored reference output that satisfies the case: raw, so the product's own validator can be run on it. */
  referencePlan: unknown;
  referenceLens?: LensProjection;
  referenceReconcile?: ReconcileOutcome;
  constraintsPath: string;
}

export interface Dataset {
  manifest: Manifest;
  capabilities: Capabilities;
  cases: CaseBundle[];
  rubrics: Rubric[];
  regressions: Regression[];
  issues: string[];
}

export function readText(path: string): string {
  return readFileSync(path, "utf8").replace(/^﻿/, "").replace(/\r\n?/g, "\n");
}

function readJson(path: string): unknown {
  return JSON.parse(readText(path));
}

function parse<T>(schema: z.ZodType<T>, path: string, issues: string[]): T | undefined {
  if (!existsSync(path)) {
    issues.push(`${rel(path)}: missing`);
    return undefined;
  }
  let raw: unknown;
  try {
    raw = readJson(path);
  } catch (e) {
    issues.push(`${rel(path)}: not JSON (${(e as Error).message})`);
    return undefined;
  }
  const result = schema.safeParse(raw);
  if (!result.success) {
    for (const i of result.error.issues.slice(0, 20)) issues.push(`${rel(path)}: ${i.path.join(".") || "(root)"}: ${i.message}`);
    return undefined;
  }
  return result.data;
}

export function rel(path: string): string {
  return path.startsWith(DATASET_ROOT) ? path.slice(DATASET_ROOT.length + 1).replace(/\\/g, "/") : path;
}

export function loadDataset(root = DATASET_ROOT): Dataset {
  const issues: string[] = [];
  const manifest = parse(manifestSchema, join(root, "dataset-manifest.json"), issues);
  const capabilities = parse(capabilitiesSchema, join(root, "capabilities.json"), issues);
  if (!manifest || !capabilities) throw new Error(`dataset can't load:\n${issues.join("\n")}`);

  const cases: CaseBundle[] = [];
  for (const entry of manifest.cases) {
    const dir = join(root, entry.directory);
    const f = entry.files;
    const source = parse(sourceCaseSchema, join(dir, f.case), issues);
    const knowledge = parse(expectedKnowledgeSchema, join(dir, f.knowledge), issues);
    const canvas = parse(expectedCanvasSchema, join(dir, f.canvas), issues);
    const evaluation = parse(caseEvaluationSchema, join(dir, f.evaluation), issues);
    const lens = f.lens ? parse(expectedLensSchema, join(dir, f.lens), issues) : undefined;
    const reconcile = f.reconcile ? parse(expectedReconcileSchema, join(dir, f.reconcile), issues) : undefined;
    const referenceLens = f.referenceLens ? parse(lensProjectionSchema, join(dir, f.referenceLens), issues) : undefined;
    const referenceReconcile = f.referenceReconcile ? parse(reconcileOutcomeSchema, join(dir, f.referenceReconcile), issues) : undefined;
    const planPath = join(dir, f.referencePlan);
    const referencePlan = existsSync(planPath) ? readJson(planPath) : (issues.push(`${rel(planPath)}: missing`), undefined);
    if (!source || !knowledge || !canvas || !evaluation || referencePlan === undefined) continue;
    if ((f.lens && !lens) || (f.reconcile && !reconcile)) continue;

    const texts = new Map<number, string>();
    for (const file of source.sourceFiles) {
      const p = join(dir, file.path);
      if (existsSync(p)) texts.set(file.version, readText(p));
      else issues.push(`${rel(p)}: missing`);
    }
    cases.push({ id: entry.id, dir, source, texts, knowledge, canvas, evaluation, lens, reconcile, referencePlan, referenceLens, referenceReconcile, constraintsPath: join(dir, f.constraints) });
  }

  const rubrics = manifest.rubrics.map((p) => parse(rubricSchema, join(root, p), issues)).filter((r): r is Rubric => !!r);
  const regDir = join(root, manifest.regressionsDir);
  const regFiles = existsSync(regDir) ? readdirSync(regDir).filter((f) => f.endsWith(".json")).sort() : [];
  const regressions = regFiles.map((f) => parse(regressionSchema, join(regDir, f), issues)).filter((r): r is Regression => !!r);
  for (const f of regFiles) {
    const id = f.replace(/\.json$/, "");
    if (!regressions.some((r) => r.id === id) && !issues.some((i) => i.includes(f))) issues.push(`${manifest.regressionsDir}/${f}: id must equal the file name`);
  }
  return { manifest, capabilities, cases, rubrics, regressions, issues };
}

export interface Recording {
  meta: RecordingMeta;
  dir: string;
}

/** Recorded live runs under `recordings/` (none until one is approved and made). */
export function loadRecordings(root = DATASET_ROOT): { recordings: Recording[]; issues: string[] } {
  const issues: string[] = [];
  const base = join(root, "recordings");
  if (!existsSync(base)) return { recordings: [], issues };
  const recordings: Recording[] = [];
  for (const name of readdirSync(base, { withFileTypes: true })) {
    if (!name.isDirectory()) continue;
    const dir = join(base, name.name);
    const meta = parse(recordingMetaSchema, join(dir, "meta.json"), issues);
    if (meta) recordings.push({ meta, dir });
  }
  return { recordings, issues };
}
