// Runs the performance suites in headless Chromium, prints per-scenario
// medians and checks them against the budgets below. See ./README.md.
//
//   node scripts/perf/run.mjs [--runs 3] [--throttle 4] [--out perf.json] [--only name,name]
//                             [--suite render|edits|all] [--base http://localhost:3100]
//
// Exit code 1 when a budget fails. Budgets gate only unthrottled runs (the
// "normal hardware" case); throttled runs report against them for information.
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

let chromium;
try {
  ({ chromium } = await import("playwright"));
} catch {
  console.error("Playwright is not installed. Run `npm i --no-save playwright` (browsers: `npx playwright install chromium`).");
  process.exit(1);
}

/** Acute performance budgets: [warn, fail] thresholds. */
const BUDGETS = {
  /** Warm open of a seeded workspace (navigation → interactive canvas), ms. Target < 500. */
  openMs: [750, 1500],
  /** Pan / zoom / drag frame rate. Target 60. */
  fps: [50, 30],
  /** A single edit or keystroke until its frame is painted, ms. */
  editPaintMs: [50, 100],
};

const args = Object.fromEntries(
  process.argv.slice(2).reduce((acc, a, i, all) => (a.startsWith("--") ? [...acc, [a.slice(2), all[i + 1]]] : acc), []),
);
const runs = Number(args.runs ?? 3);
const throttle = Number(args.throttle ?? 1);
const which = args.suite ?? "all";
if (args.base) globalThis.ACUTE_PERF_BASE = args.base;
const load = (name) => (0, eval)(readFileSync(fileURLToPath(new URL(name, import.meta.url)), "utf8"));
const suites = { render: load("./suite.js"), edits: load("./edits.js") };

async function inBrowser(fn) {
  const browser = await chromium.launch({ args: ["--enable-precise-memory-info"] });
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    page.on("pageerror", (e) => console.error("[pageerror]", e.message));
    if (throttle > 1) {
      const cdp = await page.context().newCDPSession(page);
      await cdp.send("Emulation.setCPUThrottlingRate", { rate: throttle });
    }
    return JSON.parse(await fn(page));
  } finally {
    await browser.close();
  }
}

const median = (xs) => {
  const s = xs.filter((x) => typeof x === "number").sort((a, b) => a - b);
  return s.length ? s[Math.floor(s.length / 2)] : null;
};
const at = (fn) => (x) => { try { return fn(x); } catch { return null; } };

const checks = [];
/** Records a budget check; `higherIsBetter` for frame rates. */
function check(what, value, [warn, fail], higherIsBetter = false) {
  if (value === null) return;
  const bad = (limit) => (higherIsBetter ? value < limit : value > limit);
  checks.push({ what, value, status: bad(fail) ? "FAIL" : bad(warn) ? "warn" : "ok" });
}
const require_ = (what, ok, detail) => checks.push({ what, value: detail, status: ok ? "ok" : "FAIL" });

const out = { throttle, runs };

if (which === "all" || which === "render") {
  const all = [];
  for (let r = 0; r < runs; r++) {
    let results = await inBrowser(suites.render);
    if (args.only) results = results.filter((x) => args.only.split(",").includes(x.name));
    all.push(results);
    console.error(`render run ${r + 1}/${runs} done`);
  }
  const rows = all[0].map((first, i) => {
    const g = (fn) => median(all.map((run) => at(fn)(run[i])));
    return {
      scenario: first.name,
      elements: first.added,
      "open ms": g((x) => x.open.wallOpenMs),
      "canvas ready ms": g((x) => x.open["acute:canvas-ready"]),
      "persist ms": g((x) => x.persist.flushMs),
      "pan fps": g((x) => x.pan.fps),
      "zoom fps": g((x) => x.zoom.fps),
      "drag fps": g((x) => x.drag.fps),
      "drag max ms": g((x) => x.drag.max),
      "pan fps (after sweep)": g((x) => x.panAfterSweep.fps),
      "mounted embeds": g((x) => x.dom.after.embeds),
      "DOM nodes": g((x) => x.dom.after.nodes),
      "heap MB": g((x) => x.memory.usedMB),
    };
  });
  console.log("\nRendering a large workspace");
  console.table(rows);
  for (const row of rows) {
    check(`${row.scenario}: warm open ms`, row["open ms"], BUDGETS.openMs);
    for (const k of ["pan fps", "zoom fps", "drag fps", "pan fps (after sweep)"]) check(`${row.scenario}: ${k}`, row[k], BUDGETS.fps, true);
  }
  out.render = { rows, raw: all };
}

if (which === "all" || which === "edits") {
  const all = [];
  for (let r = 0; r < runs; r++) {
    all.push(await inBrowser(suites.edits));
    console.error(`edits run ${r + 1}/${runs} done`);
  }
  const names = Object.keys(all[0].ops);
  const rows = names.map((name) => {
    const g = (fn) => median(all.map((run) => at(fn)(run.ops[name])));
    const ops = all.map((run) => run.ops[name]);
    return {
      edit: name,
      "paint ms": g((o) => o.keyLatency?.p95 ?? o.firstPaintMs),
      "blocks re-rendered": g((o) => o.contentChanged.length),
      "only target": ops.every((o) => o.onlyTarget),
      "moved/removed": g((o) => o.containerChanged + o.removed),
      "DOM mutations": g((o) => o.domMutations),
      "storage writes": g((o) => Object.values(o.storageWrites).reduce((a, b) => a + b, 0)),
      "settled ms": g((o) => o.settledMs),
      "long frames": g((o) => o.frames.long),
      network: Math.max(...ops.map((o) => o.network)),
      "lazy asset loads": g((o) => o.assetLoads),
    };
  });
  console.log(`\nEditing a ${all[0].elements}-element workspace (${all[0].visibleEmbeds} embeds on screen)`);
  console.table(rows);
  for (const row of rows) {
    check(`${row.edit}: paint ms`, row["paint ms"], BUDGETS.editPaintMs);
    require_(`${row.edit}: re-renders only its own block`, row["only target"] && row["blocks re-rendered"] <= 1, `${row["blocks re-rendered"]} block(s)`);
    require_(`${row.edit}: no network requests`, row.network === 0, `${row.network} request(s)`);
    check(`${row.edit}: long frames`, row["long frames"], [0, 2]);
  }
  out.edits = { rows, raw: all };
}

const gating = throttle === 1;
const failed = checks.filter((c) => c.status === "FAIL");
const warned = checks.filter((c) => c.status === "warn");
console.log(`\nBudgets${gating ? "" : ` (informational at --throttle ${throttle})`}: ${checks.length - failed.length - warned.length} ok, ${warned.length} warn, ${failed.length} fail`);
for (const c of [...failed, ...warned]) console.log(`  ${c.status.padEnd(4)} ${c.what}: ${c.value}`);
out.budgets = checks;
if (args.out) writeFileSync(args.out, JSON.stringify(out, null, 1));
if (gating && failed.length) process.exit(1);
