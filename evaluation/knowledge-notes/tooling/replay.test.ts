/**
 * Record-and-replay without a recording: synthetic runs written to a temporary fixture directory (never to
 * `recordings/`, which holds approved real runs only), built from the cases' own hand-written reference outputs.
 * They exercise what a real recording will go through: meta.json validation, the three gates reported separately,
 * `gate: false` reported but never failing, run output (`KnowledgeRunOutput`) making `future` traceability checks
 * decidable, and the Lens and update outcome derived from recorded canvases.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import type { SceneElement } from "@/domain/canvas/adapter";
import { validateVisualPlan } from "@/ai/visual-plan/validate";
import type { VisualPlan } from "@/ai/visual-plan/types";
import { evaluate } from "./evaluate";
import { faithfulRun, sceneFromExpectedLens } from "./fixtures";
import { buildGateReport } from "./gateReport";
import { loadDataset, loadRecordings, type CaseBundle } from "./load";
import { mutatePlan } from "./mutate";
import { reconcileOutcomeFromScenes, type RecordedScene } from "./recordedScene";
import { gatingFailures, replayRecording, type RecordingReplay } from "./replay";
import { expectedReviewUnits, mapUnits, runCapabilities, runEvidenceSchema, type RunEvidence } from "./runOutput";
import type { RecordingMeta } from "./schemas";

const dataset = loadDataset();
const byCase = new Map(dataset.cases.map((c) => [c.id, c]));
const kase = (prefix: string) => dataset.cases.find((c) => c.id.startsWith(prefix))!;
const reference = (c: CaseBundle) => validateVisualPlan(c.referencePlan).plan;

const root = mkdtempSync(join(tmpdir(), "golden-replay-"));
afterAll(() => rmSync(root, { recursive: true, force: true }));

type Entry = RecordingMeta["cases"][number];
interface CaseFiles {
  entry: Omit<Entry, "plan" | "run" | "scene" | "sceneBefore" | "reconcile" | "lens">;
  plan?: unknown;
  run?: unknown;
  scene?: RecordedScene;
  reconcile?: unknown;
}

/** Writes `<base>/<runId>/meta.json` and each case's files, the layout `recordings/README.md` describes. */
function writeRun(base: string, runId: string, meta: Partial<RecordingMeta>, cases: CaseFiles[]): void {
  const dir = join(base, runId);
  const entries: Entry[] = cases.map((f) => {
    const sub = `${f.entry.caseId}${f.entry.attempt ? `/attempt-${f.entry.attempt}` : ""}`;
    mkdirSync(join(dir, sub), { recursive: true });
    const put = (name: string, value: unknown) => {
      if (value === undefined) return undefined;
      writeFileSync(join(dir, sub, name), JSON.stringify(value, null, 2));
      return `${sub}/${name}`;
    };
    const paths = { plan: put("plan.json", f.plan), run: put("run.json", f.run), scene: put("scene.json", f.scene), reconcile: put("reconcile.json", f.reconcile) };
    return { ...f.entry, ...Object.fromEntries(Object.entries(paths).filter(([, v]) => v)) } as Entry;
  });
  const full = {
    datasetVersion: "1.0.0",
    runId,
    recordedAt: "2026-10-19T00:00:00Z",
    approvedBy: "synthetic fixture (no model was called)",
    provider: "none",
    model: "hand-written reference",
    pipeline: { noteModel: "distil", promptVersion: "fixture", appVersion: "0.1.0" },
    gate: false,
    cases: entries,
    ...meta,
  };
  writeFileSync(join(dir, "meta.json"), JSON.stringify(full, null, 2));
}

async function replayOnly(base: string): Promise<RecordingReplay> {
  const { recordings, issues } = loadRecordings(root, base);
  expect(issues).toEqual([]);
  expect(recordings).toHaveLength(1);
  return replayRecording(recordings[0]!, byCase);
}

const result = (r: RecordingReplay, caseId: string, attempt: number, assertion: string) =>
  r.cases.find((c) => c.caseId.startsWith(caseId) && c.attempt === attempt)!.results.find((x) => x.id === assertion)!;

describe("replay: a synthetic run built from the reference outputs", () => {
  const kn01 = kase("kn-01");
  const kn08 = kase("kn-08");
  const kn12 = kase("kn-12");
  const base = join(root, "good");
  writeRun(base, "2026-10-19-synthetic-reference", {}, [
    { entry: { caseId: kn01.id, attempt: 1 }, plan: kn01.referencePlan, run: faithfulRun(kn01, reference(kn01)) },
    { entry: { caseId: kn01.id, attempt: 2 }, plan: kn01.referencePlan },
    { entry: { caseId: kn08.id }, plan: kn08.referencePlan, scene: sceneFromExpectedLens(kn08.lens!, "kn08") },
    { entry: { caseId: kn12.id }, plan: kn12.referencePlan, reconcile: kn12.referenceReconcile },
  ]);
  let replay: RecordingReplay;

  it("loads meta.json against its schema and replays every case", async () => {
    replay = await replayOnly(base);
    expect(replay.issues).toEqual([]);
    expect(replay.cases.map((c) => `${c.caseId.slice(0, 5)}#${c.attempt}`)).toEqual(["kn-01#1", "kn-01#2", "kn-08#1", "kn-12#1"]);
    for (const c of replay.cases) expect(c.planLosses).toEqual([]);
  });

  it("reports the three gates separately, and every gate passes on the references", () => {
    for (const c of replay.cases) {
      expect(c.verdict.gates.map((g) => g.gate)).toEqual([1, 2, 3]);
      expect(c.verdict.gates.map((g) => `${c.caseId} gate ${g.gate}: ${g.failed.join(", ")}`)).toEqual(c.verdict.gates.map((g) => `${c.caseId} gate ${g.gate}: `));
    }
    expect(gatingFailures(replay)).toEqual([]);
  });

  it("with run output, the future citation and accounting checks are decided; without it they stay not_evaluable", () => {
    expect(result(replay, "kn-01", 1, "a.cites")).toMatchObject({ status: "pass", detail: expect.stringContaining("derived cites check") });
    expect(result(replay, "kn-01", 1, "a.accounting")).toMatchObject({ status: "pass", detail: expect.stringContaining("9 units") });
    expect(result(replay, "kn-01", 2, "a.cites").status).toBe("not_evaluable");
    expect(result(replay, "kn-01", 2, "a.accounting").status).toBe("not_evaluable");
  });

  it("derives kn-08's Lens projection from the recorded canvas and scores it", () => {
    const c = replay.cases.find((x) => x.caseId === kn08.id)!;
    expect(c.inputs.lens).toBe("scene");
    const lens = c.results.filter((r) => kn08.evaluation.assertions.some((a) => a.id === r.id && a.target === "lens" && a.method === "deterministic" && a.support !== "future"));
    expect(lens.length).toBeGreaterThan(30);
    expect(lens.filter((r) => r.status !== "pass").map((r) => r.id)).toEqual([]);
    // Lens markers for unknown detail aren't run output: still not_evaluable.
    expect(result(replay, "kn-08", 1, "a.unknown-marker").status).toBe("not_evaluable");
  });

  it("evaluates the update outcome", () => {
    const c = replay.cases.find((x) => x.caseId === kn12.id)!;
    expect(c.inputs.reconcile).toBe("file");
    expect(c.results.filter((r) => r.status === "no_input")).toEqual([]);
  });

  it("goes into the per-gate report as report-only", () => {
    const report = buildGateReport([], [replay]);
    expect(report).toContain("### 2026-10-19-synthetic-reference (report only)");
    expect(report).toContain("| kn-01-idempotency-keys | 1 | PASS");
    expect(report).toContain("lens (scene)");
  });
});

describe("replay: failures are reported per gate, and fail the suite only for gating runs", () => {
  const kn01 = kase("kn-01");
  // The planted distortion of rg-01-retries-always-safe (gate 1), plus a run whose cites miss.
  const regression = dataset.regressions.find((r) => r.id === "rg-01-retries-always-safe")!;
  const distorted = mutatePlan(reference(kn01) as VisualPlan, regression.mutations);
  const run = faithfulRun(kn01, reference(kn01));
  const badRun: RunEvidence = { ...run, cites: Object.fromEntries(Object.keys(run.cites!).map((k) => [k, []])) };
  const files: CaseFiles[] = [{ entry: { caseId: kn01.id }, plan: distorted, run: badRun }];

  for (const gate of [false, true]) {
    it(`gate: ${gate}`, async () => {
      const base = join(root, `distorted-${gate}`);
      writeRun(base, "2026-10-19-synthetic-distorted", { gate }, files);
      const replay = await replayOnly(base);
      const c = replay.cases[0]!;
      expect(c.verdict.gates.find((g) => g.gate === 1)!.pass).toBe(false);
      expect(c.verdict.gates.find((g) => g.gate === 3)!.pass).toBe(true);
      expect(result(replay, "kn-01", 1, "a.cites").status).toBe("fail");
      for (const id of regression.expectFailing) expect(result(replay, "kn-01", 1, id).status).toBe("fail");
      if (gate) expect(gatingFailures(replay).length).toBeGreaterThan(0);
      else expect(gatingFailures(replay)).toEqual([]);
    });
  }
});

describe("replay: recording integrity", () => {
  it("rejects a meta.json that doesn't match its schema, and one not named after its directory", () => {
    const base = join(root, "bad-meta");
    writeRun(base, "2026-10-19-bad", { approvedBy: "" }, [{ entry: { caseId: kase("kn-01").id }, plan: kase("kn-01").referencePlan }]);
    writeRun(base, "2026-10-19-renamed", { runId: "2026-10-19-other" }, [{ entry: { caseId: kase("kn-01").id }, plan: kase("kn-01").referencePlan }]);
    const { recordings, issues } = loadRecordings(root, base);
    expect(recordings).toEqual([]);
    expect(issues.join("\n")).toContain("approvedBy");
    expect(issues.join("\n")).toContain("must equal the directory name");
  });

  it("reports missing files, files outside the run, unknown cases and a noteModel mismatch", async () => {
    const base = join(root, "bad-files");
    writeRun(base, "2026-10-19-bad-files", { pipeline: { noteModel: "preserve", promptVersion: "x", appVersion: "0.1.0" } }, [{ entry: { caseId: kase("kn-01").id }, plan: kase("kn-01").referencePlan, run: { noteModel: "distil" } }]);
    const { recordings } = loadRecordings(root, base);
    const meta = { ...recordings[0]!.meta, cases: [...recordings[0]!.meta.cases, { caseId: "kn-99-nothing", plan: "x.json" }, { caseId: kase("kn-02").id, plan: "../../escape.json" }, { caseId: kase("kn-03").id, plan: "kn-03/plan.json" }] };
    const replay = await replayRecording({ ...recordings[0]!, meta }, byCase);
    const text = replay.issues.join("\n");
    expect(text).toContain("noteModel distil");
    expect(text).toContain("unknown case");
    expect(text).toContain("outside the run directory");
    expect(text).toContain("missing");
  });
});

describe("run output checks", () => {
  const kn01 = kase("kn-01");
  const plan = reference(kn01);
  const run = faithfulRun(kn01, plan);
  const accounting = kn01.evaluation.assertions.filter((a) => a.id === "a.accounting" || a.id === "a.cites");
  const statusOf = (r: RunEvidence) => Object.fromEntries(evaluate(accounting, kn01, { plan, run: r }).map((x) => [x.id, `${x.status}: ${x.detail}`]));

  it("says what a run provides", () => {
    expect([...runCapabilities(run)].sort()).toEqual(["ai.cites", "ai.source-unit-ids", "ai.unit-accounting"]);
    expect([...runCapabilities({ noteModel: "preserve" })]).toEqual([]);
  });

  it("matches the run's units to the case's by text, whatever the ids and markdown", () => {
    const m = mapUnits([{ id: "x1", text: "Retries are safe" }, { id: "x2", text: "nothing like it" }], [{ id: "u1", quote: "- **Retries** are safe." }]);
    expect(m.get("x1")).toEqual(["u1"]);
    expect(m.get("x2")).toEqual([]);
  });

  it("fails a critical unit that is omitted, and a unit no run unit carries", () => {
    const critical = kn01.source.units.find((u) => u.critical)!;
    const runId = run.units!.units.find((u) => u.text === critical.quote)!.id;
    const omitted: RunEvidence = { ...run, cites: Object.fromEntries(Object.entries(run.cites!).map(([k, v]) => [k, v.filter((x) => x !== runId)])), omitted: [{ unit: runId, reason: "filler" }] };
    expect(statusOf(omitted)["a.accounting"]).toContain(`fail: from the run's output (derived units_accounted check): omitted but not omittable: ${critical.id}`);
    const fewer: RunEvidence = { ...run, units: { ...run.units!, units: run.units!.units.filter((u) => u.id !== runId) }, cites: Object.fromEntries(Object.entries(run.cites!).map(([k, v]) => [k, v.filter((x) => x !== runId)])) };
    expect(statusOf(fewer)["a.accounting"]).toContain(`no run unit has the text of ${critical.id}`);
  });

  it("reads the accounting result when the run carries one", () => {
    const outcome = Object.fromEntries(run.units!.units.map((u) => [u.id, "represented" as const]));
    const withAccounting: RunEvidence = { noteModel: "distil", units: run.units, accounting: { state: {}, outcome, critical: {}, flags: [], sections: [] } };
    expect(statusOf(withAccounting)["a.accounting"]).toMatch(/^pass/);
    expect(statusOf(withAccounting)["a.cites"]).toMatch(/^not_evaluable/);
  });

  it("fails a cite to a unit the run doesn't have", () => {
    const node = Object.keys(run.cites!)[0]!;
    expect(statusOf({ ...run, cites: { ...run.cites, [node]: ["r999"] } })["a.cites"]).toContain("doesn't have");
  });

  it("review queue: a false alarm fails when nothing needs review; the expected units must be flagged", () => {
    const kn06 = kase("kn-06");
    const p06 = reference(kn06);
    const run06 = faithfulRun(kn06, p06);
    const review06 = kn06.evaluation.assertions.filter((a) => a.id === "a.review-queue");
    expect(expectedReviewUnits(kn06.source, kn06.knowledge)).toEqual([]);
    expect(evaluate(review06, kn06, { plan: p06, run: { ...run06, flags: [] } })[0]!.status).toBe("pass");
    expect(evaluate(review06, kn06, { plan: p06, run: { ...run06, flags: [{ code: "qualifier_dropped", unit: run06.units!.units[3]!.id, detail: "x" }] } })[0]!.status).toBe("fail");

    const kn11 = kase("kn-11");
    const p11 = reference(kn11);
    const run11 = faithfulRun(kn11, p11);
    const review11 = kn11.evaluation.assertions.filter((a) => a.id === "a.review-queue");
    const expected = new Set(expectedReviewUnits(kn11.source, kn11.knowledge));
    expect(expected.size).toBeGreaterThan(0);
    const quotes = new Set(kn11.source.units.filter((u) => expected.has(u.id)).map((u) => u.quote));
    const flags = run11.units!.units.filter((u) => quotes.has(u.text)).map((u) => ({ code: "source_ambiguous", unit: u.id, detail: "conflict" }));
    expect(evaluate(review11, kn11, { plan: p11, run: { ...run11, flags } })[0]!.status).toBe("pass");
    expect(evaluate(review11, kn11, { plan: p11, run: { ...run11, flags: flags.slice(1) } })[0]!.status).toBe("fail");
  });
});

describe("update outcome from recorded canvases", () => {
  const base = { x: 0, y: 0, width: 100, height: 50, angle: 0, locked: false, opacity: 100, isDeleted: false, groupIds: [], strokeColor: "", backgroundColor: "", strokeWidth: 1, strokeStyle: "solid" };
  const shape = (id: string, key: string, text: string) => [
    { ...base, id, type: "rectangle", customData: { acuteMeta: { ai: { createdBy: "ai", contentSourceId: "s1", contentSourceVersion: 1, stableNodeKey: key, contentFingerprint: "f" } } } },
    { ...base, id: `${id}_t`, type: "text", text, containerId: id },
  ] as unknown as SceneElement[];
  const scene = (...els: SceneElement[][]): RecordedScene => ({ canvasId: "c", elements: els.flat() as unknown as RecordedScene["elements"], documents: {} });

  it("classifies by stable key: unchanged, updated, added, removed", () => {
    const before = scene(shape("a", "k.same", "Same"), shape("b", "k.edit", "Old text"), shape("c", "k.gone", "Removed rule"));
    const after = scene(shape("a2", "k.same", "Same"), shape("b2", "k.edit", "New text"), shape("d", "k.new", "Added step"));
    expect(reconcileOutcomeFromScenes(before, after).items).toEqual([
      { key: "k.same", text: "Same", state: "unchanged" },
      { key: "k.edit", text: "New text", state: "update_clean" },
      { key: "k.new", text: "Added step", state: "add" },
      { key: "k.gone", text: "Removed rule", state: "remove" },
    ]);
  });
});

describe("run evidence keeps the run's card groups", () => {
  it("a run.json's cardGroups survive parsing (plan §9 G1 counts per card); a run without them still parses", () => {
    const parsed = runEvidenceSchema.parse({ noteModel: "distil", cardGroups: [["n1", "n2"], ["n5", "lim1"]] });
    expect(parsed.cardGroups).toEqual([["n1", "n2"], ["n5", "lim1"]]);
    expect(runEvidenceSchema.parse({ noteModel: "distil" }).cardGroups).toBeUndefined();
    expect(runEvidenceSchema.safeParse({ noteModel: "distil", cardGroups: [[]] }).success).toBe(false);
  });
});
