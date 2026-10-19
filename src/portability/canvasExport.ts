import type { DocumentHome } from "@/domain/types";
import { getPersistence } from "@/persistence";
import { downloadText } from "./download";
import type { MarkdownOptions } from "./canvasMarkdown";
import { applyExportOptions, DEFAULT_EXPORT_OPTIONS, type ExportOptions } from "./exportOptions";
import { flushLiveState } from "./markdownExport";

export type CanvasExportFormat = "json" | "markdown";

/**
 * Downloads the open canvas: as its `.acute.json` bundle (the canvas, the
 * blocks it uses and its pages), with the details `options` turns off
 * removed, or as Markdown converted from that same bundle (`canvasMarkdown.ts`)
 * with the details `markdownOptions` turns off left out.
 */
export async function downloadCanvas(
  home: DocumentHome,
  format: CanvasExportFormat,
  options: ExportOptions = DEFAULT_EXPORT_OPTIONS,
  markdownOptions?: MarkdownOptions,
): Promise<void> {
  await flushLiveState();
  const { exportCanvas, bundleFileName } = await import("./workspaceBundle");
  const bundle = await exportCanvas(getPersistence(), home.workspaceId, home.canvasId);
  if (format === "json") {
    const detailed = applyExportOptions(bundle, options);
    downloadText(bundleFileName(detailed), JSON.stringify(detailed, null, 2), "application/json");
    return;
  }
  const { canvasToMarkdown } = await import("./canvasMarkdown");
  downloadText(bundleFileName(bundle, ".md"), canvasToMarkdown(bundle, undefined, markdownOptions), "text/markdown");
}
