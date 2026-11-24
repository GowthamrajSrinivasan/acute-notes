/**
 * Content coverage in the Visualize review (content fidelity plan): the row under the review bar that says how much
 * of the source the AI placed on the canvas, which key terms (numbers, paths, identifiers) it left out, and offers
 * to regenerate the sections that fell short. Operator settings, fixed per build — edit here, no rebuild of data.
 *
 * Nothing here changes what is generated: the content safety net always attaches what the AI left out. These only
 * decide what the review shows and whether "Regenerate" is offered.
 */
import type { NoteModel } from "@/ai/fidelity/contracts";
import type { Organisation } from "@/ai/visual-plan/grouping";

/** How the Visualize dialog offers the note model (see `FidelityConfig.noteModelChoice`). */
export type NoteModelChoice = "hidden" | "opt-in" | "default";

export interface FidelityConfig {
  /**
   * Which rules Visualize writes notes under (knowledge-notes-plan §6.3). `preserve` is today's behaviour, and the only
   * mode users can reach until release gate R1. `distil` (ideas in the model's own words, every card citing the source
   * units it represents) is a developer setting until then: no UI offers it, and tests set it on their own input.
   */
  noteModel: NoteModel;
  /**
   * WP2.8 (knowledge-notes-plan §6.3, OD2): the note model choice in the Visualize dialog, passed per run (never by
   * changing `noteModel`). `hidden`: no choice, a run uses `noteModel`. `opt-in` (early access before R1, approved by the
   * user 2026-11-17): "Distil into key ideas (early access)", unticked by default, so a run uses `noteModel` unless
   * the user ticks it. `default` (R1): a run distils, and "Keep full detail" preserves (specs, legal text). At R1 set this to
   * `"default"` and `noteModel` to `"distil"` (for updates and the MCP import, which have no dialog choice).
   */
  noteModelChoice: NoteModelChoice;
  /**
   * The runtime model check of cards' meaning (knowledge-notes-plan §3.4, `semanticCheck.ts`), **distil mode only**:
   * `preserve` never calls it. **On, for every citing card (OD5b, approved by the user 2026-10-20):** the word rules failed
   * on fresh text, the model check met every target on the labelled set, at about $0.00012 a card; one batched call per
   * section, counted in usage. `cards: "flagged"` (OD5 as first approved) checks only the cards the rules hint about.
   * Its verdicts read "checked by AI", never "verified": "supported" lets a card leave Needs review; "partly", "not
   * supported" and no answer keep it there.
   */
  semanticCheck: { enabled: boolean; cards: "flagged" | "all" };
  /** Show the coverage row for AI Visualize results (never for the local tier, which copies the source as is). */
  showCoverage: boolean;
  regenerate: {
    /** Offer "Regenerate" in the coverage row. `false` hides it everywhere. */
    enabled: boolean;
    /**
     * When a section is offered for regeneration: when the AI itself placed less than this share (0–1) of the
     * section's source points — the rest were added from the source by the safety net. `1` offers it for any
     * shortfall; `0.8` only when the AI placed under 80%.
     */
    whenAIPlacedBelow: number;
    /** …or when the AI left out at least this many key terms of the section (`Infinity` ignores key terms). */
    whenKeyTermsMissingAtLeast: number;
  };
  /** How many items the details list per section before "+N more". */
  maxListedPerSection: number;
  /**
   * Wave F2: a note in the coverage row when the connected model's id looks like a lite/flash-lite tier — those
   * models condense more heavily (lower "AI placed" shares in the live runs), so the reader is told why before
   * reaching for Regenerate.
   */
  modelGuidance: {
    enabled: boolean;
    /** Matched against `ChangeSet.metadata.model` (the provider's own model id, e.g. "gemini-3.1-flash-lite"). */
    litePattern: RegExp;
    message: string;
  };
}

export const FIDELITY_CONFIG: FidelityConfig = {
  noteModel: "preserve",
  noteModelChoice: "opt-in",
  semanticCheck: { enabled: true, cards: "all" },
  showCoverage: true,
  regenerate: {
    enabled: true,
    // Offered only on a clear shortfall (Wave A2): the live runs showed a regeneration of a nearly-complete section
    // rarely helps and can make its layout worse.
    whenAIPlacedBelow: 0.6,
    whenKeyTermsMissingAtLeast: 1,
  },
  maxListedPerSection: 5,
  modelGuidance: {
    enabled: true,
    // Word-bounded so "gemini" (contains "mini") or similar coincidental substrings don't false-positive.
    litePattern: /\b(lite|flash-lite|mini|nano)\b/i,
    message: "This model tends to condense; a larger model analyses better.",
  },
};

/**
 * The organisation rules a note model lays out with (organisation-layout plan §3.0, Q10): `distil` → "v2" (frames
 * ordered by their links, sub-groups inside a frame), anything else → "v1", today's layout byte for byte. Tied to the
 * note model, with no setting of its own.
 */
export function organisationFor(noteModel: NoteModel | undefined): Organisation {
  return noteModel === "distil" ? "v2" : "v1";
}
