/**
 * Stage 5a spike (intelligent-update-engine-plan §13.2, results §13.9): measures each candidate local embedding model
 * against the hashed embedder. **Opt-in: skipped unless `EMBEDDING_SPIKE=1`** — it downloads model weights from the
 * Hugging Face hub (~23–118 MB each) into `EMBEDDING_SPIKE_CACHE` (default `node_modules/.cache/acute-embedding-models`).
 * No AI provider call, no spend. `EMBEDDING_SPIKE_MODELS=minilm-l6,bge-small-en` limits the candidates.
 *
 * Writes `evaluation/update-engine/embedding-spike/results.json` and `report.md`.
 *
 * What it measures, per embedder:
 * - cost: weights on disk, first load (download + load), load from cache, one-text latency (median of 20), batched
 *   throughput, resident memory added by loading (approximate: models load one after another in one process);
 * - relatedness on the labelled paraphrase set (`fidelity/__fixtures__/meaning/pairs.json`, development material):
 *   each pair's source and card are the same claim (faithful) or a distorted version of it — **related either way**.
 *   Negatives are each source against the card of the pair half the set away (different claim, usually different
 *   subject). Reported: ROC AUC, mean scores, the threshold that lets ≤ 5 % of negatives through and the recall there;
 * - the router fixture of `router.test.ts` (5 cards, 3 sections) with the Stage 2 cases and hand-written paraphrase
 *   probes: top-1 by embedding alone (not the full router) and the margin to the runner-up;
 * - cross-language probes (§13.8 Q3): an English card against German / French / Spanish versions of itself.
 *
 * Never run on any unseen consistency set (§13.2).
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import pairsFile from "@/ai/fidelity/__fixtures__/meaning/pairs.json";
import { hashedProvider, similarity, type EmbeddingProvider, type EmbeddingVector } from "./embeddingProvider";
import { LOCAL_MODELS, LocalModelProvider, type LocalModelKey } from "./localModelEmbedding";

const ON = process.env.EMBEDDING_SPIKE === "1";
const CACHE = resolve(process.env.EMBEDDING_SPIKE_CACHE ?? "node_modules/.cache/acute-embedding-models");
const OUT = resolve("evaluation/update-engine/embedding-spike");
const MODELS = (process.env.EMBEDDING_SPIKE_MODELS?.split(",").map((s) => s.trim()) ?? Object.keys(LOCAL_MODELS)) as LocalModelKey[];

interface Pair {
  id: string;
  kind: string;
  source: string;
  card: string;
  label: string;
}
const PAIRS = (pairsFile as unknown as { pairs: Pair[] }).pairs;

// The router.test.ts fixture: card id → text.
const CARDS: Record<string, string> = {
  retries: "Retries happen five times with exponential backoff.",
  timeouts: "Timeouts last ten seconds per call.",
  owners: "The payments team owns the gateway service.",
  tokens: "Each server gets its own scoped access token.",
  keys: "Signing keys rotate monthly.",
};
/** [probe, expected card, origin] — origin "router.test" = the Stage 2 case; "spike" = written for this spike. */
const PROBES: [string, string, string][] = [
  ["Credentials are rotated every thirty days.", "keys", "router.test"],
  ["Jitter spreads retries out so callers don't retry together.", "retries", "router.test"],
  ["Failed requests are attempted again up to five times.", "retries", "spike"],
  ["The gateway gives up on a call after ten seconds.", "timeouts", "spike"],
  ["Billing engineers are responsible for the gateway.", "owners", "spike"],
  ["Every server is issued a separate token with limited permissions.", "tokens", "spike"],
  ["We replace the keys used to sign requests once a month.", "keys", "spike"],
];
/** [English card, translation, language]; each translation is also checked against an unrelated English card. */
const CROSS_LANG: [string, string, string][] = [
  ["Signing keys rotate monthly.", "Die Signaturschlüssel werden monatlich gewechselt.", "de"],
  ["Timeouts last ten seconds per call.", "Le délai d'attente est de dix secondes par appel.", "fr"],
  ["The payments team owns the gateway service.", "El equipo de pagos es responsable del servicio de pasarela.", "es"],
];

const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length ? (s[Math.floor((s.length - 1) / 2)]! + s[Math.ceil((s.length - 1) / 2)]!) / 2 : 0;
};
const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / (xs.length || 1);
const r3 = (x: number) => Math.round(x * 1000) / 1000;
const mb = (bytes: number) => Math.round((bytes / 1_048_576) * 10) / 10;

function dirBytes(dir: string): number {
  if (!existsSync(dir)) return 0;
  let n = 0;
  for (const e of readdirSync(dir, { withFileTypes: true })) n += e.isDirectory() ? dirBytes(join(dir, e.name)) : statSync(join(dir, e.name)).size;
  return n;
}

/** Mann–Whitney ROC AUC: the chance a random positive outscores a random negative. */
function auc(pos: number[], neg: number[]): number {
  let wins = 0;
  for (const p of pos) for (const n of neg) wins += p > n ? 1 : p === n ? 0.5 : 0;
  return wins / (pos.length * neg.length);
}

async function relatedness(p: EmbeddingProvider) {
  const half = Math.floor(PAIRS.length / 2);
  const t0 = performance.now();
  const sources = await p.embed(PAIRS.map((x) => x.source));
  const cards = await p.embed(PAIRS.map((x) => x.card));
  const batchedMs = performance.now() - t0;
  const pos = PAIRS.map((_, i) => similarity(sources[i]!, cards[i]!));
  const neg = PAIRS.map((_, i) => similarity(sources[i]!, cards[(i + half) % PAIRS.length]!));
  const negSorted = [...neg].sort((a, b) => b - a);
  const at5 = negSorted[Math.floor(neg.length * 0.05)]!;
  const byLabel = (label: string) => r3(mean(pos.filter((_, i) => PAIRS[i]!.label === label)));
  const perKind = Object.fromEntries(
    [...new Set(PAIRS.map((x) => x.kind))].map((k) => {
      const ix = PAIRS.map((x, i) => (x.kind === k ? i : -1)).filter((i) => i >= 0);
      return [k, r3(auc(ix.map((i) => pos[i]!), ix.map((i) => neg[i]!)))];
    }),
  );
  return {
    texts: PAIRS.length * 2,
    batchedMsPerText: r3(batchedMs / (PAIRS.length * 2)),
    auc: r3(auc(pos, neg)),
    aucPerKind: perKind,
    meanPositive: r3(mean(pos)),
    meanNegative: r3(mean(neg)),
    meanFaithful: byLabel("faithful"),
    meanDistorted: byLabel("distorted"),
    thresholdAt5pctFP: r3(at5),
    recallAt5pctFP: r3(pos.filter((s) => s > at5).length / pos.length),
    /** The provider's own `related` line, as configured now. */
    configuredRelated: p.thresholds.related,
    recallAtConfigured: r3(pos.filter((s) => s >= p.thresholds.related).length / pos.length),
    fpAtConfigured: r3(neg.filter((s) => s >= p.thresholds.related).length / neg.length),
    minPositive: r3(Math.min(...pos)),
    lowestPositives: pos
      .map((s, i) => ({ id: PAIRS[i]!.id, score: r3(s) }))
      .sort((a, b) => a.score - b.score)
      .slice(0, 5),
  };
}

async function router(p: EmbeddingProvider) {
  const ids = Object.keys(CARDS);
  const cardVecs = await p.embed(ids.map((id) => CARDS[id]!));
  const probeVecs = await p.embed(PROBES.map(([t]) => t));
  return PROBES.map(([text, expected, origin], i) => {
    const scored = ids.map((id, k) => ({ id, s: similarity(probeVecs[i]!, cardVecs[k]!) })).sort((a, b) => b.s - a.s);
    const exp = scored.find((x) => x.id === expected)!;
    return { text, expected, origin, top: scored[0]!.id, correct: scored[0]!.id === expected, expectedScore: r3(exp.s), margin: r3(exp.s - (scored.find((x) => x.id !== expected)?.s ?? 0)) };
  });
}

async function crossLanguage(p: EmbeddingProvider) {
  const unrelated = "Quarterly revenue grew by four percent.";
  const vecs: EmbeddingVector[] = await p.embed([...CROSS_LANG.flatMap(([en, tr]) => [en, tr]), unrelated]);
  const u = vecs[vecs.length - 1]!;
  const line = p.thresholds.related;
  // "Separates" only when the translation clears the embedder's own related line and the unrelated sentence doesn't —
  // a bare same > unrelated is met by noise (0.12 vs -0.1).
  return CROSS_LANG.map(([, , lang], k) => {
    const en = vecs[2 * k]!;
    const tr = vecs[2 * k + 1]!;
    const same = similarity(en, tr);
    const unrelatedScore = similarity(tr, u);
    return { lang, sameClaim: r3(same), unrelated: r3(unrelatedScore), separates: same >= line && unrelatedScore < line };
  });
}

// ── The blind probe set (`probes.json`, written by an isolated agent that saw no code, model or earlier set) ──────

interface Probes {
  pairs: { id: string; class: "paraphrase" | "same_topic" | "decoy" | "unrelated"; a: string; b: string }[];
  canvas: { sections: { id: string; name: string; cards: { id: string; text: string }[] }[]; notes: { id: string; text: string; expected: string; trap: string | null }[] };
}
const PROBES_FILE = join(OUT, "probes.json");
const BLIND: Probes | undefined = existsSync(PROBES_FILE) ? (JSON.parse(readFileSync(PROBES_FILE, "utf8")) as Probes) : undefined;

/** Similarities only; scored in `blindScores` so the hybrid can combine two embedders' matrices. */
async function blindRaw(p: EmbeddingProvider) {
  if (!BLIND) return undefined;
  const a = await p.embed(BLIND.pairs.map((x) => x.a));
  const b = await p.embed(BLIND.pairs.map((x) => x.b));
  const pairs = BLIND.pairs.map((_, i) => similarity(a[i]!, b[i]!));
  const cards = BLIND.canvas.sections.flatMap((s) => s.cards);
  const cv = await p.embed(cards.map((c) => c.text));
  const nv = await p.embed(BLIND.canvas.notes.map((n) => n.text));
  const notes = BLIND.canvas.notes.map((_, i) => cards.map((_, k) => similarity(nv[i]!, cv[k]!)));
  return { pairs, notes };
}
type BlindRaw = NonNullable<Awaited<ReturnType<typeof blindRaw>>>;

function blindScores(raw: BlindRaw, related: number) {
  const P = BLIND!;
  const cls = (c: string) => raw.pairs.filter((_, i) => P.pairs[i]!.class === c);
  const para = cls("paraphrase");
  const same = cls("same_topic");
  const decoy = cls("decoy");
  const unrel = cls("unrelated");
  const negatives = [...decoy, ...unrel];
  const at5 = [...negatives].sort((x, y) => y - x)[Math.floor(negatives.length * 0.05)]!;
  const cards = P.canvas.sections.flatMap((s) => s.cards.map((c) => ({ ...c, section: s.id })));
  const routed = P.canvas.notes.map((n, i) => {
    const order = cards.map((c, k) => ({ id: c.id, section: c.section, s: raw.notes[i]![k]! })).sort((x, y) => y.s - x.s);
    const exp = cards.find((c) => c.id === n.expected)!;
    return { id: n.id, top: order[0]!.id, correct: order[0]!.id === n.expected, sectionCorrect: order[0]!.section === exp.section, trapped: n.trap !== null && order[0]!.id === n.trap, hasTrap: n.trap !== null };
  });
  return {
    meanByClass: { paraphrase: r3(mean(para)), same_topic: r3(mean(same)), decoy: r3(mean(decoy)), unrelated: r3(mean(unrel)) },
    /** The key number: does a same-fact paraphrase outscore a word-sharing decoy? */
    aucParaphraseVsDecoy: r3(auc(para, decoy)),
    aucRelatedVsNot: r3(auc([...para, ...same], negatives)),
    paraphraseRecallAt5pctFP: r3(para.filter((s) => s > at5).length / para.length),
    thresholdAt5pctFP: r3(at5),
    atConfigured: { related, paraphraseRecall: r3(para.filter((s) => s >= related).length / para.length), sameTopicRecall: r3(same.filter((s) => s >= related).length / same.length), decoyPass: r3(decoy.filter((s) => s >= related).length / decoy.length), unrelatedPass: r3(unrel.filter((s) => s >= related).length / unrel.length) },
    routing: { notes: routed.length, top1: routed.filter((r) => r.correct).length, section: routed.filter((r) => r.sectionCorrect).length, trapped: routed.filter((r) => r.trapped).length, withTrap: routed.filter((r) => r.hasTrap).length, misses: routed.filter((r) => !r.correct).map((r) => `${r.id}→${r.top}`) },
  };
}

/** Equal-weight blend of two embedders' similarities (a model's meaning + the hashed embedder's wording). */
function hybrid(a: BlindRaw, b: BlindRaw): BlindRaw {
  return { pairs: a.pairs.map((x, i) => (x + b.pairs[i]!) / 2), notes: a.notes.map((row, i) => row.map((x, k) => (x + b.notes[i]![k]!) / 2)) };
}

async function latency(p: EmbeddingProvider) {
  const xs: number[] = [];
  for (let i = 0; i < 20; i++) {
    const t = performance.now();
    await p.embed([`${PROBES[i % PROBES.length]![0]} (${i})`]);
    xs.push(performance.now() - t);
  }
  return r3(median(xs));
}

async function measure(key: LocalModelKey | "hashed") {
  if (key === "hashed") {
    return { embedder: hashedProvider.id, model: "hashed (Stage 2a)", languages: "en", weightsMB: 0, firstLoadMs: 0, cachedLoadMs: 0, cachedLoadError: undefined as string | undefined, rssAddedMB: 0, oneTextMs: await latency(hashedProvider), relatedness: await relatedness(hashedProvider), router: await router(hashedProvider), crossLanguage: await crossLanguage(hashedProvider), blindRaw: await blindRaw(hashedProvider), related: hashedProvider.thresholds.related };
  }
  const spec = LOCAL_MODELS[key];
  const rss0 = process.memoryUsage().rss;
  let t = performance.now();
  const first = new LocalModelProvider(key, { cacheDir: CACHE, allowDownload: true });
  const r1 = await first.ready();
  if (r1.state !== "ready") throw new Error(`${key}: ${r1.reason}`);
  const firstLoadMs = performance.now() - t;
  t = performance.now();
  const cached = new LocalModelProvider(key, { cacheDir: CACHE, allowDownload: false });
  const r2 = await cached.ready();
  const cachedLoadMs = r2.state === "ready" ? performance.now() - t : -1;
  const p = r2.state === "ready" ? cached : first;
  await p.embed(["warm up"]);
  const rssAddedMB = mb(process.memoryUsage().rss - rss0);
  return {
    embedder: p.id,
    model: spec.hub,
    languages: spec.languages,
    weightsMB: mb(dirBytes(join(CACHE, ...spec.hub.split("/")))),
    firstLoadMs: Math.round(firstLoadMs),
    cachedLoadMs: Math.round(cachedLoadMs),
    cachedLoadError: r2.state === "unavailable" ? r2.reason : undefined,
    rssAddedMB,
    oneTextMs: await latency(p),
    relatedness: await relatedness(p),
    router: await router(p),
    crossLanguage: await crossLanguage(p),
    blindRaw: await blindRaw(p),
    related: p.thresholds.related,
  };
}

type Result = Awaited<ReturnType<typeof measure>>;
type BlindRow = { embedder: string } & ReturnType<typeof blindScores>;

function blindRows(results: Result[]): BlindRow[] {
  const hashed = results[0]!;
  const rows: BlindRow[] = [];
  for (const r of results) if (r.blindRaw) rows.push({ embedder: r.embedder, ...blindScores(r.blindRaw, r.related) });
  for (const r of results.slice(1))
    if (r.blindRaw && hashed.blindRaw) rows.push({ embedder: `${r.embedder} + hashed (½ each)`, ...blindScores(hybrid(r.blindRaw, hashed.blindRaw), (r.related + hashed.related) / 2) });
  return rows;
}

function blindReport(rows: BlindRow[]): string[] {
  if (!rows.length) return ["## Blind probes", "", "`probes.json` not present — skipped.", ""];
  return [
    "## Blind probes (isolated author; low-overlap paraphrases and word-sharing decoys)",
    "",
    `${BLIND!.pairs.length} pairs (paraphrase / same topic / decoy / unrelated) and ${BLIND!.canvas.notes.length} notes routed onto a ${BLIND!.canvas.sections.flatMap((s) => s.cards).length}-card canvas by similarity alone. "Trapped" = the top card was the decoy card that shares words with the note.`,
    "",
    "| embedder | mean: paraphrase / same topic / decoy / unrelated | **AUC paraphrase vs decoy** | AUC related vs not | paraphrase recall at 5 % FP (threshold) | at configured line: para / same / decoy / unrelated pass | routing top-1 | section | trapped |",
    "|---|---|---|---|---|---|---|---|---|",
    ...rows.map((b) => `| ${b.embedder} | ${b.meanByClass.paraphrase} / ${b.meanByClass.same_topic} / ${b.meanByClass.decoy} / ${b.meanByClass.unrelated} | **${b.aucParaphraseVsDecoy}** | ${b.aucRelatedVsNot} | ${b.paraphraseRecallAt5pctFP} (${b.thresholdAt5pctFP}) | ${b.atConfigured.related}: ${b.atConfigured.paraphraseRecall} / ${b.atConfigured.sameTopicRecall} / ${b.atConfigured.decoyPass} / ${b.atConfigured.unrelatedPass} | ${b.routing.top1}/${b.routing.notes} | ${b.routing.section}/${b.routing.notes} | ${b.routing.trapped}/${b.routing.withTrap} |`),
    "",
    "Routing misses (note → card chosen):",
    "",
    ...rows.map((b) => `- ${b.embedder}: ${b.routing.misses.join(", ") || "none"}`),
    "",
  ];
}

function report(results: Result[], blind: BlindRow[], env: Record<string, string>): string {
  const rows = results.map((r) => {
    const rel = r.relatedness;
    const routed = r.router.filter((x) => x.correct).length;
    const spikeProbes = r.router.filter((x) => x.origin === "spike");
    const xl = r.crossLanguage.filter((x) => x.separates).length;
    return `| ${r.embedder} | ${r.languages} | ${r.weightsMB} | ${r.firstLoadMs} / ${r.cachedLoadMs} | ${r.rssAddedMB} | ${r.oneTextMs} | ${rel.batchedMsPerText} | **${rel.auc}** | ${rel.meanPositive} / ${rel.meanNegative} | ${rel.thresholdAt5pctFP} → ${rel.recallAt5pctFP} | ${routed}/${r.router.length} (spike ${spikeProbes.filter((x) => x.correct).length}/${spikeProbes.length}) | ${xl}/${r.crossLanguage.length} |`;
  });
  const probeTable = [
    `| probe | expected | ${results.map((r) => r.embedder).join(" | ")} |`,
    `|---|---|${results.map(() => "---").join("|")}|`,
    ...PROBES.map(([text, expected], i) => `| ${text} | ${expected} | ${results.map((r) => { const x = r.router[i]!; return `${x.correct ? "✓" : `✗ ${x.top}`} ${x.expectedScore} (${x.margin >= 0 ? "+" : ""}${x.margin})`; }).join(" | ")} |`),
  ];
  const kinds = Object.keys(results[0]!.relatedness.aucPerKind);
  const kindTable = [`| kind | ${results.map((r) => r.embedder).join(" | ")} |`, `|---|${results.map(() => "---").join("|")}|`, ...kinds.map((k) => `| ${k} | ${results.map((r) => (r.relatedness.aucPerKind as Record<string, number>)[k]).join(" | ")} |`)];
  return [
    "# Stage 5a embedding spike — results",
    "",
    `Generated by \`src/ai/router/embeddingSpike.test.ts\` (EMBEDDING_SPIKE=1). Plan: \`.ai/docs/intelligent-update-engine-plan.md\` §13.2, §13.9.`,
    `Environment: ${Object.entries(env).map(([k, v]) => `${k} ${v}`).join(" · ")}. CPU only, q8 weights. Memory is approximate (models load in turn in one process).`,
    "",
    "Cross-language: an English card vs its German / French / Spanish translation; counted only when the translation clears the embedder's `related` line and an unrelated English sentence doesn't. RSS here is unreliable (models load in turn in one process; see `memory.json` for isolated measurements).",
    "",
    "| embedder | languages | weights MB | first / cached load ms | RSS added MB | one text ms | batched ms/text | relatedness AUC | mean pos / neg | threshold at 5 % FP → recall | router top-1 | cross-language |",
    "|---|---|---|---|---|---|---|---|---|---|---|---|",
    ...rows,
    "",
    "Relatedness: 352 labelled paraphrase pairs (faithful and distorted are both *related*) vs 352 mismatched pairs — **easy**: the cards reuse most of their source's words. Router: the `router.test.ts` fixture, embedding similarity alone; ✓/✗, the expected card's score and its margin over the best other card.",
    ...results.filter((r) => r.cachedLoadError).map((r) => `\n**Cached load failed** for ${r.embedder}: ${r.cachedLoadError}`),
    "",
    ...blindReport(blind),
    "## Router probes",
    "",
    ...probeTable,
    "",
    "## Relatedness AUC per kind",
    "",
    ...kindTable,
    "",
    "## Faithful vs distorted (mean similarity) — embeddings measure aboutness, not truth",
    "",
    `| embedder | faithful | distorted |`,
    `|---|---|---|`,
    ...results.map((r) => `| ${r.embedder} | ${r.relatedness.meanFaithful} | ${r.relatedness.meanDistorted} |`),
    "",
  ].join("\n");
}

describe.skipIf(!ON)("Stage 5a embedding spike (opt-in: EMBEDDING_SPIKE=1)", () => {
  it(
    "measures each candidate against the hashed embedder and writes the results",
    async () => {
      mkdirSync(CACHE, { recursive: true });
      const results: Result[] = [await measure("hashed")];
      for (const key of MODELS) results.push(await measure(key));
      const env = { node: process.version, platform: `${process.platform}-${process.arch}`, transformers: "4.3.2", date: new Date().toISOString().slice(0, 10) };
      mkdirSync(OUT, { recursive: true });
      const blind = blindRows(results);
      const stored = results.map(({ blindRaw: _raw, ...rest }) => rest);
      writeFileSync(join(OUT, "results.json"), `${JSON.stringify({ env, results: stored, blind }, null, 2)}\n`);
      writeFileSync(join(OUT, "report.md"), report(results, blind, env));
      expect(results.length).toBe(MODELS.length + 1);
    },
    30 * 60_000,
  );
});
