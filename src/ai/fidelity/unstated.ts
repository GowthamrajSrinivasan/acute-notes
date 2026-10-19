/**
 * Unstated benefits (content fidelity: analysis never adds facts): a model's takeaway or analysis often ends with a
 * generic benefit the content never states — "…, improving user experience", "…, enhancing accuracy". Such a trailing
 * clause is cut when its words aren't the content's own; one the content does state ("…, reducing false rejections"
 * where it says claims were rejected) is kept. Deterministic, applied to a section's untrusted reply.
 */
import { significant, words } from "./information";

/** A sentence's trailing benefit clause: ", improving X" (also "thus/thereby …") or "… and increase X", up to the sentence's end. */
const BENEFIT = /(?:,\s*(?:(?:and\s+)?(?:thus|thereby|which)\s+)?|\s+and\s+)(?:improv|enhanc|increas|boost|ensur|reduc|streamlin|optimi[sz]|strengthen|maximi[sz]|minimi[sz])\w*\s+([^.;!?]+)(?=[.;!?]|$)/gi;

/**
 * A short trailing purpose: "… updated for accuracy and flexibility", "… to be more accurate and flexible". Cut only when
 * none of its words are the content's own ("… for units and wording" stays) and it is a few words at most.
 */
const PURPOSE = /\s+(?:for(?:\s+(?:better|greater|improved|more))?|to\s+be\s+(?:more|better)|to\s+(?:improve|enhance|increase|ensure))\s+((?:[\p{L}\p{N}'/-]+\s*){1,6}?)(?=[.;!?]|$)/giu;
const PURPOSE_MAX_WORDS = 4;

/** Words compared by their first 4 letters, so "rejections" is the content's "rejected" and "units" its "unit". */
const stem = (w: string) => w.slice(0, 4);

function stateable(source: string): (clause: string) => boolean {
  const known = new Set(words(source).map(stem));
  return (clause) => significant(clause).every((w) => known.has(stem(w)));
}

/** `text` without trailing benefit clauses whose words the content doesn't contain. */
export function withoutUnstatedBenefits(text: string, source: string): string {
  const stated = stateable(source);
  const unstated = (object: string) => significant(object).every((w) => !stated(w));
  return text
    .replace(BENEFIT, (clause, object: string) => (stated(object) ? clause : ""))
    .replace(PURPOSE, (clause, object: string) => (significant(object).length <= PURPOSE_MAX_WORDS && unstated(object) ? "" : clause));
}

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** A section's raw reply with unstated benefits cut from its takeaway and its analysis ("origin":"analysis") text. */
export function cutUnstatedBenefits(raw: unknown, source: string): unknown {
  if (!isObject(raw) || !Array.isArray(raw.nodes)) return raw;
  const fix = (s: string) => withoutUnstatedBenefits(s, source);
  const nodes = raw.nodes.map((n) => {
    if (!isObject(n) || n.origin !== "analysis" || !isObject(n.content) || typeof n.content.markdown !== "string") return n;
    return { ...n, content: { ...n.content, markdown: fix(n.content.markdown) } };
  });
  const metadata = isObject(raw.metadata) && typeof raw.metadata.takeaway === "string" ? { ...raw.metadata, takeaway: fix(raw.metadata.takeaway) } : raw.metadata;
  return { ...raw, nodes, ...(metadata !== undefined ? { metadata } : {}) };
}
