// PRD §17.3 performance suite. Run through Playwright (e.g. the Playwright MCP
// `browser_run_code_unsafe` with `filename: "scripts/perf/suite.js"`) against a
// production build started with `ACUTE_DIST_DIR=.next-prod next build && next start -p 3100`.
// Each scenario gets its own fresh workspace, is seeded, then reloaded so the
// numbers describe a warm open of that workspace.
// eslint-disable-next-line @typescript-eslint/no-unused-expressions -- evaluated as a function expression by the runner
async (page) => {
  const BASE = globalThis.ACUTE_PERF_BASE ?? "http://localhost:3100";
  const RUN = Date.now().toString(36);
  const SCENARIOS = globalThis.ACUTE_PERF_SCENARIOS ?? [
    { name: "objects-100", spec: { shapes: 70, nativeText: 30 } },
    { name: "objects-500", spec: { shapes: 350, nativeText: 150 } },
    { name: "objects-1000", spec: { shapes: 700, nativeText: 300 } },
    { name: "blocks-25", spec: { shapes: 50, blocks: 25 } },
    { name: "blocks-50", spec: { shapes: 50, blocks: 50 } },
    { name: "textItems-200", spec: { textItems: 200 } },
    { name: "pages-100", spec: { pages: 100 } },
    { name: "images-20", spec: { shapes: 20, images: 20 } },
    { name: "mixed-1000", spec: { shapes: 600, nativeText: 150, textItems: 100, blocks: 50, pages: 80, images: 20 } },
  ];

  const ready = async () => {
    await page.waitForFunction(() => window.__acuteDev?.api && window.__acuteDev.timings()["acute:canvas-ready"] !== undefined, null, { timeout: 60000 });
    await page.waitForTimeout(1500); // fonts, lazy previews, image loads settle
  };
  const dev = (fn, arg) => page.evaluate(fn, arg);

  // The dev hooks stay enabled for the tab (the canvas redirect drops `?acuteDev`).
  await page.addInitScript(() => sessionStorage.setItem("acuteDev", "1"));
  const results = [];
  for (const { name, spec } of SCENARIOS) {
    const url = `${BASE}/workspace/perf-${RUN}-${name}?acuteDev`;
    await page.goto(url);
    await ready();
    const added = await dev((s) => window.__acuteDev.seed(s), spec);
    await dev(() => window.__acuteDev.api.scrollToContent(undefined, { fitToContent: false }));
    const persist = await dev(() => window.__acuteDev.measurePersistence());
    await page.waitForTimeout(800);

    // Warm open: reload the seeded workspace.
    const t0 = Date.now();
    await page.goto(url.replace(/\/workspace\/([^/?]+)/, "/workspace/$1"));
    await ready();
    const wallOpenMs = Date.now() - t0 - 1500;
    const open = await dev(() => window.__acuteDev.timings());
    const nav = await dev(() => {
      const n = performance.getEntriesByType("navigation")[0];
      return n ? { domContentLoaded: Math.round(n.domContentLoadedEventEnd), load: Math.round(n.loadEventEnd) } : null;
    });

    const pan = await dev(() => window.__acuteDev.measurePan(3000));
    const zoom = await dev(() => window.__acuteDev.measureZoom(3000));

    // Drag the element nearest the viewport centre with the real mouse.
    const target = await dev(() => {
      const { api } = window.__acuteDev;
      const s = api.getAppState();
      const cx = s.width / 2 / s.zoom.value - s.scrollX;
      const cy = s.height / 2 / s.zoom.value - s.scrollY;
      let best = null, bestD = Infinity;
      for (const el of api.getSceneElements()) {
        if (el.type === "arrow" || el.type === "line") continue;
        const d = Math.hypot(el.x + el.width / 2 - cx, el.y + el.height / 2 - cy);
        if (d < bestD) {
          bestD = d;
          best = el;
        }
      }
      if (!best) return null;
      const z = s.zoom.value;
      // Grab near the top-left edge: the centre of a block is its content (click-to-edit).
      return { x: (best.x + 6 + s.scrollX) * z + s.offsetLeft, y: (best.y + 6 + s.scrollY) * z + s.offsetTop, type: best.type };
    });
    let drag = null;
    if (target) {
      await page.mouse.move(target.x, target.y);
      await page.mouse.down();
      await dev(() => (window.__dragRec = window.__acuteDev.recordFrames()));
      const t = Date.now();
      for (let i = 1; i <= 90; i++) {
        await page.mouse.move(target.x + Math.sin(i / 10) * 200, target.y + i * 2);
      }
      const moveMs = Date.now() - t;
      drag = { ...(await dev(() => window.__dragRec.stop())), perMoveMs: Math.round((moveMs / 90) * 10) / 10, target: target.type };
      await page.mouse.up();
      await page.keyboard.press("Control+z");
    }

    const before = await dev(() => window.__acuteDev.domCounts());
    const sweep = await dev(() => window.__acuteDev.sweep(4000));
    const after = await dev(() => window.__acuteDev.domCounts());
    const panAfterSweep = await dev(() => window.__acuteDev.measurePan(2000));
    const memory = await dev(() => window.__acuteDev.memory());

    results.push({ name, added, open: { ...open, wallOpenMs, nav }, persist, pan, zoom, drag, sweep, panAfterSweep, dom: { before, after }, memory });
  }
  return JSON.stringify(results, null, 1);
}
