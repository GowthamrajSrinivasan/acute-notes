"use client";

/**
 * AI settings → Clean pasted answers: what Visualize removes from pasted AI answers before it reads them (see
 * `ai/content/cleanup.ts`). Both on by default; the text in the Visualize box is left as pasted.
 */
import { DEFAULT_CLEANUP, type CleanupOptions } from "@/ai/content/cleanup";
import { setUiPref, useUiPref } from "@/state/uiPrefs";

const OPTIONS: { key: keyof CleanupOptions; label: string; hint: string }[] = [
  { key: "timestamps", label: "Video timestamps", hint: "[02:33], [[00:52](youtube link)], (1:02:33)" },
  { key: "citations", label: "Source citation numbers", hint: "[1], [1][2], [^1], [cite: 1], 【1†source】, [1]: link lines" },
];

export function CleanupSettings() {
  const cleanup = useUiPref("aiCleanup");
  return (
    <section className="acute-ai-settings__mode" aria-labelledby="acute-cleanup-settings-title">
      <div className="acute-ai-settings__footer-title" id="acute-cleanup-settings-title">
        Clean pasted answers
      </div>
      <p className="acute-ai-settings__footer-hint">
        Answers from Gemini, Perplexity and similar tools carry timestamps and citation numbers. Visualize removes the ticked ones first, so they don&apos;t end up in your notes.
      </p>
      {OPTIONS.map((o) => (
        <label key={o.key} className="acute-diagram-switch" title={o.hint}>
          <input type="checkbox" checked={cleanup[o.key]} onChange={(e) => setUiPref("aiCleanup", { ...cleanup, [o.key]: e.target.checked })} />
          <span>
            Remove {o.label.toLowerCase()} <small>({o.hint})</small>
          </span>
        </label>
      ))}
      {(Object.keys(DEFAULT_CLEANUP) as (keyof CleanupOptions)[]).some((k) => cleanup[k] !== DEFAULT_CLEANUP[k]) && (
        <button type="button" className="acute-ask-ai__link" onClick={() => setUiPref("aiCleanup", DEFAULT_CLEANUP)}>
          Reset to defaults
        </button>
      )}
    </section>
  );
}
