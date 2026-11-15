#!/usr/bin/env node
/**
 * The paraphrase set as a Markdown sheet to label outside the app (knowledge-notes-plan §7.2, OD7;
 * `.ai/docs/meaning-labelling-rubric.md`), and back.
 *
 *   node scripts/meaning-sheet.mjs export [--sample]
 *     → src/ai/fidelity/__fixtures__/meaning/labelling-sheet.md (blind: shuffled, neutral numbers, no drafted
 *       label, expected rule, kind or notes) and labelling-sheet.key.json (number → pair id and text; never hand
 *       this one to a labeller). --sample: only the 50-pair second-labeller sample.
 *
 *   node scripts/meaning-sheet.mjs import <filled-sheet.md> --labeller <name> --type human|model [--model <id>] [--key <key.json>]
 *     → labels/<name>.json. `human`: you have checked every answer yourself (it counts for G0). `model`: an AI
 *       filled it in; it is reported beside the human answers and never decides a pair's final label. --key: the key
 *       the sheet was exported with (default labelling-sheet.key.json; the sample's is labelling-sheet.sample.key.json).
 *
 * Plain Node, no dependencies.
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const DIR = join(ROOT, "src/ai/fidelity/__fixtures__/meaning");
const SHEET = join(DIR, "labelling-sheet.md");
const KEY = join(DIR, "labelling-sheet.key.json");
const ANSWERS = ["faithful", "partly", "distorted", "unsure"];

const readJson = (p) => JSON.parse(readFileSync(p, "utf8"));
const fail = (msg) => {
  console.error(msg);
  process.exit(1);
};
const arg = (name) => {
  const i = process.argv.indexOf(name);
  return i > 0 ? process.argv[i + 1] : undefined;
};

/** A fixed shuffle (the same sheet every export), different from the order of the file. */
function shuffle(list, seed) {
  let h = 2166136261;
  for (const c of seed) h = Math.imul(h ^ c.charCodeAt(0), 16777619);
  const rand = () => ((h = Math.imul(h ^ (h >>> 15), 2246822507) ^ Math.imul(h ^ (h >>> 13), 3266489909)) >>> 0) / 4294967296;
  const a = list.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

const cell = (t) => t.replace(/\r?\n/g, " ").replace(/\|/g, "\\|");

function exportSheet() {
  const { pairs } = readJson(join(DIR, "pairs.json"));
  const config = readJson(join(DIR, "labelling.json"));
  const sampleOnly = process.argv.includes("--sample");
  const chosen = sampleOnly ? pairs.filter((p) => config.sample.includes(p.id)) : pairs;
  const order = shuffle(chosen, sampleOnly ? "sample" : "all");
  const key = { rubricVersion: config.rubricVersion, sample: sampleOnly, pairs: {} };
  const rows = order.map((p, i) => {
    const n = `P${String(i + 1).padStart(3, "0")}`;
    key.pairs[n] = { id: p.id, source: p.source, card: p.card };
    return `| ${n} | ${cell(p.source)} | ${cell(p.card)} |  |  |`;
  });
  const sheet = [
    `# Paraphrase labelling sheet (rubric v${config.rubricVersion}${sampleOnly ? ", second-labeller sample" : ""})`,
    "",
    "Each row is a **source** sentence and a **card** that restates it. For every row, answer one question:",
    "",
    "> Would a reader of the card alone come away believing something the source does not say?",
    "",
    "Fill in the **Answer** column with exactly one word, and the **Note** column where asked. Do not change any other column, the order of rows, or the numbers.",
    "",
    "| Answer | Use when |",
    "|---|---|",
    "| `faithful` | The card says what the source says, in other words, possibly shorter. A reader who acts on the card makes the same decision as one who read the source. Shorter is fine; stronger, wider, reversed or new is not. |",
    "| `distorted` | You can name the false belief in one sentence: a hedge removed, a condition or scope dropped or widened, a negation flipped, cause and effect swapped or reversed, a number or unit changed, a cost dropped or inverted, an absolute added. Put that sentence in Note. |",
    "| `partly` | Mostly right, but one detail a careful reader might care about is lost or bent, and you can't point to a clearly false claim. Note why (required). |",
    "| `unsure` | You can't decide. Note what you'd need to know (required). |",
    "",
    "Rules: judge meaning, not style. The card stands alone: don't fill in from the source. One false belief is enough. Hedges are equivalent within their class (can / may / might / could / sometimes / often; usually / typically / generally / in most cases); a hedge turned into a certainty is distorted. Numbers are exact after formatting (`1,000` = `1000` = one thousand; `200 ms` = 200 milliseconds); a different number or unit, or a range collapsed to one end, is distorted. A requirement for N means at least N unless an exact count is stated (\"two approvals are required\" = \"at least two\"); a limit is different (\"up to 3\" → \"3\" is distorted). When unsure, say so instead of guessing.",
    "",
    "| # | Source | Card | Answer | Note |",
    "|---|---|---|---|---|",
    ...rows,
    "",
  ].join("\n");
  writeFileSync(SHEET, sheet);
  writeFileSync(KEY, JSON.stringify(key, null, 2) + "\n");
  console.log(`Wrote ${order.length} rows to ${SHEET}\nKey (keep it away from the labeller): ${KEY}`);
}

/** Cells of one Markdown table row, honouring escaped pipes. */
function cellsOf(line) {
  const cells = [];
  let cur = "";
  for (let i = 0; i < line.length; i++) {
    if (line[i] === "\\" && line[i + 1] === "|") {
      cur += "|";
      i++;
    } else if (line[i] === "|") {
      cells.push(cur.trim());
      cur = "";
    } else cur += line[i];
  }
  cells.push(cur.trim());
  return cells.slice(1, -1);
}

function importSheet() {
  const path = process.argv[3];
  const labeller = arg("--labeller");
  const type = arg("--type");
  if (!path || !existsSync(path)) fail("Usage: node scripts/meaning-sheet.mjs import <filled-sheet.md> --labeller <name> --type human|model [--model <id>]");
  if (!labeller) fail("--labeller <name> is required.");
  if (type !== "human" && type !== "model") fail("--type must be human (you checked every answer) or model (an AI filled it in).");
  const keyPath = arg("--key") ? resolve(arg("--key")) : KEY;
  if (!existsSync(keyPath)) fail(`Missing ${keyPath}: export the sheet first.`);
  const key = readJson(keyPath);
  const { pairs } = readJson(join(DIR, "pairs.json"));
  const byId = new Map(pairs.map((p) => [p.id, p]));
  const labels = {};
  const problems = [];
  let blank = 0;
  for (const line of readFileSync(path, "utf8").split(/\r?\n/)) {
    if (!/^\|\s*P\d{3}\s*\|/.test(line)) continue;
    const [n, , , rawAnswer = "", note = ""] = cellsOf(line);
    const entry = key.pairs[n];
    if (!entry) {
      problems.push(`${n}: not in the key`);
      continue;
    }
    const answer = rawAnswer.replace(/[`*_]/g, "").trim().toLowerCase();
    if (!answer) {
      blank++;
      continue;
    }
    if (!ANSWERS.includes(answer)) {
      problems.push(`${n}: "${rawAnswer}" is not one of ${ANSWERS.join(", ")}`);
      continue;
    }
    if ((answer === "partly" || answer === "unsure") && !note) problems.push(`${n}: ${answer} needs a note`);
    const pair = byId.get(entry.id);
    if (!pair || pair.source !== entry.source || pair.card !== entry.card) {
      problems.push(`${n}: the pair changed since the sheet was exported; skipped`);
      continue;
    }
    labels[entry.id] = { answer, ...(note ? { note } : {}), source: pair.source, card: pair.card, at: new Date().toISOString() };
  }
  if (problems.length) fail(`Not imported; fix these rows first:\n  ${problems.join("\n  ")}`);
  const slug = labeller.toLowerCase().replace(/[^a-z0-9]+/g, "-");
  const out = join(DIR, "labels", `${slug}.json`);
  const file = { labeller, type, ...(arg("--model") ? { model: arg("--model") } : {}), rubricVersion: key.rubricVersion, labels };
  writeFileSync(out, JSON.stringify(file, null, 2) + "\n");
  console.log(`Wrote ${Object.keys(labels).length} answers to ${out} (${type}); ${blank} rows left blank.`);
}

const command = process.argv[2];
if (command === "export") exportSheet();
else if (command === "import") importSheet();
else fail("Usage: node scripts/meaning-sheet.mjs export [--sample] | import <filled-sheet.md> --labeller <name> --type human|model [--model <id>]");
