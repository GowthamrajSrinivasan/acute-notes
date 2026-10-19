/**
 * Parts the assignment couldn't place (`UNSURE`: a typed answer below `ASSIGN_MIN_CONFIDENCE`, or the chat task saying so). A failed
 * classification is not a new concept: an unsure part — typically a tiny fragment such as "Free", "Apps" or "1. Data" — is kept with
 * the section around it instead of becoming a topic of its own. In document order, the first of these that applies:
 *
 * 1. **Its parent part** (the section it sits under, when that is part of the new content) went somewhere: it goes there too —
 *    into the same existing topic, or into the parent's new topic.
 * 2. **Its siblings** (same parent) the model placed with confidence in an existing topic: the topic most of them went to.
 * 3. **The local match** (`assignLocally`: the same heading, or most of its words) found an existing topic.
 * 4. **A sibling that became a new topic** (the model placed it there, or an unsure sibling settled before it): it joins that topic, so a run
 *    of fragments under one heading becomes one topic, not one each.
 * 5. **The part before it** (a small top-level fragment only): the part just above it in the document, when that is also top-level and
 *    went somewhere — in a flat document "Pricing", "Free", "Pro" are neighbours, not parent and children.
 * 6. Otherwise it is **unplaced**: its text is kept whole, verbatim, as one standalone plain card at the end of the notes (no model call,
 *    `reconcile/plainCards.ts`), and the review names it. Its topic is undecided, nothing else; it is never filed under a topic on a
 *    guess, never grouped into a catch-all, and a card is how it is shown, not a decision about where it belongs.
 *
 * **The document root is not a topic.** Rules 1, 2 and 4 assume the parent is a topical section whose children share its subject
 * ("Pricing" with "Free" and "Pro"). A document title is not one: on a chat import every answer is a child of the chat's `#` title, and
 * following it files unrelated sections under one catch-all. A top-level heading with a real run of sections under it
 * (`MIN_ROOT_SECTIONS`) is a root: its children have no parent and no siblings for these rules, and it is not a neighbour for rule 5.
 *
 * Pure: parts in document order, the assignment so far, the unsure ones and the local answer in; where each unsure part goes out.
 */
import type { AnalysisUnit } from "@/ai/reconcile/units";
import type { Assignment } from "./assign";

/** `refined` is set by the merge, not here: the part's own subsections were asked about one by one (`refine.ts`). */
export type SettledHow = "parent" | "siblings" | "local" | "grouped" | "adjacent" | "refined" | "unplaced";

export interface Settled {
  /** The assignment with every unsure part settled: a topic key, or null (a new topic or a section of its own — see `attach` and `unplaced`). */
  assignment: Assignment;
  /** Unsure part → the new-topic part it joins (its parent, or the first sibling that became a new topic). */
  attach: Map<string, string>;
  /** How each unsure part was placed. */
  how: Map<string, SettledHow>;
  /** Every part whose text ends up in an unplaced section: the unplaced parts, and the ones that joined them. */
  unplaced: Set<string>;
}

/** A top-level heading with at least this many sections directly under it is a document (a chat title), not a topic. */
export const MIN_ROOT_SECTIONS = 5;
/** A top-level part at most this long is a fragment: it may follow the part before it (rule 5). Mid-sized parts never do. */
export const FRAGMENT_CHARS = 150;

/** The heading path a unit key sits under ("A › B › C" → "A › B"), without a repeated heading's or a split part's number. */
export function parentOf(key: string): string | null {
  const at = key.lastIndexOf(" › ");
  return at < 0 ? null : key.slice(0, at);
}

/** The document roots among `keys`: top-level headings with a real run of sections under them (whether or not the heading is itself a part). */
export function documentRoots(keys: readonly string[]): Set<string> {
  const children = new Map<string, number>();
  for (const k of keys) {
    const parent = parentOf(k);
    if (parent !== null && parentOf(parent) === null) children.set(parent, (children.get(parent) ?? 0) + 1);
  }
  return new Set([...children].filter(([, n]) => n >= MIN_ROOT_SECTIONS).map(([k]) => k));
}

export function settleUnsure(parts: readonly AnalysisUnit[], assignment: Assignment, unsure: ReadonlySet<string>, local: Assignment): Settled {
  const out: Assignment = new Map(assignment);
  const attach = new Map<string, string>();
  const how = new Map<string, SettledHow>();
  const keys = new Set(parts.map((p) => p.key));
  const roots = documentRoots([...keys]);
  /** The new-topic part a part's content ends up in: itself, or the one it joined. */
  const root = (key: string) => attach.get(key) ?? key;
  /** A part that is placed: confidently, or by a rule above (not left unplaced). */
  const placed = (key: string) => (!unsure.has(key) && keys.has(key)) || (how.has(key) && how.get(key) !== "unplaced");
  parts.forEach((p, at) => {
    if (!unsure.has(p.key)) return;
    // A document root is not a topical section: its children have no parent and no siblings to follow.
    const own = parentOf(p.key);
    const parent = own !== null && roots.has(own) ? null : own;
    const siblings = parent ? parts.filter((s) => s.key !== p.key && parentOf(s.key) === parent) : [];
    // 1. With its parent part, wherever that went.
    if (parent && keys.has(parent) && (!unsure.has(parent) || how.has(parent))) {
      const topic = out.get(parent) ?? null;
      if (topic) out.set(p.key, topic);
      else {
        out.set(p.key, null);
        attach.set(p.key, root(parent));
      }
      how.set(p.key, "parent");
      return;
    }
    // 2. Where most of its confidently placed siblings went, among existing topics.
    const confident = siblings.flatMap((s) => (!unsure.has(s.key) && out.get(s.key) ? [out.get(s.key)!] : []));
    if (confident.length) {
      const counts = new Map<string, number>();
      for (const t of confident) counts.set(t, (counts.get(t) ?? 0) + 1);
      out.set(p.key, [...counts].sort((a, b) => b[1] - a[1])[0]![0]);
      how.set(p.key, "siblings");
      return;
    }
    // 3. The local match, when it found an existing topic.
    const matched = local.get(p.key) ?? null;
    if (matched) {
      out.set(p.key, matched);
      how.set(p.key, "local");
      return;
    }
    // 4. Into the new topic a sibling became (placed there, or settled there before it).
    // (Never into an unplaced sibling: an unplaced part is a card of its own, not a topic to join.)
    const sibling = siblings.find((s) => out.get(s.key) === null && (!unsure.has(s.key) || (how.has(s.key) && how.get(s.key) !== "unplaced")));
    if (sibling) {
      out.set(p.key, null);
      attach.set(p.key, root(sibling.key));
      how.set(p.key, "grouped");
      return;
    }
    // 5. A small top-level fragment follows the top-level part just above it, when that went somewhere.
    const before = at > 0 ? parts[at - 1]! : null;
    if (own === null && p.text.length <= FRAGMENT_CHARS && before && parentOf(before.key) === null && !roots.has(before.key) && placed(before.key)) {
      const topic = out.get(before.key) ?? null;
      out.set(p.key, topic);
      if (!topic) attach.set(p.key, root(before.key));
      how.set(p.key, "adjacent");
      return;
    }
    // 6. Unplaced: kept whole as its own section, named in the review.
    out.set(p.key, null);
    how.set(p.key, "unplaced");
  });
  const unplaced = new Set([...how].filter(([, h]) => h === "unplaced").map(([k]) => k));
  for (const [k, to] of attach) if (unplaced.has(root(to))) unplaced.add(k);
  return { assignment: out, attach, how, unplaced };
}
