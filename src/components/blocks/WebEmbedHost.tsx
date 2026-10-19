"use client";

import { memo, useEffect, useRef, useState } from "react";
import { useCanvasBridge } from "@/components/canvas/CanvasBridge";
import { CloseIcon, ExternalLinkIcon, UploadIcon } from "@/components/common/icons";
import { allowsFraming, MAX_IMPORTED_HTML_BYTES, type FramingHeaders } from "@/domain/canvas/webEmbed";

type Framing = "checking" | "allowed" | "blocked" | "unknown";

// One check per URL per session: every embed of the same page shares it.
const framingChecks = new Map<string, Promise<Framing>>();

function checkFraming(url: string): Promise<Framing> {
  let check = framingChecks.get(url);
  if (!check) {
    check = fetch(`/api/embed/check?url=${encodeURIComponent(url)}`)
      .then(async (res) => {
        if (!res.ok) return "unknown" as const;
        const headers = (await res.json()) as FramingHeaders & { finalUrl?: string };
        return allowsFraming(headers, window.location.origin, headers.finalUrl || url) ? "allowed" : "blocked";
      })
      .catch(() => "unknown" as const);
    framingChecks.set(url, check);
  }
  return check;
}

function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

interface WebEmbedHostProps {
  elementId: string;
  url: string;
  /** Imported HTML shown instead of the URL (for sites that refuse to be framed). */
  html?: string;
  htmlName?: string;
  /** Excalidraw's active embeddable: the frame receives pointer input. */
  active: boolean;
  selected: boolean;
  theme: "light" | "dark";
}

/**
 * Canvas host for a web embed. Checks whether the site allows framing; if it
 * doesn't, explains why and offers to import the page's HTML, which then
 * renders in an opaque-origin sandbox (scripts run, but can't reach the app).
 */
export const WebEmbedHost = memo(function WebEmbedHost({
  elementId,
  url,
  html,
  htmlName,
  active,
  selected,
  theme,
}: WebEmbedHostProps) {
  const bridge = useCanvasBridge();
  const [framing, setFraming] = useState<Framing>("checking");
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (html !== undefined) return;
    let cancelled = false;
    setFraming("checking");
    void checkFraming(url).then((f) => !cancelled && setFraming(f));
    return () => {
      cancelled = true;
    };
  }, [url, html]);

  const pickFile = () => fileRef.current?.click();
  const onFile = async (file: File | undefined) => {
    if (!file) return;
    if (file.size > MAX_IMPORTED_HTML_BYTES) {
      setError(`That file is ${(file.size / 1024 / 1024).toFixed(1)} MB; the limit is ${MAX_IMPORTED_HTML_BYTES / 1024 / 1024} MB.`);
      return;
    }
    setError(null);
    bridge.setImportedHtml(elementId, { html: await file.text(), name: file.name });
  };
  const stop = (e: React.SyntheticEvent) => e.stopPropagation();

  const fileInput = (
    <input
      ref={fileRef}
      type="file"
      accept=".html,.htm,text/html"
      hidden
      onChange={(e) => {
        void onFile(e.target.files?.[0]);
        e.target.value = "";
      }}
    />
  );
  const openButton = (
    <a className="acute-web__button" href={url} target="_blank" rel="noopener noreferrer" onPointerDown={stop} title={url}>
      <ExternalLinkIcon size={14} /> Open in new tab
    </a>
  );
  const importButton = (label: string) => (
    <button type="button" className="acute-web__button acute-web__button--primary" onPointerDown={stop} onClick={pickFile}>
      <UploadIcon size={14} /> {label}
    </button>
  );

  const showFrame = html !== undefined || framing === "allowed" || framing === "unknown";

  return (
    <div className="acute-block acute-web" data-element-id={elementId} data-theme={theme} data-active={active || undefined}>
      {fileInput}
      {showFrame && (
        <iframe
          className="acute-web__frame"
          title={html !== undefined ? htmlName || "Imported HTML" : url}
          // Imported HTML gets an opaque origin (no allow-same-origin): it can't touch Acute's storage or DOM.
          {...(html !== undefined
            ? { srcDoc: html, sandbox: "allow-scripts allow-forms allow-popups allow-modals allow-downloads" }
            : {
                src: url,
                sandbox: "allow-scripts allow-same-origin allow-forms allow-popups allow-popups-to-escape-sandbox allow-downloads",
              })}
          referrerPolicy="no-referrer"
          allow="clipboard-write; fullscreen"
          loading="lazy"
        />
      )}
      {framing === "checking" && html === undefined && <div className="acute-web__status">Loading {hostOf(url)}…</div>}
      {framing === "blocked" && html === undefined && (
        <div className="acute-web__blocked">
          <strong>{hostOf(url)} doesn&apos;t allow embedding</strong>
          <p>
            The site blocks being shown inside other apps. Download the page as an HTML file (for a Claude artifact:
            the artifact&apos;s <em>Download</em> menu) and import it here to view it on the canvas.
          </p>
          <div className="acute-web__actions">
            {importButton("Import HTML file…")}
            {openButton}
          </div>
          {error && <p className="acute-web__error">{error}</p>}
        </div>
      )}
      {selected && !active && (html !== undefined || framing !== "blocked") && (
        <div className="acute-web__toolbar" onPointerDown={stop}>
          {html !== undefined ? (
            <>
              <span className="acute-web__name" title={htmlName}>
                {htmlName}
              </span>
              {importButton("Replace")}
              <button
                type="button"
                className="acute-web__button"
                title="Show the web page instead"
                onClick={() => bridge.setImportedHtml(elementId, null)}
              >
                <CloseIcon size={14} /> Use URL
              </button>
            </>
          ) : (
            <>
              <span className="acute-web__name">Page not loading?</span>
              {importButton("Import HTML")}
              {openButton}
            </>
          )}
          {error && <span className="acute-web__error">{error}</span>}
        </div>
      )}
    </div>
  );
});
