"use client";

import { useEffect, useState } from "react";
import { CloseIcon } from "@/components/common/icons";
import type { DocumentHome } from "@/domain/types";
import { downloadCanvas, type CanvasExportFormat } from "@/portability/canvasExport";
import { DEFAULT_MARKDOWN_OPTIONS, MARKDOWN_OPTION_KEYS, type MarkdownOptions } from "@/portability/canvasMarkdown";
import { DEFAULT_EXPORT_OPTIONS, EXPORT_OPTION_KEYS, type ExportOptions } from "@/portability/exportOptions";

const FORMATS: readonly { id: CanvasExportFormat; label: string }[] = [
  { id: "json", label: "JSON" },
  { id: "markdown", label: "Markdown" },
];

const OPTIONS: Record<keyof ExportOptions, { label: string; hint: string }> = {
  origin: { label: "Origin", hint: "Whether AI or you created each object, and for AI the provider and task." },
  blockStyles: { label: "Block styles", hint: "Colours, fonts and frames of rich blocks." },
  connectionTypes: { label: "Connection types", hint: "What each arrow means: depends on, explained by, and so on." },
  images: { label: "Images", hint: "Image files, embedded in the export. Turn off for a much smaller file." },
  viewSettings: { label: "View settings", hint: "Where the canvas was scrolled and zoomed, and its background colour." },
  layoutHints: { label: "Layout hints", hint: "Where Acute placed each object, so AI can tell your arrangement from its own." },
};

const MARKDOWN_OPTIONS: Record<keyof MarkdownOptions, { label: string; hint: string }> = {
  pageContent: { label: "Page content", hint: "Each page's text under its title. Off: page titles only." },
  frameHeadings: { label: "Frame headings", hint: "A heading for each frame, before the objects inside it." },
  imagePlaceholders: { label: "Image placeholders", hint: "An “(image)” line where each image is. Images themselves are never in Markdown." },
  connections: { label: "Connections", hint: "A list of every arrow at the end: what links to what, with its label." },
  connectionTypes: { label: "Connection types", hint: "What each connection means in that list: depends on, explained by, and so on." },
};

/** One "Include" section of checkboxes: a hint, a select/clear-all toggle, and one row per option. */
function IncludeOptions<K extends string>({
  keys,
  labels,
  values,
  hint,
  onChange,
}: {
  keys: readonly K[];
  labels: Record<K, { label: string; hint: string }>;
  values: Record<K, boolean>;
  hint: string;
  onChange: (next: Record<K, boolean>) => void;
}) {
  const allOn = keys.every((k) => values[k]);
  return (
    <section aria-labelledby="acute-export-include">
      <div className="acute-ai-group__heading">
        <span id="acute-export-include" className="acute-ai-group__label">
          Include
        </span>
        <span className="acute-ai-group__hint">{hint}</span>
        <button
          type="button"
          className="acute-ask-ai__link acute-export-canvas__all"
          onClick={() => onChange(Object.fromEntries(keys.map((k) => [k, !allOn])) as Record<K, boolean>)}
        >
          {allOn ? "Clear all" : "Select all"}
        </button>
      </div>
      <div className="acute-export-canvas__options">
        {keys.map((k) => (
          <label key={k} className="acute-export-canvas__option">
            <input type="checkbox" checked={values[k]} onChange={(e) => onChange({ ...values, [k]: e.target.checked })} />
            <span>
              <span className="acute-ai-settings__footer-title">{labels[k].label}</span>
              <span className="acute-ai-settings__footer-hint">{labels[k].hint}</span>
            </span>
          </label>
        ))}
      </div>
    </section>
  );
}

/**
 * Export canvas (`⋮` → Export canvas…): choose a format and how much detail
 * the file carries (everything by default; each format has its own options).
 * Styled like AI settings (`acute-ai-settings`).
 */
export function CanvasExportDialog({ home, canvasTitle, onClose }: { home: DocumentHome; canvasTitle: string; onClose: () => void }) {
  const [format, setFormat] = useState<CanvasExportFormat>("json");
  const [options, setOptions] = useState<ExportOptions>(DEFAULT_EXPORT_OPTIONS);
  const [markdownOptions, setMarkdownOptions] = useState<MarkdownOptions>(DEFAULT_MARKDOWN_OPTIONS);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || busy) return;
      e.preventDefault();
      onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [busy, onClose]);

  const exportNow = () => {
    setBusy(true);
    setError(null);
    downloadCanvas(home, format, options, markdownOptions)
      .then(onClose)
      .catch((err: unknown) => {
        console.error("[acute-notes] canvas export failed", err);
        setError(err instanceof Error ? err.message : "The canvas couldn't be exported.");
      })
      .finally(() => setBusy(false));
  };

  return (
    <div className="acute-dialog__backdrop" onPointerDown={(e) => e.target === e.currentTarget && !busy && onClose()}>
      <div className="acute-dialog acute-ai-settings acute-export-canvas" role="dialog" aria-modal="true" aria-labelledby="acute-export-canvas-title">
        <header className="acute-ai-settings__header">
          <div>
            <h2 id="acute-export-canvas-title" className="acute-ai-settings__title">
              Export canvas
            </h2>
            <p className="acute-ai-settings__subtitle">
              Download {canvasTitle ? <strong>{canvasTitle}</strong> : "this canvas"} with its blocks and pages, as a file.
            </p>
          </div>
          <button type="button" className="acute-ai-settings__close" aria-label="Close" autoFocus onClick={onClose}>
            <CloseIcon size={16} />
          </button>
        </header>

        <div className="acute-ai-settings__body">
          <div className="acute-ai-settings__footer-row acute-ai-settings__mode">
            <div>
              <div className="acute-ai-settings__footer-title">Format</div>
              <p className="acute-ai-settings__footer-hint">
                {format === "json" ? "Everything on the canvas, as an Acute-Notes file." : "The canvas's text in reading order, then a list of its connections."}
              </p>
            </div>
            <div className="acute-ai-mode" role="radiogroup" aria-label="Format">
              {FORMATS.map((f) => (
                <label key={f.id} className={format === f.id ? "active" : ""}>
                  <input type="radio" name="acute-export-format" checked={format === f.id} onChange={() => setFormat(f.id)} />
                  {f.label}
                </label>
              ))}
            </div>
          </div>

          {format === "json" ? (
            <IncludeOptions
              key="json"
              keys={EXPORT_OPTION_KEYS}
              labels={OPTIONS}
              values={options}
              hint="Text, shapes, pages and arrows are always included"
              onChange={(next) => setOptions(next)}
            />
          ) : (
            <IncludeOptions
              key="markdown"
              keys={MARKDOWN_OPTION_KEYS}
              labels={MARKDOWN_OPTIONS}
              values={markdownOptions}
              hint="Blocks, shapes and page titles are always included, as text"
              onChange={(next) => setMarkdownOptions(next)}
            />
          )}

          {error && (
            <p className="acute-ai-connect__error" role="alert">
              {error}
            </p>
          )}

          <div className="acute-ai-connect__actions">
            <button type="button" className="acute-pill acute-pill--ghost" disabled={busy} onClick={onClose}>
              Cancel
            </button>
            <button type="button" className="acute-pill acute-pill--primary" disabled={busy} onClick={exportNow}>
              {busy ? "Exporting…" : "Export"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
