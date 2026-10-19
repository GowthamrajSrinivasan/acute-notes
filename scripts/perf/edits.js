// Edit-cost benchmark: can Acute modify a large workspace without cascading
// work? One change on a ~1,000-element canvas should repaint only what it
// touches, write only what it changed, and never go to the network.
// Run through scripts/perf/run.mjs (or Playwright's `browser_run_code_unsafe`).
// eslint-disable-next-line @typescript-eslint/no-unused-expressions -- evaluated as a function expression by the runner
async (page) => {
  const BASE = globalThis.ACUTE_PERF_BASE ?? "http://localhost:3100";
  const url = `${BASE}/workspace/perf-edits-${Date.now().toString(36)}`;
  const SPEC = { shapes: 800, textItems: 60, blocks: 100, pages: 40 };

  await page.addInitScript(() => sessionStorage.setItem("acuteDev", "1"));
  const ready = async () => {
    await page.waitForFunction(() => window.__acuteDev?.api && window.__acuteDev.timings()["acute:canvas-ready"] !== undefined, null, { timeout: 60000 });
    await page.waitForTimeout(1500);
  };
  await page.goto(url);
  await ready();
  await page.evaluate((s) => window.__acuteDev.seed(s), SPEC);
  await page.waitForTimeout(1000);
  await page.goto(url);
  await ready();

  // Frame the blocks area so a dozen embeds are on screen.
  const targets = await page.evaluate(async () => {
    const { api } = window.__acuteDev;
    const blocks = api.getSceneElements().filter((e) => e.customData?.acute?.kind === "rich-block" && e.customData.acute.style?.frame === "card");
    const pages = api.getSceneElements().filter((e) => e.customData?.acute?.kind === "page-preview");
    const first = blocks[8] ?? blocks[0];
    api.updateScene({ appState: { zoom: { value: 0.6 }, scrollX: -first.x + 200, scrollY: -first.y + 150 } });
    await new Promise((r) => setTimeout(r, 1000));
    const visible = new Set([...document.querySelectorAll(".excalidraw__embeddable-container [data-element-id]")].map((n) => n.getAttribute("data-element-id")));
    const onScreen = blocks.filter((b) => visible.has(b.id));
    const pick = (type) => onScreen.find((b) => b.customData.acute.blockType === type);
    return {
      visible: visible.size,
      text: pick("text")?.id,
      table: pick("table")?.customData.acute.documentId,
      tableEl: pick("table")?.id,
      move: onScreen.find((b) => b.customData.acute.blockType === "todo")?.id,
      del: onScreen.find((b) => b.customData.acute.blockType === "code")?.id,
      page: pages[0]?.customData.acute.pageId,
    };
  });

  // Same-origin static files (lazy-loaded code, fonts) are counted apart from real network use.
  const origin = new URL(BASE).origin;
  let requests = { assets: 0, other: [] };
  page.on("request", (r) => {
    const u = r.url();
    if (u.startsWith("data:") || u.startsWith("blob:")) return;
    if (u.startsWith(origin + "/_next/static/") || u.startsWith(origin + "/fonts/") || /\.(woff2?|ttf)$/.test(u)) requests.assets++;
    else requests.other.push(u);
  });
  const results = { elements: Object.values(SPEC).reduce((a, b) => a + b, 0), visibleEmbeds: targets.visible, ops: {} };
  const op = async (name, target, run) => {
    requests = { assets: 0, other: [] };
    const report = await run();
    results.ops[name] = {
      ...report,
      target,
      onlyTarget: report.contentChanged.every((id) => id === target),
      assetLoads: requests.assets,
      network: requests.other.length,
      ...(requests.other.length ? { networkUrls: requests.other } : {}),
    };
  };

  // 1. Type into a text block (real editor, real keyboard), then leave editing.
  await op("type in text block", targets.text, async () => {
    await page.evaluate((id) => {
      const { api } = window.__acuteDev;
      const el = api.getSceneElements().find((e) => e.id === id);
      api.updateScene({ appState: { activeEmbeddable: { element: el, state: "active" }, selectedElementIds: { [id]: true } } });
    }, targets.text);
    await page.waitForSelector(".acute-block[data-active] .bn-editor[contenteditable='true']", { timeout: 15000 });
    await page.waitForTimeout(500);
    // Focus directly: the properties panel may cover part of the block.
    await page.evaluate(() => document.querySelector(".acute-block[data-active] .bn-editor").focus());
    await page.keyboard.press("Control+End");
    await page.evaluate(() => {
      window.__keys = window.__acuteDev.recordKeyLatency();
      window.__work = window.__acuteDev.watchWork(() => new Promise((r) => (window.__typed = r)));
    });
    await page.keyboard.type(" Authentication uses Auth0", { delay: 30 });
    await page.keyboard.press("Escape");
    await page.evaluate(() => window.__typed());
    const report = await page.evaluate(() => window.__work);
    const keys = await page.evaluate(() => window.__keys.stop());
    return { ...report, keyLatency: keys };
  });

  // 2. Replace a table's content through the document store (as import / AI would).
  await op("change table content", targets.tableEl, () =>
    page.evaluate((docId) => {
      const { store, watchWork } = window.__acuteDev;
      return watchWork(() => {
        const rec = store.get(docId);
        const table = structuredClone(rec.snapshot);
        table[0].content.rows[1].cells[1] = [{ type: "text", text: "changed", styles: {} }];
        store.updateSnapshot(docId, table);
      });
    }, targets.table),
  );

  // 3. Move one block (one scene change, as at the end of a drag).
  await op("move block", targets.move, () =>
    page.evaluate((id) => {
      const { api, watchWork } = window.__acuteDev;
      return watchWork(() => {
        api.updateScene({
          elements: api.getSceneElementsIncludingDeleted().map((e) => (e.id === id ? { ...e, x: e.x + 60, version: e.version + 1, versionNonce: e.versionNonce + 1 } : e)),
        });
      });
    }, targets.move),
  );

  // 4. Delete one block.
  await op("delete block", targets.del, () =>
    page.evaluate((id) => {
      const { api, watchWork } = window.__acuteDev;
      return watchWork(() => {
        api.updateScene({
          elements: api.getSceneElementsIncludingDeleted().map((e) => (e.id === id ? { ...e, isDeleted: true, version: e.version + 1, versionNonce: e.versionNonce + 1 } : e)),
        });
      });
    }, targets.del),
  );

  // 5. Rename a page shown on screen (its preview updates; nothing else should).
  const pageEl = await page.evaluate(async (pageId) => {
    const { api } = window.__acuteDev;
    const el = api.getSceneElements().find((e) => e.customData?.acute?.pageId === pageId);
    api.updateScene({ appState: { scrollX: -el.x + 200, scrollY: -el.y + 150 } });
    await new Promise((r) => setTimeout(r, 800));
    return el.id;
  }, targets.page);
  await op("rename page", pageEl, () =>
    page.evaluate((pageId) => {
      const { store, watchWork } = window.__acuteDev;
      return watchWork(() => store.update(pageId, { title: "Renamed page" }));
    }, targets.page),
  );

  return JSON.stringify(results, null, 1);
}
