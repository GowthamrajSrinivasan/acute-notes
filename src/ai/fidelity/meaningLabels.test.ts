/**
 * The labelling workflow of the paraphrase set (`meaningLabels.ts`): statuses, agreement, G0, and the real label
 * files in `__fixtures__/meaning/`. `UPDATE_LABELS=1` rewrites `__fixtures__/meaning/labelling-report.md`, the list a
 * labelling session works from (disputes with both answers and notes, stale answers, progress per kind, G0).
 */
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import pairsFile from "./__fixtures__/meaning/pairs.json";
import type { MeaningPair } from "./contracts";
import { MEANING_KINDS } from "./contracts";
import type { LabellerFile, LabellingConfig, PairLabelState, Resolution } from "./meaningLabels";
import { agreement, countedAnswers, g0Checks, pairStates } from "./meaningLabels";

const DIR = join(dirname(fileURLToPath(import.meta.url)), "__fixtures__", "meaning");
const pairs = (pairsFile as { pairs: MeaningPair[] }).pairs;
const readJson = <T>(path: string): T => JSON.parse(readFileSync(path, "utf8")) as T;
const config = readJson<LabellingConfig>(join(DIR, "labelling.json"));
const resolutions = readJson<Record<string, Resolution>>(join(DIR, "resolutions.json"));
const files = readdirSync(join(DIR, "labels"))
  .filter((f) => f.endsWith(".json"))
  .map((f) => ({ file: f, data: readJson<LabellerFile>(join(DIR, "labels", f)) }));

const pair = (id: string, label: "faithful" | "distorted" = "faithful"): MeaningPair => ({ id, kind: "negation", source: `s ${id}`, card: `c ${id}`, label, labelledBy: "draft" });
const rec = (p: MeaningPair, answer: LabellerFile["labels"][string]["answer"], note?: string) => ({ answer, ...(note ? { note } : {}), source: p.source, card: p.card, at: "2026-10-19T00:00:00Z" });
const NO_CONFIG: LabellingConfig = { rubricVersion: 1, sample: [], anchors: [] };

describe("pairStates", () => {
  const a = pair("a"), b = pair("b", "distorted"), c = pair("c"), d = pair("d");

  it("needs a human answer: the drafted label is never final", () => {
    const [s] = pairStates([a], [], {}, NO_CONFIG);
    expect(s).toMatchObject({ status: "unlabelled" });
    expect(s!.final).toBeUndefined();
  });

  it("one definite answer is final outside the sample; inside it waits for a second person", () => {
    const one: LabellerFile = { labeller: "x", rubricVersion: 1, labels: { a: rec(a, "distorted", "says always"), b: rec(b, "distorted") } };
    const states = pairStates([a, b], [one], {}, { ...NO_CONFIG, sample: ["b"] });
    expect(states[0]).toMatchObject({ status: "agreed", final: "distorted", changedFromDraft: true });
    expect(states[1]).toMatchObject({ status: "needs_second" });
  });

  it("partly, unsure and disagreement are disputes until resolved", () => {
    const x: LabellerFile = { labeller: "x", rubricVersion: 1, labels: { a: rec(a, "partly", "weaker"), b: rec(b, "unsure", "?"), c: rec(c, "faithful") } };
    const y: LabellerFile = { labeller: "y", rubricVersion: 1, labels: { c: rec(c, "distorted", "scope") } };
    const states = pairStates([a, b, c], [x, y], {}, NO_CONFIG);
    expect(states.map((s) => s.status)).toEqual(["disputed", "disputed", "disputed"]);
    const resolved = pairStates([a, b, c], [x, y], { c: { outcome: "faithful", note: "scope folded in", by: "x", source: c.source, card: c.card } }, NO_CONFIG);
    expect(resolved[2]).toMatchObject({ status: "resolved", final: "faithful" });
  });

  it("a rewritten pair's old answers and resolution are stale: it is labelled again", () => {
    const x: LabellerFile = { labeller: "x", rubricVersion: 1, labels: { d: rec(d, "faithful") } };
    const rewritten = { ...d, card: "a new card" };
    const [s] = pairStates([rewritten], [x], { d: { outcome: "remove", note: "", by: "x", source: d.source, card: d.card } }, NO_CONFIG);
    expect(s).toMatchObject({ status: "unlabelled", stale: ["x"] });
  });

  it("model answers are reported beside the human ones and never decide a final label", () => {
    const m: LabellerFile = { labeller: "gpt", type: "model", rubricVersion: 1, labels: { a: rec(a, "distorted", "x") } };
    const [s] = pairStates([a], [m], {}, NO_CONFIG);
    expect(s).toMatchObject({ status: "unlabelled", answers: [], modelAnswers: [{ labeller: "gpt", answer: "distorted" }] });
    const h: LabellerFile = { labeller: "me", rubricVersion: 1, labels: { a: rec(a, "faithful") } };
    expect(pairStates([a], [m, h], {}, NO_CONFIG)[0]).toMatchObject({ status: "agreed", final: "faithful" });
  });

  it("model-consensus: two agreeing labellers settle a pair (provisional); a split is excluded; a person still wins", () => {
    const policy: LabellingConfig = { ...NO_CONFIG, policy: { mode: "model-consensus", decidedBy: "user", note: "" } };
    const m1: LabellerFile = { labeller: "m1", type: "model", rubricVersion: 1, labels: { a: rec(a, "distorted", "x"), b: rec(b, "faithful"), c: rec(c, "partly", "torn"), d: rec(d, "faithful") } };
    const m2: LabellerFile = { labeller: "m2", type: "model", rubricVersion: 1, labels: { a: rec(a, "distorted", "y"), b: rec(b, "distorted", "z"), c: rec(c, "faithful") } };
    const states = pairStates([a, b, c, d], [m1, m2], {}, policy);
    expect(states.map((s) => s.status)).toEqual(["agreed", "excluded", "excluded", "needs_second"]);
    expect(states[0]).toMatchObject({ final: "distorted", provisional: true });
    const person = pairStates([b], [m1, m2], { b: { outcome: "distorted", note: "scope", by: "me", source: b.source, card: b.card } }, policy)[0]!;
    expect(person).toMatchObject({ status: "resolved", final: "distorted" });
    expect(person.provisional).toBeUndefined();
    expect(agreement(states, policy)).toMatchObject({ pairs: 3, agreed: 1 });
    // Without the policy, models never settle anything.
    expect(pairStates([a], [m1, m2], {}, NO_CONFIG)[0]!.status).toBe("unlabelled");
  });

  it("a removed pair is out of the set", () => {
    const [s] = pairStates([a], [], { a: { outcome: "remove", note: "two readings", by: "x", source: a.source, card: a.card } }, NO_CONFIG);
    expect(s!.status).toBe("removed");
  });
});

describe("agreement", () => {
  it("is Cohen's kappa over the pairs labelled twice", () => {
    const mk = (answers: [string, string][]): PairLabelState[] =>
      answers.map(([p, q], i) => ({
        id: `p${i}`, kind: "negation", heldOut: false, anchor: false, inSample: true, status: "agreed", stale: [], changedFromDraft: false, modelAnswers: [],
        answers: [{ labeller: "x", answer: p as never }, { labeller: "y", answer: q as never }],
      }));
    expect(agreement(mk([["faithful", "faithful"], ["distorted", "distorted"]]))).toEqual({ pairs: 2, agreed: 2, kappa: 1 });
    const r = agreement(mk([["faithful", "faithful"], ["distorted", "faithful"], ["distorted", "distorted"], ["faithful", "distorted"]]));
    expect(r.agreed).toBe(2);
    expect(r.kappa).toBeCloseTo(0, 5);
    expect(agreement([]).kappa).toBeNull();
  });
});

describe("the real labelling files", () => {
  const ids = new Set(pairs.map((p) => p.id));

  it("labelling.json: a 50-pair sample, at least 5 per kind, no anchors in it, known ids", () => {
    expect(config.sample).toHaveLength(50);
    expect(new Set(config.sample).size).toBe(50);
    for (const id of [...config.sample, ...config.anchors]) expect(ids.has(id), id).toBe(true);
    for (const id of config.sample) expect(config.anchors).not.toContain(id);
    for (const kind of MEANING_KINDS) expect(pairs.filter((p) => p.kind === kind && config.sample.includes(p.id)).length, kind).toBeGreaterThanOrEqual(5);
  });

  it("label files and resolutions name known pairs, valid answers, and a rubric version no newer than the current one", () => {
    for (const { file, data } of files) {
      expect(data.labeller, file).toBeTruthy();
      expect([undefined, "human", "model"], file).toContain(data.type);
      // Answers given under an earlier rubric stay valid; a rubric change that invalidates some rewrites those pairs.
      expect(data.rubricVersion, file).toBeLessThanOrEqual(config.rubricVersion);
      for (const [id, r] of Object.entries(data.labels)) {
        expect(ids.has(id), `${file}: ${id}`).toBe(true);
        expect(["faithful", "partly", "distorted", "unsure"], `${file}: ${id}`).toContain(r.answer);
        if (r.answer === "partly" || r.answer === "unsure") expect(r.note?.trim(), `${file}: ${id} needs a note`).toBeTruthy();
      }
    }
    expect(new Set(files.map((f) => f.data.labeller.toLowerCase())).size, "one file per labeller").toBe(files.length);
    for (const [id, r] of Object.entries(resolutions)) {
      expect(ids.has(id), id).toBe(true);
      expect(["faithful", "distorted", "remove"]).toContain(r.outcome);
      expect(r.by && r.note, `${id}: who and why`).toBeTruthy();
    }
  });

  it("reports progress and G0 (UPDATE_LABELS=1 rewrites labelling-report.md)", () => {
    const states = pairStates(pairs, files.map((f) => f.data), resolutions, config);
    const report = buildReport(states);
    console.log(report.split("\n").slice(0, 16).join("\n"));
    if (process.env.UPDATE_LABELS === "1") writeFileSync(join(DIR, "labelling-report.md"), report);
  });
});

function buildReport(states: readonly PairLabelState[]): string {
  const byId = new Map(pairs.map((p) => [p.id, p]));
  const count = (s: PairLabelState["status"]) => states.filter((x) => x.status === s).length;
  const consensus = config.policy?.mode === "model-consensus";
  const ag = consensus ? agreement(states, config) : agreement(states.filter((s) => s.inSample));
  const excluded = states.filter((s) => s.status === "excluded");
  const provisional = states.filter((s) => s.provisional).length;
  const checks = g0Checks(states, config);
  const quote = (t: string) => t.replace(/\|/g, "\\|");
  const answersOf = (s: PairLabelState) => countedAnswers(s, config).map((a) => `${a.labeller}: **${a.answer}**${a.note ? ` (${quote(a.note)})` : ""}`).join("<br>");
  const disputes = states.filter((s) => s.status === "disputed");
  const anchorsOff = states.filter((s) => s.anchor && countedAnswers(s, config).some((a) => a.answer !== byId.get(s.id)!.label));
  const stale = states.filter((s) => s.stale.length);
  const changed = states.filter((s) => s.changedFromDraft);
  return [
    "# Paraphrase set: labelling report",
    "",
    `Generated by \`UPDATE_LABELS=1 npx vitest run src/ai/fidelity/meaningLabels.test.ts\`. Rubric v${config.rubricVersion}. Labellers: ${files.map((f) => `${f.data.labeller}${f.data.type === "model" ? ` (model${f.data.model ? `: ${f.data.model}` : ""}; not counted)` : ""}`).join(", ") || "none yet"}.`,
    "",
    consensus
      ? `**Policy: model consensus** (${config.policy!.decidedBy}). ${config.policy!.note} ${provisional} final labels are **provisional** (settled by agreeing models, not by a person); ${count("resolved")} are a person's decisions.`
      : "Policy: human labels only (OD7).",
    "",
    `Pairs: ${states.length} · unlabelled ${count("unlabelled")} · waiting for a second labeller ${count("needs_second")} · disputed ${count("disputed")} · agreed ${count("agreed")} · resolved ${count("resolved")} · excluded ${count("excluded")} · removed ${count("removed")}`,
    "",
    consensus
      ? `Agreement between the first two labellers of each pair: ${ag.pairs} pairs; same answer on ${ag.agreed}; Cohen's kappa ${ag.kappa === null ? "—" : ag.kappa.toFixed(2)}.`
      : `Second-labeller sample: ${ag.pairs} of ${config.sample.length} labelled twice; same answer on ${ag.agreed}; Cohen's kappa ${ag.kappa === null ? "—" : ag.kappa.toFixed(2)}.`,
    "",
    "## G0",
    "",
    ...checks.map((c) => `- [${c.ok ? "x" : " "}] ${c.label}: ${c.detail}`),
    "",
    "## Progress per kind",
    "",
    "| kind | pairs | answered | final | faithful / distorted (final) |",
    "|---|---|---|---|---|",
    ...MEANING_KINDS.map((k) => {
      const set = states.filter((s) => s.kind === k && s.status !== "removed");
      const fin = set.filter((s) => s.final);
      return `| ${k} | ${set.length} | ${set.filter((s) => countedAnswers(s, config).length).length} | ${fin.length} | ${fin.filter((s) => s.final === "faithful").length} / ${fin.filter((s) => s.final === "distorted").length} |`;
    }),
    "",
    `## Disputes to resolve (${disputes.length})`,
    "",
    "Settle each in `resolutions.json` (faithful, distorted or remove, with who and why), or rewrite the pair in `pairs.json` (it is then labelled again). A rubric change bumps its version.",
    "",
    ...(disputes.length
      ? ["| pair | kind | source | card | answers |", "|---|---|---|---|---|", ...disputes.map((s) => `| ${s.id} | ${s.kind} | ${quote(byId.get(s.id)!.source)} | ${quote(byId.get(s.id)!.card)} | ${answersOf(s)} |`)]
      : ["None."]),
    "",
    ...(consensus
      ? [
          `## Excluded: the labellers disagree (${excluded.length})`,
          "",
          "Left out of the measurement, never guessed. A person can settle any of them in `resolutions.json`, or rewrite the pair.",
          "",
          ...(excluded.length
            ? ["| pair | kind | source | card | answers |", "|---|---|---|---|---|", ...excluded.map((s) => `| ${s.id} | ${s.kind} | ${quote(byId.get(s.id)!.source)} | ${quote(byId.get(s.id)!.card)} | ${countedAnswers(s, config).map((a) => `${a.labeller}: **${a.answer}**${a.note ? ` (${quote(a.note)})` : ""}`).join("<br>")} |`)]
            : ["None."]),
          "",
        ]
      : []),
    `## Anchors answered differently from the rubric (${anchorsOff.length})`,
    "",
    "These pairs are worked examples in the rubric. A different answer means the rubric is unclear, not that the labeller is wrong: discuss and clarify it.",
    "",
    ...(anchorsOff.length ? anchorsOff.map((s) => `- ${s.id}: rubric says ${byId.get(s.id)!.label}; ${answersOf(s).replace(/<br>/g, "; ")}`) : ["None."]),
    "",
    `## Final label differs from the draft (${changed.length})`,
    "",
    "The pair's `expect` (the rule meant to catch it) no longer fits; update or remove it.",
    "",
    ...(changed.length ? changed.map((s) => `- ${s.id}: drafted ${byId.get(s.id)!.label}, final ${s.final}`) : ["None."]),
    "",
    ...modelSection(states, byId),
    `## Stale answers (${stale.length})`,
    "",
    ...(stale.length ? stale.map((s) => `- ${s.id}: rewritten since ${s.stale.join(", ")} answered`) : ["None."]),
    "",
  ].join("\n");
}

/** Model answers against the final human labels: where a model judge disagrees is worth a look, never a verdict. */
function modelSection(states: readonly PairLabelState[], byId: Map<string, MeaningPair>): string[] {
  const withModel = states.filter((s) => s.modelAnswers.length);
  if (!withModel.length) return [];
  const compared = withModel.filter((s) => s.final);
  const differ = compared.filter((s) => s.modelAnswers.some((m) => m.answer !== s.final));
  return [
    "## Model answers (not counted)",
    "",
    `${withModel.length} pairs have a model answer; ${compared.length} have a final label to compare with; the model differs on ${differ.length}. (Under model consensus most final labels come from the models themselves, so this mainly shows the pairs a person decided.)`,
    "",
    ...differ.map((s) => `- ${s.id}: final ${s.final}; ${s.modelAnswers.map((m) => `${m.labeller} ${m.answer}${m.note ? ` (${m.note})` : ""}`).join("; ")} · ${byId.get(s.id)!.card}`),
    "",
  ];
}
