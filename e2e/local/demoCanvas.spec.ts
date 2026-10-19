/**
 * Dev tool: ⋮ → "Create AI test canvas" creates a new canvas in the current
 * workspace holding every object type. No AI connection needed.
 */
import { expect, test, type Page } from "@playwright/test";

interface SceneSummary {
  types: string[];
  blocks: { blockType: string; frameless: boolean }[];
  pages: boolean[];
  labels: number;
  freeText: number;
  relations: string[];
  arrowsToEmbeds: number;
  documentsLoaded: number;
}

function summarize(page: Page): Promise<SceneSummary> {
  return page.evaluate(() => {
    type El = {
      id: string;
      type: string;
      containerId?: string | null;
      startBinding?: { elementId: string } | null;
      endBinding?: { elementId: string } | null;
      customData?: { acute?: { kind: string; blockType?: string; documentId?: string; pageId?: string; preview?: boolean; style?: { frame: string } }; acuteRelation?: string };
    };
    const dev = (window as unknown as { __acuteDev: { api: { getSceneElements(): El[] }; store: { get(id: string): unknown } } }).__acuteDev;
    const els = dev.api.getSceneElements();
    const embeds = new Set(els.filter((e) => e.type === "embeddable").map((e) => e.id));
    const acute = els.filter((e) => e.customData?.acute);
    return {
      types: [...new Set(els.map((e) => e.type))].sort(),
      blocks: acute
        .filter((e) => e.customData!.acute!.kind === "rich-block")
        .map((e) => ({ blockType: e.customData!.acute!.blockType!, frameless: e.customData!.acute!.style?.frame === "none" })),
      pages: acute.filter((e) => e.customData!.acute!.kind === "page-preview").map((e) => e.customData!.acute!.preview === true),
      labels: els.filter((e) => e.type === "text" && e.containerId).length,
      freeText: els.filter((e) => e.type === "text" && !e.containerId).length,
      relations: els.flatMap((e) => (e.type === "arrow" && e.customData?.acuteRelation ? [e.customData.acuteRelation] : [])).sort(),
      arrowsToEmbeds: els.filter((e) => e.type === "arrow" && (embeds.has(e.startBinding?.elementId ?? "") || embeds.has(e.endBinding?.elementId ?? ""))).length,
      documentsLoaded: acute.filter((e) => {
        const a = e.customData!.acute!;
        return Boolean(dev.store.get((a.documentId ?? a.pageId)!));
      }).length,
    };
  });
}

test("creates a canvas holding every object type, and it persists", async ({ page }) => {
  await page.goto("/");
  await page.locator(".excalidraw").waitFor();
  const firstUrl = page.url();

  await page.getByRole("button", { name: "More", exact: true }).click();
  await page.getByRole("menuitem", { name: /Create AI test canvas/ }).click();
  await page.waitForURL((url) => url.href !== firstUrl);
  await expect(page.getByRole("button", { name: /AI test canvas/ })).toBeVisible();
  await page.waitForFunction(() => {
    const dev = (window as unknown as { __acuteDev?: { api: { getSceneElements(): unknown[] } } }).__acuteDev;
    return (dev?.api.getSceneElements().length ?? 0) > 20;
  });

  const check = async () => {
    const s = await summarize(page);
    expect(s.types).toEqual(["arrow", "diamond", "ellipse", "embeddable", "freedraw", "image", "line", "rectangle", "text"]);
    expect(s.blocks).toEqual(
      expect.arrayContaining([
        { blockType: "text", frameless: false },
        { blockType: "todo", frameless: false },
        { blockType: "table", frameless: false },
        { blockType: "code", frameless: false },
        { blockType: "text", frameless: true },
      ]),
    );
    expect(s.pages.sort()).toEqual([false, true]);
    expect(s.labels).toBeGreaterThanOrEqual(6); // 4 shape labels + 2 arrow labels
    expect(s.freeText).toBeGreaterThanOrEqual(2);
    expect(s.relations).toEqual(["caused_by", "depends_on", "derived_from", "implements", "references"]);
    expect(s.arrowsToEmbeds).toBe(4);
    expect(s.documentsLoaded).toBe(s.blocks.length + s.pages.length);
  };
  await check();
  await page.screenshot({ path: "test-results/demo-canvas.png" });

  // Everything went through normal persistence.
  await page.waitForTimeout(1_500);
  await page.reload();
  await page.locator(".excalidraw").waitFor();
  await page.waitForFunction(() => {
    const dev = (window as unknown as { __acuteDev?: { api: { getSceneElements(): unknown[] } } }).__acuteDev;
    return (dev?.api.getSceneElements().length ?? 0) > 20;
  });
  await expect.poll(async () => (await summarize(page)).documentsLoaded, { timeout: 15_000 }).toBeGreaterThanOrEqual(8);
  await check();
  await page.waitForTimeout(1_500);
  await page.screenshot({ path: "test-results/demo-canvas-reloaded.png" });
});
