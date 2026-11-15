"use client";

/**
 * AI settings → Update behaviour (intelligent-update-engine-plan Stage 1e): how "Update from new content" and merges
 * treat locked and edited cards, and whether other cards repeating a changed fact are offered the edit (Stage 3; see
 * `ai/reconcile/updatePolicy.ts`). Applies to updates run from now on.
 */
import { DEFAULT_UPDATE_POLICY, type UpdatePolicy } from "@/ai/reconcile/updatePolicy";
import { setUiPref, useUiPref } from "@/state/uiPrefs";

const OPTIONS: { key: keyof UpdatePolicy; label: string; hint: string }[] = [
  {
    key: "preserveLockedSections",
    label: "Preserve locked sections",
    hint: "Locked cards, and every card in a locked section, are left alone. Off: a lock is only a marker.",
  },
  {
    key: "preserveEditedCards",
    label: "Preserve edited cards",
    hint: "A card changed since AI wrote it always asks Apply or Keep mine. Off: the new facts are merged into your wording, for you to review.",
  },
  {
    key: "suggestElsewhere",
    label: "Suggest updates elsewhere",
    hint: "Other cards that repeat a fact the update changes are offered the same edit, each for you to accept or leave. Off: only the source's own cards are updated.",
  },
];

export function UpdateBehaviourSettings() {
  const policy = useUiPref("aiUpdate");
  return (
    <section className="acute-ai-settings__mode" aria-labelledby="acute-update-settings-title">
      <div className="acute-ai-settings__footer-title" id="acute-update-settings-title">
        Update behaviour
      </div>
      <p className="acute-ai-settings__footer-hint">
        When new content arrives, every card is updated — the ones you edited too, with the new facts merged into your wording — unless it is locked. A change that contradicts a card always asks you first.
      </p>
      {OPTIONS.map((o) => (
        <label key={o.key} className="acute-diagram-switch" title={o.hint}>
          <input type="checkbox" checked={policy[o.key]} onChange={(e) => setUiPref("aiUpdate", { ...policy, [o.key]: e.target.checked })} />
          <span>
            {o.label} <small>({o.hint})</small>
          </span>
        </label>
      ))}
      {(Object.keys(DEFAULT_UPDATE_POLICY) as (keyof UpdatePolicy)[]).some((k) => policy[k] !== DEFAULT_UPDATE_POLICY[k]) && (
        <button type="button" className="acute-ask-ai__link" onClick={() => setUiPref("aiUpdate", DEFAULT_UPDATE_POLICY)}>
          Reset to defaults
        </button>
      )}
    </section>
  );
}
