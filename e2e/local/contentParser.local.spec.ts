/**
 * F28 in the real app: content analysis runs in its Web Worker, so even a
 * very large paste doesn't block the main thread, and the local tier plans
 * explicit structure with no AI call.
 */
import { expect, test } from "@playwright/test";
import { openApp, recordAIRequests } from "../helpers";

type Analysis = { parsed: { blocks: { type: string }[] }; local: { sufficient: boolean; confidence: number; plan: { template: string; nodes: { type: string }[] } | null } };

test("large content is analysed in the worker without long main-thread tasks, and with no AI request", async ({ page }) => {
  const ai = recordAIRequests(page);
  await openApp(page);
  const result = await page.evaluate(async () => {
    const section = (i: number) => `## Section ${i}\n\nSome **prose** with a [link](https://x.test/${i}).\n\n- [ ] task ${i}\n- item\n\n| a | b |\n| - | - |\n| ${i} | 2 |\n\n`;
    const doc = Array.from({ length: 1200 }, (_, i) => section(i)).join("");
    const longTasks: number[] = [];
    const observer = new PerformanceObserver((list) => list.getEntries().forEach((e) => longTasks.push(e.duration)));
    observer.observe({ type: "longtask", buffered: false });
    const dev = (window as unknown as { __acuteDev: { analyzeContent(s: string): Promise<Analysis> } }).__acuteDev;
    await dev.analyzeContent("# warm up"); // loads the module and starts the worker
    const t0 = performance.now();
    const r = await dev.analyzeContent(doc);
    const ms = performance.now() - t0;
    await new Promise((res) => setTimeout(res, 100)); // let the observer report
    observer.disconnect();
    return { chars: doc.length, ms, blocks: r.parsed.blocks.length, maxLongTask: Math.max(0, ...longTasks), plan: r.local.plan };
  });
  console.info(`[F28] worker analysed ${result.chars} chars in ${result.ms.toFixed(0)} ms; longest main-thread task ${result.maxLongTask.toFixed(0)} ms`);
  expect(result.chars).toBeGreaterThan(140_000);
  expect(result.blocks).toBe(1200 * 4);
  // Parsing this in-thread takes ~1 s; in the worker the main thread stays free.
  expect(result.maxLongTask).toBeLessThan(200);
  expect(result.plan).toBeNull(); // 3600 parts: over the plan's node limit
  expect(ai).toHaveLength(0);
});

test("explicit structure is planned locally; prose is flagged for AI; oversized content is refused", async ({ page }) => {
  await openApp(page);
  const run = (input: string) =>
    page.evaluate((s) => (window as unknown as { __acuteDev: { analyzeContent(s: string): Promise<Analysis> } }).__acuteDev.analyzeContent(s), input);

  const checklist = await run("# Launch\n\n- [x] RFC\n- [ ] Load test\n\n| Env | Ready |\n| - | - |\n| prod | no |\n");
  expect(checklist.local.sufficient).toBe(true);
  expect(checklist.local.plan!.nodes.map((n) => n.type)).toEqual(["heading", "todo", "table"]);

  const prose = await run("The gateway times out under load, customers retry, and some get charged twice. We suspect the queue.");
  expect(prose.local.sufficient).toBe(false);

  const error = await page.evaluate(async () => {
    try {
      await (window as unknown as { __acuteDev: { analyzeContent(s: string): Promise<unknown> } }).__acuteDev.analyzeContent("x".repeat(200_001));
      return null;
    } catch (e) {
      return { name: (e as Error).name, message: (e as Error).message };
    }
  });
  expect(error).toEqual({ name: "ContentTooLargeError", message: expect.stringContaining("the limit is 200,000") });
});
