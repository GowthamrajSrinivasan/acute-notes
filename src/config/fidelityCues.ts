/**
 * Cue words for the Knowledge Notes checkers (`.ai/docs/knowledge-notes-plan.md` §3.2–§3.4): which units are
 * critical (§3.2), the words the meaning rules look for (§3.4), the unit-spelling table used when comparing protected
 * details (§3.3), and the omitted-share threshold (OD4). Operator settings, fixed per build; tuned against the labelled
 * paraphrase set (§7.2, `src/ai/fidelity/__fixtures__/meaning/pairs.json`).
 *
 * English only (§13: a stated limitation for v1). The plan places these lists in `FIDELITY_CONFIG`; they live here,
 * beside it, so the parallel lanes don't edit the same file (`.ai/docs/knowledge-notes-lanes.md`). The integrator may
 * fold them in.
 *
 * **Cue syntax:** a cue is one or more words matched case-insensitively at word boundaries, with any run of spaces
 * between its words. `*` stands for any letters, so `reduc*` matches "reduce", "reduces", "reduced", "reduction".
 */

/** What a quantity measures (`src/ai/fidelity/quantities.ts`); quantities of different dimensions never compare equal. */
export type QuantityDimension = "count" | "time" | "size" | "bits" | "percent" | "ratio" | "percentile";

export interface FidelityCues {
  /** §3.2: a unit containing any of these is critical, for that reason. */
  critical: {
    limitation: readonly string[];
    requirement: readonly string[];
    condition: readonly string[];
    /**
     * A decision, or the group's assent to one ("Agreed:", "No objection from me", "I'm fine with that"): a meeting's
     * decisions may not be left out as filler (the golden case kn-05 of 2026-10-19 lost three assent lines that way).
     */
    decision: readonly string[];
    /**
     * Greetings, sign-offs and meta lines ("let me know if…", "hope this helps", "as discussed"): removed from a unit's
     * text before the cues above are looked for, so the "if" of "let me know if you want a sample" doesn't make a
     * sign-off critical. What is left still counts ("As discussed, the limit must be 500" is a requirement).
     */
    filler: readonly string[];
  };
  /**
   * §3.2 in transcripts (lines "Name: …"; the golden case kn-05 of 2026-10-20 lost questions and bare assent as filler):
   * turn-level signals, read by `accounting.ts` `dialogueReasonsOf` with the turns' order, never by a cue word alone.
   * A question nobody answers is an open question; a short assent right after a proposal is a decision (and so is the
   * proposal it accepts).
   */
  dialogue: {
    /** "Agreed: …", "Action: …": labels that are not speakers, whatever their place in the text. */
    notSpeakers: readonly string[];
    /** The start of a reply that doesn't answer the question before it ("I don't know", "not sure"). */
    nonAnswer: readonly string[];
    /** A short turn that accepts what was proposed ("Same.", "I'd like that, yes.", "No objection from me."). */
    assent: readonly string[];
    /** A turn that proposes a course of action ("Should support be allowed …?", "So the proposal is …", "I'd propose …"). */
    proposal: readonly string[];
    /** An assent turn's first sentence has at most this many words (a longer one is an argument, not bare assent). */
    maxAssentWords: number;
  };
  /** §3.4: the words each meaning rule looks for. */
  meaning: {
    /** Hedges: the claim is possible or usual, not certain. A card keeps the hedge when it has any of these. */
    hedges: readonly string[];
    /** Words a card may use to keep a hedge besides `hedges` ("not always", "depends"). */
    hedgeEquivalents: readonly string[];
    /** Limits on an amount: a card keeps the limit when it has any of these (or a range). */
    limits: readonly string[];
    /** A contrast that introduces a cost or caveat on the same claim ("faster, but uses more memory"). */
    caveats: readonly string[];
    /** Conditions on a claim, in a source unit. */
    conditions: readonly string[];
    /** Words that carry a condition on a card (a superset of `conditions`: a paraphrase may say "with" or "once"). */
    cardConditions: readonly string[];
    /** Restrictions of scope ("only for read-only workloads", "except on Windows"). Treated as a condition. */
    scopes: readonly string[];
    /** A card condition that widens the source's ("whenever", "always"). */
    widening: readonly string[];
    /** "A <marker> B": A is the cause. */
    causeFirst: readonly string[];
    /** "B <marker> A": A is the cause. */
    causeSecond: readonly string[];
    /** Opposite directions: a card with one side where the source has only the other changes the effect. */
    directions: readonly (readonly [readonly string[], readonly string[]])[];
    /** Absolutes, each with the source words that already support it. */
    absolutes: readonly { words: readonly string[]; supportedBy: readonly string[] }[];
    /**
     * Verbs that already state an effect ("caching **reduces** load"): a card may restate them with a causal marker
     * ("caching leads to lower load") without adding a cause the source lacks.
     */
    causalVerbs: readonly string[];
    /** Negations. */
    negators: readonly string[];
    /** Phrases that contain a negator but are limits or emphasis, not negations ("no more than", "not only"). */
    notNegations: readonly string[];
    /**
     * Negators that exclude ("without", "unless", "other than"): with one more negation in the same clause they make a
     * double negation ("never deletes data without a confirmation"), which a card may state plainly ("deletes data only
     * after a confirmation").
     */
    exclusions: readonly string[];
    /**
     * Words a card may use to express a source's negation without a negator ("no longer supports" → "support has been
     * dropped"; "does not reload" → "stays loaded"). Card side only: they keep a negation, never create one.
     */
    negationEquivalents: readonly string[];
    /** "cannot … more than N" is a cap: a card keeps it with an upper limit ("at most N"). After a negator, in the source. */
    beyond: readonly string[];
    /** Upper limits a card may use for "cannot … more than N". */
    upperLimits: readonly string[];
    /** "must not … fewer than N" is a floor: a card keeps it with a lower limit ("at least N"). */
    short: readonly string[];
    /** Lower limits a card may use for "must not … fewer than N" (and the lower bounds of rubric rule 8). */
    lowerLimits: readonly string[];
    /** Rubric rule 8: a requirement for N means at least N. Words that make a card's amount a requirement. */
    requirements: readonly string[];
    /** Words that make a card's amount exact, so a requirement no longer reads as "at least". */
    exactCounts: readonly string[];
    /** A restriction to what follows or precedes ("Wi-Fi only", "only on Wi-Fi"). */
    restrictives: readonly string[];
    /** Card words that keep a restriction ("only", "exclusively", "limited to", a negation or exception). */
    restrictionKept: readonly string[];
    /**
     * Trade-off dimensions: in each, words that make a cost worse and words that make it better. A source's cost (the
     * caveat of a trade-off) is inverted when the card says the better side about the same thing and never the worse.
     */
    costDimensions: readonly { name: string; worse: readonly string[]; better: readonly string[] }[];
    /** Words that name the same cost ("money" = "cost"), compared as the group's first word. */
    costSynonyms: readonly (readonly string[])[];
  };
  /**
   * §3.3: units after a number, each with its dimension and its size in the dimension's base unit (`quantities.ts`):
   * time in ms, size in bytes, bits, percent, ratio (×). "0.25 seconds" = "250 ms"; units of different dimensions
   * never compare equal. Sizes are **decimal unless written binary**: KB = 1,000 bytes, KiB = 1,024 (and MB/MiB,
   * GB/GiB, TB/TiB likewise); "kb"/"Kb" are read as kilobytes. Bits are their own dimension, never converted to bytes.
   * Variants match case-insensitively, except `exactCase` ones ("B" is bytes, "b" is not; "3D" is not 3 days).
   */
  unitSpellings: readonly { canonical: string; dimension: QuantityDimension; factor: number; variants: readonly string[]; exactCase?: readonly string[] }[];
  /**
   * Numbers written as words, read as digits (`quantities.ts`): "three retries" = "3 retries", "two thousand" = 2000,
   * "twenty-five", "a dozen" = 12. "one" counts only inside a compound ("one hundred", "twenty-one"): alone it is
   * usually a pronoun. `multipliers` are ratios ("twice" = 2×; "double"/"triple" only before "the", "its"…), and any
   * of these + "fold" is one too ("fourfold" = 4×).
   */
  numberWords: {
    units: Readonly<Record<string, number>>;
    tens: Readonly<Record<string, number>>;
    scales: Readonly<Record<string, number>>;
    multipliers: Readonly<Record<string, number>>;
  };
  /** OD4: a section with at least this share (0–1) of its units omitted gets a note. A secondary signal only. */
  highOmittedShare: number;
  /** §3.4: a card's condition must share at least this share of the source condition's significant words. */
  conditionOverlap: number;
  /** A caveat (or scope) counts as kept when the card carries at least this share of its significant words. */
  caveatOverlap: number;
  /** Quoted spans shorter than this many words are names or scare quotes, not direct quotes (§3.3). */
  minQuoteWords: number;
}

export const FIDELITY_CUES: FidelityCues = {
  critical: {
    limitation: [
      "however",
      "but",
      "although",
      "though",
      "limitation*",
      "caveat*",
      "risk*",
      "warning*",
      "note that",
      "beware",
      "does not",
      "doesn't",
      "do not",
      "don't",
      "cannot",
      "can't",
      "not suitable",
      "unsupported",
      "except",
    ],
    requirement: ["must", "must not", "mustn't", "never", "do not", "don't", "required", "requires", "only", "at least", "at most", "shall", "mandatory", "prohibited"],
    condition: ["if", "when", "unless", "only when", "provided that", "as long as", "only if"],
    decision: ["agreed", "we agree", "decided", "decision", "we will go with", "approved", "no objection*", "any objection*", "anyone against", "fine with that", "fine with it", "sign off on", "signed off"],
    filler: [
      "let me know if",
      "let me know when",
      "let me know whether",
      "let me know",
      "hope this helps",
      "hope that helps",
      "hope it helps",
      "if this helps",
      "if that helps",
      "if you have any questions",
      "if you have questions",
      "if you need anything else",
      "if you need anything",
      "if you want, I can",
      "if you like, I can",
      "if you'd like, I can",
      "feel free to",
      "happy to help",
      "glad to help",
      "as discussed",
      "as mentioned",
      "as promised",
      "great question",
      "good question",
      "thanks",
      "thank you",
      "cheers",
      "best regards",
      "kind regards",
      "see you",
      "talk soon",
    ],
  },
  dialogue: {
    notSpeakers: ["agreed", "decision", "decisions", "action", "actions", "action item", "action items", "note", "notes", "attendees", "agenda", "summary", "update", "todo", "q", "a", "re", "subject", "date", "time", "owner", "status", "next steps", "outcome", "result", "example", "warning", "important", "tip"],
    nonAnswer: ["I don't know", "I do not know", "don't know", "not sure", "I'm not sure", "no idea", "nobody knows", "no one knows", "we don't know", "unclear", "can't say", "cannot say", "hard to say", "no one has looked", "nobody has looked", "haven't checked", "have not checked"],
    assent: [
      "yes",
      "yeah",
      "yep",
      "sure",
      "same",
      "same here",
      "me too",
      "agreed",
      "agree",
      "I agree",
      "sounds good",
      "works for me",
      "fine by me",
      "fine with me",
      "I'm fine with that",
      "fine with that",
      "no objection*",
      "I'd like that",
      "I would like that",
      "makes sense",
      "of course",
      "absolutely",
      "definitely",
      "+1",
      "let's do it",
      "let's do that",
      "go for it",
    ],
    proposal: ["should", "shall we", "let's", "let us", "propose", "proposal", "suggest*", "how about", "what if we", "why don't we", "we could", "I'd like us to", "I would like us to", "do we want to", "can we", "could we"],
    maxAssentWords: 8,
  },
  meaning: {
    hedges: [
      "can",
      "could",
      "may",
      "might",
      "often",
      "typically",
      "usually",
      "generally",
      "sometimes",
      "occasionally",
      "frequently",
      "likely",
      "unlikely",
      "probably",
      "possibly",
      "potentially",
      "tends to",
      "tend to",
      "in some cases",
      "in many cases",
      "in most cases",
      "some",
      "many",
      "most",
      "several",
      "a few",
      "rarely",
      "seldom",
      "mostly",
      "largely",
      "partly",
      "partially",
      "somewhat",
      "able to",
      "possible",
      "chance",
    ],
    hedgeEquivalents: ["not always", "not guaranteed", "not necessarily", "occasional*", "depend*", "possib*", "potential*", "option*", "sometimes", "at times", "in places", "where possible", "help*", "in general", "as a rule", "for the most part", "tends", "commonly", "normally", "in practice", "available", "capable", "able to"],
    limits: [
      "at most",
      "at least",
      "up to",
      "no more than",
      "no fewer than",
      "no less than",
      "not more than",
      "or fewer",
      "or less",
      "or more",
      "maximum",
      "minimum",
      "max",
      "min",
      "cap*",
      "limit*",
      "ceiling",
      "floor",
      "approximately",
      "about",
      "around",
      "roughly",
      "nearly",
      "almost",
      "under",
      "over",
      "below",
      "above",
      "within",
      "less than",
      "more than",
      "fewer than",
      "between",
      "upper bound",
      "lower bound",
      "~",
      "≤",
      "≥",
      "<",
      ">",
    ],
    caveats: [
      "but",
      "however",
      "although",
      "though",
      "while",
      "whereas",
      "at the cost of",
      "at the expense of",
      "in exchange for",
      "in return for",
      "except",
      "apart from",
      "other than",
      "trade-off",
      "tradeoff",
    ],
    conditions: ["if", "when", "unless", "only when", "only if", "provided that", "provided", "as long as", "assuming", "in case", "once", "whenever", "given that"],
    cardConditions: [
      "if",
      "when",
      "whenever",
      "unless",
      "only when",
      "only if",
      "provided",
      "as long as",
      "assuming",
      "in case",
      "once",
      "given",
      "with",
      "without",
      "after",
      "during",
      "upon",
      "on",
      "while",
      "where",
      "requires",
      "needs",
      "depends on",
      "only",
    ],
    scopes: ["only for", "only in", "only on", "only within", "only to", "limited to", "restricted to", "specific to", "applies to", "applies only to", "except", "excluding", "other than", "apart from"],
    widening: ["whenever", "always", "in any case", "in all cases", "regardless", "any time", "every time", "at all times", "without exception"],
    causeFirst: ["cause*", "lead to", "leads to", "led to", "leading to", "result in", "results in", "resulted in", "trigger*", "drive*", "drove", "produce*", "so", "therefore", "thus", "hence", "as a result", "consequently", "which means"],
    causeSecond: [
      "because",
      "since",
      "due to",
      "because of",
      "owing to",
      "caused by",
      "results from",
      "result from",
      "resulted from",
      "stems from",
      "stem from",
      "driven by",
      "triggered by",
      "produced by",
      "as a result of",
      "thanks to",
      "comes from",
      "come from",
      "depends on",
      "depend on",
      "relies on",
      "rely on",
    ],
    directions: [
      [
        ["reduc*", "lower*", "decreas*", "cut*", "shrink*", "less", "fewer", "smaller", "drop*", "fall*", "fell", "lighter", "cheaper", "shorter", "faster", "minimi*", "save*"],
        ["increas*", "rais*", "grow*", "more", "larger", "bigger", "higher", "heavier", "rise*", "rising", "costlier", "longer", "slower", "maximi*", "add*", "doubl*", "tripl*"],
      ],
      [
        ["improv*", "better", "speed* up", "sped up", "faster", "help*", "strengthen*", "boost*", "simplif*", "simpler", "easier"],
        ["worsen*", "worse", "degrad*", "slow* down", "slower", "hurt*", "weaken*", "harm*", "complicat*", "harder"],
      ],
      [
        ["prevent*", "block*", "stop*", "avoid*", "protect*"],
        ["allow*", "enabl*", "permit*", "cause*", "introduc*"],
      ],
    ],
    absolutes: [
      { words: ["always", "every time", "invariably", "in all cases", "without exception", "at all times"], supportedBy: ["always", "every time", "whenever", "invariably", "in all cases", "each time", "every", "all"] },
      { words: ["never", "at no time"], supportedBy: ["never", "not", "no", "*n't", "cannot", "without", "none", "nothing"] },
      { words: ["all", "every", "everything", "everyone"], supportedBy: ["all", "every", "each", "entire", "entirely", "whole", "everything", "everyone", "any", "both", "always"] },
      { words: ["none", "nothing", "no one", "nobody"], supportedBy: ["none", "nothing", "no one", "nobody", "no", "not", "*n't", "zero", "never"] },
      { words: ["guarantee*", "certain*", "definitely", "assured", "ensures"], supportedBy: ["guarantee*", "certain*", "definitely", "assured", "ensure*", "always"] },
      { words: ["completely", "fully", "totally", "100%"], supportedBy: ["complete*", "full*", "total*", "100", "all", "entire*"] },
    ],
    causalVerbs: [
      "reduc*",
      "lower*",
      "decreas*",
      "cut*",
      "shrink*",
      "increas*",
      "rais*",
      "add*",
      "improv*",
      "worsen*",
      "degrad*",
      "boost*",
      "prevent*",
      "block*",
      "enabl*",
      "allow*",
      "speed* up",
      "sped up",
      "slow* down",
      "minimi*",
      "maximi*",
      "doubl*",
      "tripl*",
      "protect*",
      "avoid*",
      "help*",
      "hurt*",
      "break*",
      "broke",
      "fix*",
      "save*",
      "delay*",
    ],
    negators: ["not", "no", "never", "without", "*n't", "cannot", "none", "nothing", "neither", "nor", "fails to", "unable to", "no longer", "nobody", "no one", "lacks", "lack of", "absent", "disabled", "skip*", "off", "prevent*", "exclud*", "omit*", "leave out", "leaves out", "left out"],
    notNegations: ["no more than", "no fewer than", "no less than", "not more than", "not less than", "not only", "not just", "no later than", "no sooner than", "no matter"],
    exclusions: ["without", "unless", "except", "other than", "apart from", "excluding"],
    negationEquivalents: [
      "dropped",
      "removed",
      "discontinued",
      "retired",
      "withdrawn",
      "abandoned",
      "phased out",
      "stopped",
      "ceased",
      "stay*",
      "remain*",
      "unchanged",
      "intact",
      "the same",
      "free of",
      "instead of",
      "rather than",
      "kept out",
      "kept from",
      "refus*",
      "reject*",
      "forbid*",
      "prohibit*",
      "blocked",
      "denied",
    ],
    beyond: ["more than", "over", "above", "beyond", "exceed*", "greater than", "longer than", "larger than"],
    upperLimits: ["at most", "up to", "no more than", "not more than", "maximum", "max", "cap*", "limit*", "ceiling", "or fewer", "or less", "within", "≤"],
    short: ["fewer than", "less than", "below", "under", "shorter than", "smaller than"],
    lowerLimits: ["at least", "no fewer than", "no less than", "not less than", "minimum", "min", "or more", "floor", "≥"],
    requirements: ["require*", "need*", "must", "mandatory", "necessary", "has to", "have to"],
    exactCounts: ["exactly", "precisely", "only", "just", "no more", "at most", "up to"],
    restrictives: ["only", "solely", "exclusively"],
    restrictionKept: ["only", "solely", "exclusively", "just", "limited to", "restricted to", "reserved for", "specific to", "nothing but", "never", "not", "no", "*n't", "cannot", "without", "except", "unless", "other than", "apart from", "excluding"],
    costDimensions: [
      {
        name: "speed",
        worse: ["slow*", "later", "delay*", "lag*", "takes longer", "take longer", "wait*"],
        better: ["fast*", "quick*", "sooner", "earlier", "instant*", "immediate*", "current", "up to date", "up-to-date", "real time", "real-time", "on time", "speed* up", "sped up"],
      },
      {
        name: "amount",
        worse: ["more", "extra", "additional", "higher", "larger", "bigger", "heavier", "increas*", "rais*", "add", "adds", "added", "adding", "grow*", "doubl*", "tripl*", "costlier", "pricier", "expensive"],
        better: ["less", "fewer", "lower", "smaller", "lighter", "reduc*", "cut", "cuts", "cutting", "sav*", "shrink*", "decreas*", "cheaper", "cheap", "no extra"],
      },
      {
        name: "effort",
        worse: ["harder", "difficult*", "complicat*", "complex*", "tedious", "painful"],
        better: ["easier", "easy", "simpler", "simple", "simplif*", "effortless*", "trivial"],
      },
      {
        name: "risk",
        worse: ["riskier", "risk*", "unsafe", "insecure", "vulnerab*", "expos*", "widen*"],
        better: ["safer", "safe", "secure*", "protect*"],
      },
    ],
    costSynonyms: [
      ["cost", "money", "price", "spend", "spending", "bill", "expense", "expenses"],
      ["latency", "delay", "lag", "wait"],
      ["space", "storage", "disk"],
    ],
  },
  unitSpellings: [
    { canonical: "µs", dimension: "time", factor: 0.001, variants: ["microseconds", "microsecond", "µs", "μs"] },
    { canonical: "ms", dimension: "time", factor: 1, variants: ["milliseconds", "millisecond", "msecs", "msec", "ms"] },
    { canonical: "s", dimension: "time", factor: 1_000, variants: ["seconds", "second", "secs", "sec"], exactCase: ["s"] },
    { canonical: "min", dimension: "time", factor: 60_000, variants: ["minutes", "minute", "mins", "min"] },
    { canonical: "h", dimension: "time", factor: 3_600_000, variants: ["hours", "hour", "hrs", "hr"], exactCase: ["h"] },
    { canonical: "d", dimension: "time", factor: 86_400_000, variants: ["days", "day"], exactCase: ["d"] },
    { canonical: "wk", dimension: "time", factor: 604_800_000, variants: ["weeks", "week", "wks", "wk"] },
    { canonical: "%", dimension: "percent", factor: 1, variants: ["percent", "per cent", "pct", "%"] },
    { canonical: "B", dimension: "size", factor: 1, variants: ["bytes", "byte"], exactCase: ["B"] },
    { canonical: "KB", dimension: "size", factor: 1e3, variants: ["kilobytes", "kilobyte", "kb"] },
    { canonical: "MB", dimension: "size", factor: 1e6, variants: ["megabytes", "megabyte", "mb"] },
    { canonical: "GB", dimension: "size", factor: 1e9, variants: ["gigabytes", "gigabyte", "gb"] },
    { canonical: "TB", dimension: "size", factor: 1e12, variants: ["terabytes", "terabyte", "tb"] },
    { canonical: "KiB", dimension: "size", factor: 1024, variants: ["kibibytes", "kibibyte", "kib"] },
    { canonical: "MiB", dimension: "size", factor: 1024 ** 2, variants: ["mebibytes", "mebibyte", "mib"] },
    { canonical: "GiB", dimension: "size", factor: 1024 ** 3, variants: ["gibibytes", "gibibyte", "gib"] },
    { canonical: "TiB", dimension: "size", factor: 1024 ** 4, variants: ["tebibytes", "tebibyte", "tib"] },
    { canonical: "bit", dimension: "bits", factor: 1, variants: ["bits", "bit"] },
    { canonical: "x", dimension: "ratio", factor: 1, variants: ["times", "x", "×"] },
  ],
  numberWords: {
    units: { zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9 },
    tens: {
      ten: 10,
      eleven: 11,
      twelve: 12,
      thirteen: 13,
      fourteen: 14,
      fifteen: 15,
      sixteen: 16,
      seventeen: 17,
      eighteen: 18,
      nineteen: 19,
      twenty: 20,
      thirty: 30,
      forty: 40,
      fifty: 50,
      sixty: 60,
      seventy: 70,
      eighty: 80,
      ninety: 90,
    },
    scales: { hundred: 100, thousand: 1e3, million: 1e6, billion: 1e9 },
    multipliers: { twice: 2, double: 2, triple: 3 },
  },
  highOmittedShare: 0.3,
  conditionOverlap: 0.5,
  caveatOverlap: 0.3,
  minQuoteWords: 3,
};

const LETTERS = "[\\p{L}\\p{N}]";

/** A regular expression for one cue (see the cue syntax above). Global and Unicode; reuse with care (`lastIndex`). */
export function cueRegex(cue: string): RegExp {
  const parts = cue
    .trim()
    .split(/\s+/)
    .map((w) => w.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, "[\\p{L}]*"));
  const body = parts.join("\\s+");
  // Symbols ("~", "≤", "%") have no word boundary of their own.
  const wordy = /[\p{L}\p{N}]/u.test(cue);
  // Not inside a word, nor one part of a hyphenated compound ("off" is not in "trade-off").
  return new RegExp(wordy ? `(?<!${LETTERS}|${LETTERS}-)${body}(?!${LETTERS}|-${LETTERS})` : body, "giu");
}

const CACHE = new Map<string, RegExp>();

/** Every match of any cue in `text`: where it starts and ends, and which cue it was. Sorted by position. */
export function findCues(text: string, cues: readonly string[]): { cue: string; start: number; end: number }[] {
  const out: { cue: string; start: number; end: number }[] = [];
  for (const cue of cues) {
    let re = CACHE.get(cue);
    if (!re) CACHE.set(cue, (re = cueRegex(cue)));
    re.lastIndex = 0;
    for (let m = re.exec(text); m; m = re.exec(text)) {
      out.push({ cue, start: m.index, end: m.index + m[0].length });
      if (m[0].length === 0) re.lastIndex++;
    }
  }
  return out.sort((a, b) => a.start - b.start || b.end - a.end);
}

/** Whether `text` contains any of the cues. */
export function hasCue(text: string, cues: readonly string[]): boolean {
  return findCues(text, cues).length > 0;
}

/**
 * `text` with its greetings, sign-offs and meta phrases (`FIDELITY_CUES.critical.filler`) blanked out, longest match
 * first, so the critical cues are looked for only in what the unit says about its subject.
 */
export function withoutFiller(text: string, filler: readonly string[] = FIDELITY_CUES.critical.filler): string {
  const kept: { start: number; end: number }[] = [];
  for (const m of findCues(text, filler)) if (!kept.some((k) => m.start < k.end && k.start < m.end)) kept.push(m);
  if (!kept.length) return text;
  let out = "";
  let at = 0;
  for (const k of kept.sort((a, b) => a.start - b.start)) {
    out += `${text.slice(at, k.start)} `;
    at = k.end;
  }
  return out + text.slice(at);
}
