"use client";

import { memo, useState } from "react";
import { InactiveView } from "@/components/blocks/InactiveView";
import { useCanvasBridge } from "@/components/canvas/CanvasBridge";
import { EyeIcon, EyeOffIcon, PageIcon, PanelRightIcon, PencilIcon } from "@/components/common/icons";
import { RenameInput } from "@/components/common/RenameInput";
import { pageExcerpt, UNTITLED_PAGE } from "@/domain/content/richContent";
import { formatEdited } from "@/domain/pages/formatEdited";
import { renamePage } from "@/domain/pages/pageCommands";
import { useDocumentRecord } from "@/state/documents";
import { pagePanel } from "@/state/pagePanel";
import { useUiPref } from "@/state/uiPrefs";

interface PagePreviewHostProps {
  elementId: string;
  pageId: string;
  /** Page content on the canvas (true) or a compact card (false). */
  preview: boolean;
  theme: "light" | "dark";
  /** The element's background colour (the DOM layer covers the canvas-drawn fill). */
  background: string;
  /** Shows the element's actions (they are the only interactive part while inactive). */
  selected: boolean;
  /** Static render (image export): no actions. */
  exporting?: boolean;
}

/**
 * Canvas host for a page preview (F09). Never mounts an editor: the page is
 * edited in the side panel, and this re-renders only when the page's record
 * (title / snapshot) or its own primitive props change.
 */
export const PagePreviewHost = memo(function PagePreviewHost({
  elementId,
  pageId,
  preview,
  theme,
  background,
  selected,
  exporting = false,
}: PagePreviewHostProps) {
  const record = useDocumentRecord(pageId);
  const display = useUiPref("blockDisplay");
  const bridge = useCanvasBridge();
  const title = record?.title.trim() || UNTITLED_PAGE;
  // Renaming goes through the page record, so the navigator and page panel update too.
  const [renaming, setRenaming] = useState(false);
  const renameInput = (
    <RenameInput
      value={record?.title ?? ""}
      label="Page title"
      className="acute-page__rename"
      onDone={(value) => {
        setRenaming(false);
        if (value !== null) renamePage(pageId, value);
      }}
    />
  );

  return (
    <div
      className="acute-block acute-page"
      data-element-id={elementId}
      data-mode={preview ? "preview" : "card"}
      data-theme={theme}
      data-missing={record === null || undefined}
      style={{ "--acute-block-bg": background } as React.CSSProperties}
    >
      <div className="acute-block__bg" aria-hidden="true" />
      {selected && !exporting && record && !renaming && (
        <div className="acute-page__actions">
          <button
            type="button"
            title="Rename page"
            aria-label="Rename page"
            onPointerDown={(e) => e.stopPropagation()}
            onClick={() => setRenaming(true)}
          >
            <PencilIcon size={15} />
          </button>
          <button
            type="button"
            title={preview ? "Show as card" : "Show page content on the canvas"}
            aria-label={preview ? "Show as card" : "Show preview"}
            aria-pressed={preview}
            onPointerDown={(e) => e.stopPropagation()}
            onClick={() => bridge.togglePagePreview(elementId)}
          >
            {preview ? <EyeOffIcon size={15} /> : <EyeIcon size={15} />}
          </button>
          <button
            type="button"
            title="Open page — Enter"
            aria-label="Open page"
            onPointerDown={(e) => e.stopPropagation()}
            onClick={() => pagePanel.open(pageId, { elementId })}
          >
            <PanelRightIcon size={15} />
          </button>
        </div>
      )}
      {record === null ? (
        <div className="acute-page__missing">
          <PageIcon size={18} />
          <span>This page was deleted</span>
        </div>
      ) : preview ? (
        <div className="acute-page__doc">
          {renaming ? (
            <div className="acute-page__doc-title">{renameInput}</div>
          ) : (
            <div className="acute-page__doc-title" data-untitled={!record?.title.trim() || undefined}>
              {title}
            </div>
          )}
          <InactiveView content={record?.snapshot} placeholder="Empty page" display={display} theme={theme} />
          <div className="acute-page__fade" aria-hidden="true" />
        </div>
      ) : (
        <div className="acute-page__card">
          <div className="acute-page__head">
            <span className="acute-page__icon">
              <PageIcon size={16} />
            </span>
            {renaming ? (
              renameInput
            ) : (
              <span className="acute-page__title" data-untitled={!record?.title.trim() || undefined}>
                {title}
              </span>
            )}
          </div>
          <p className="acute-page__excerpt">{(record && pageExcerpt(record.snapshot)) || "Empty page"}</p>
          <div className="acute-page__meta">
            {record ? formatEdited(record.updatedAt) : ""}
            <span className="acute-page__open">Open ↗</span>
          </div>
        </div>
      )}
    </div>
  );
});
