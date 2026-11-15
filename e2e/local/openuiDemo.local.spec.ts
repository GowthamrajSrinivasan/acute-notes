/**
 * Phase 1 OpenUI spike (`.ai/docs/open-intelligent-ui-audit.md`, Option A): drives the dev-only demo page at
 * `/dev/openui-demo` and saves screenshots so the rendering + streaming behaviour can be reviewed without opening
 * a browser. No AI calls — the page renders `acuteCardLibrary` on static fixture text (`src/ai/openui/library.tsx`).
 *
 * Screenshots land in OPENUI_DEMO_OUTPUT_DIR (defaults to a repo-local folder) rather than Playwright's own
 * test-results, so they're easy to find on their own.
 */
import { expect, test } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { join } from "node:path";

const OUTPUT_DIR = process.env.OPENUI_DEMO_OUTPUT_DIR ?? join(process.cwd(), "test-results", "openui-demo");
mkdirSync(OUTPUT_DIR, { recursive: true });

test("OpenUI demo page streams a card in and renders all 5 components", async ({ page }) => {
  await page.goto("/dev/openui-demo");

  const streamSection = page.getByTestId("stream-demo");
  const gallery = page.getByTestId("component-gallery");

  // 1. Just loaded: streaming has started but almost nothing has arrived yet.
  await expect(streamSection).toHaveAttribute("data-streaming", "true");
  await page.screenshot({ path: join(OUTPUT_DIR, "01-stream-start.png"), fullPage: true });

  // 2. Mid-stream: some content visible, still marked streaming.
  await page.waitForTimeout(650);
  await expect(streamSection).toHaveAttribute("data-streaming", "true");
  await expect(streamSection).toContainText("Idempotency keys", { timeout: 5_000 });
  await page.screenshot({ path: join(OUTPUT_DIR, "02-stream-mid.png"), fullPage: true });

  // 3. Complete: the card finished streaming in, full body + both citation chips present.
  await expect(streamSection).toHaveAttribute("data-streaming", "false", { timeout: 10_000 });
  await expect(streamSection.locator(".openui-idea-card__body")).toContainText("charging twice");
  await expect(streamSection.locator(".openui-citation-chip")).toHaveCount(2);
  await page.screenshot({ path: join(OUTPUT_DIR, "03-stream-complete.png"), fullPage: true });

  // 4. The gallery: one of each of the 5 components, fully rendered.
  await expect(gallery.locator(".openui-idea-card")).toHaveCount(1);
  await expect(gallery.locator(".openui-callout")).toHaveCount(2);
  await expect(gallery.locator(".openui-comparison-table")).toHaveCount(1);
  await expect(gallery.locator(".openui-source-link")).toHaveCount(1);
  await gallery.screenshot({ path: join(OUTPUT_DIR, "04-component-gallery.png") });

  // Full-page final state, for a single at-a-glance look.
  await page.screenshot({ path: join(OUTPUT_DIR, "05-full-page.png"), fullPage: true });
});
