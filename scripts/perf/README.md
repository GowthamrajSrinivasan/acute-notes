# Performance suite (PRD §17.3)

Two browser suites run against a production build, plus deterministic checks
in `src/performance/largeWorkspace.test.ts` (run with `npm test`). The tests
pin *how much* work happens per interaction: one write per drag, one batched
read of all block and page records per canvas open.

| Suite | Question | File |
|---|---|---|
| render | Can Acute render a large workspace smoothly? | `suite.js` |
| edits | Can Acute modify a large workspace without cascading work? | `edits.js` |

```sh
# 1. Production build beside `next dev` (separate dist dir)
ACUTE_DIST_DIR=.next-prod npx next build
ACUTE_DIST_DIR=.next-prod npx next start -p 3100

# 2. Once: the runner uses Playwright without making it a dependency
npm i --no-save playwright && npx playwright install chromium

# 3. Run both suites (medians of 3 runs) and check the budgets
node scripts/perf/run.mjs --runs 3 --out perf.json
node scripts/perf/run.mjs --suite edits --runs 1       # quick edit-cost check
node scripts/perf/run.mjs --throttle 4                 # headroom (budgets informational)
```

## Budgets

`run.mjs` exits with code 1 when an unthrottled run breaks a budget.

| Measure | Target | Warn | Fail |
|---|---|---|---|
| Warm open (navigation → interactive canvas) | < 500 ms | > 750 ms | > 1.5 s |
| Pan / zoom / drag / pan after sweep | 60 FPS | < 50 FPS | < 30 FPS |
| One edit or keystroke → painted frame | < 50 ms | > 50 ms | > 100 ms |
| Blocks re-rendered by one edit | only the edited one | | any other |
| Network requests during an edit | 0 | | > 0 |
| Long frames (> 50 ms) during an edit | 0 | > 0 | > 2 |

Architectural rule behind the last two: nothing on the editing or rendering
path waits on the network. AI work, once it exists, must stay asynchronous
and outside that path (PRD §8.1).

## What the suites do

**render**: each scenario (100/500/1,000 objects, 25/50 blocks, 200 text
items, 100 page previews, 20 images, a 1,000-element mix) opens a fresh
workspace, seeds it (`window.__acuteDev.seed`) and reloads it. It then
measures warm open, persistence of a whole-scene change, pan / zoom / drag
frame rates, a sweep across the whole canvas, pan after the sweep, mounted
embeds, DOM size and JS heap.

**edits**: on a 1,000-element canvas with ~18 embeds on screen, it types into
a text block (real editor and keyboard), replaces a table's content, moves a
block, deletes a block and renames a page. For each it records the time to
the painted frame, which blocks re-rendered, DOM mutations, IndexedDB writes,
time until storage settles, long frames and network requests. Same-origin
lazy-loaded code (the editor on first activation) is reported separately.

## Known boundary: zoom under CPU throttling

Zoom holds 60 FPS on normal hardware, but at `--throttle 4` it drops to about
15–35 FPS. The drop is the same on a canvas of plain shapes with no Acute
content. Profiling attributes under 1% of zoom time to Acute code. The rest is
Excalidraw regenerating its per-element canvas caches at each zoom level
(`save` / `drawImage` / `getContext`) plus the browser rasterising them.
That cost belongs to Excalidraw's renderer. Don't change Acute's document or
React architecture to address it.

## Dev hooks

The hooks in `src/performance/synthetic.ts` are available in `next dev`, or in
a production build after opening any canvas URL with `?acuteDev` once in the
tab:

```js
await __acuteDev.seed({ shapes: 500, blocks: 50, pages: 100, images: 10 })
await __acuteDev.measurePan()      // { fps, p50, p95, max, long }
await __acuteDev.measureZoom()
await __acuteDev.sweep()           // pan over everything once
await __acuteDev.watchWork(() => __acuteDev.store.update(id, { title: "x" }))
__acuteDev.domCounts()             // mounted embeds / editors / DOM nodes
__acuteDev.timings()               // acute:session-load, acute:canvas-ready
```

Frame rates cap at the display refresh rate, so compare runs at `--throttle 4`
to see headroom. The machine should be otherwise idle: a busy dev server or
build skews throttled numbers by 2× or more.
