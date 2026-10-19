/**
 * Content coverage in the Visualize review (content fidelity plan): the row under the review bar that says how much
 * of the source the AI placed on the canvas, which key terms (numbers, paths, identifiers) it left out, and offers
 * to regenerate the sections that fell short. Operator settings, fixed per build — edit here, no rebuild of data.
 *
 * Nothing here changes what is generated: the content safety net always attaches what the AI left out. These only
 * decide what the review shows and whether "Regenerate" is offered.
 */
export interface FidelityConfig {
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
