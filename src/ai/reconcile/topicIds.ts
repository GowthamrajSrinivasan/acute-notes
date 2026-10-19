/**
 * Topic identity (topic merge plan G1, `.ai/docs/chat-share-import-plan.md`): a section keeps the identity it was
 * first created with when its heading is renamed, so "Update from new content" updates it in place instead of
 * removing its objects and adding them again.
 *
 * Stable keys stay structural (`keys.ts`, `units.ts`): they are built from heading paths. What changes is which
 * path a key is built from. Each content-source version carries `pathIds`: for every heading path whose identity
 * differs from its own text, the path it stands for (its **topic id**). A first run has none, so every existing key
 * is already its own id and nothing needs migrating.
 *
 * - **Renames** are found deterministically, by content, never by position: a section that disappeared and one that
 *   appeared under the same parent are the same section when their bodies (everything below the heading, including
 *   subsections) are identical, or share most of their significant words. Matching is one-to-one, best first, and a
 *   parent's rename carries to its subsections. Repeated headings (the same path twice) are never matched.
 * - **Carried forward**: a renamed section keeps its id through every later version, so a rename followed by an edit
 *   is still an update of the same objects.
 *
 * Pure: parsed content and strings in, a map out.
 */
import type { ParsedContent, ParsedSection } from "@/ai/content/types";
import { significant } from "@/ai/fidelity/information";
import type { VisualNode, VisualPlan } from "@/ai/visual-plan/types";
import { normalizeUnitText } from "./units";

/** Heading path → the topic id (an earlier heading path) it stands for. Only paths whose id differs are listed. */
export type PathIds = Readonly<Record<string, string>>;

const PATH_SEPARATOR = " › ";
/** What may follow a path inside a key: a subsection, a unit ordinal or part, an AI-tier node… */
const BOUNDARIES = [PATH_SEPARATOR, " #", " ·", " § "];
/** …or a local-tier node (`#text0`, `#ascii:tree:…`), told apart from a heading that contains "#" ("C# basics"). */
const LOCAL_NODE = /^#(?:[a-z_]+\d|ascii:tree:)/;
/** Below this many significant words, only an identical body counts as the same section. */
const MIN_WORDS = 3;
/** The share of the larger body's significant words both bodies must share. */
const SAME_SECTION = 0.75;

/** `key` with its longest heading-path prefix listed in `ids` replaced by that path's id; unchanged when none is. */
export function rekey(key: string, ids: PathIds | undefined): string {
  if (!ids) return key;
  let best: string | null = null;
  for (const path of Object.keys(ids)) {
    if (best !== null && path.length <= best.length) continue;
    if (!key.startsWith(path)) continue;
    const rest = key.slice(path.length);
    if (!rest || BOUNDARIES.some((b) => rest.startsWith(b)) || LOCAL_NODE.test(rest)) best = path;
  }
  return best === null ? key : ids[best] + key.slice(best.length);
}

/** A plan with every node's stable key rekeyed (the local tier's plan, built from the new text's own paths). */
export function rekeyPlan(plan: VisualPlan, ids: PathIds | undefined): VisualPlan {
  if (!ids) return plan;
  return { ...plan, nodes: plan.nodes.map((n): VisualNode => (n.stableKey ? { ...n, stableKey: rekey(n.stableKey, ids) } : n)) };
}

/**
 * The `pathIds` of the new version: each heading path of the new text, translated through this update's renames to
 * the previous text's path, then through the previous version's `pathIds` to its id. Undefined when every path is
 * its own id.
 */
export function nextPathIds(previousIds: PathIds | undefined, previous: ParsedContent, previousText: string, next: ParsedContent, nextText: string): PathIds | undefined {
  const renames = headingRenames(previous, previousText, next, nextText);
  const ids: Record<string, string> = {};
  for (const s of headedSections(next, nextText)) {
    const id = rekey(rekey(s.path, renames), previousIds);
    if (id !== s.path) ids[s.path] = id;
  }
  return Object.keys(ids).length ? ids : undefined;
}

interface HeadedSection {
  path: string;
  parent: string;
  depth: number;
  body: string;
}

/**
 * Renamed sections between two texts: new heading path → previous heading path. Only sections whose path is gone
 * from the previous text (after the renames of their parents) are candidates, matched against previous sections that
 * are gone from the new one, under the same parent.
 */
export function headingRenames(previous: ParsedContent, previousText: string, next: ParsedContent, nextText: string): Record<string, string> {
  const before = unique(headedSections(previous, previousText));
  const after = unique(headedSections(next, nextText));
  const beforeByPath = new Map(before.map((s) => [s.path, s] as const));
  const renames: Record<string, string> = {};
  const claimed = new Set<string>();
  const depths = [...new Set(after.map((s) => s.depth))].sort((a, b) => a - b);

  for (const depth of depths) {
    const level = after.filter((s) => s.depth === depth);
    // Still there under its own name (or under its parent's earlier name): not a rename.
    const appeared = level.filter((s) => {
      const was = rekey(s.path, renames);
      if (!beforeByPath.has(was)) return true;
      claimed.add(was);
      return false;
    });
    const pairs: { from: HeadedSection; to: HeadedSection; score: number }[] = [];
    for (const to of appeared) {
      const parent = rekey(to.parent, renames);
      for (const from of before) {
        if (from.depth !== depth || from.parent !== parent || claimed.has(from.path)) continue;
        const score = sameSection(from.body, to.body);
        if (score > 0) pairs.push({ from, to, score });
      }
    }
    pairs.sort((a, b) => b.score - a.score);
    const taken = new Set<string>();
    for (const { from, to } of pairs) {
      if (claimed.has(from.path) || taken.has(to.path)) continue;
      claimed.add(from.path);
      taken.add(to.path);
      renames[to.path] = from.path;
    }
  }
  return renames;
}

/** 1 for identical bodies, the shared share of significant words when it is high enough, else 0. */
function sameSection(a: string, b: string): number {
  const na = normalizeUnitText(a);
  const nb = normalizeUnitText(b);
  if (!na || !nb) return 0;
  if (na === nb) return 1;
  const wa = new Set(significant(na));
  const wb = new Set(significant(nb));
  if (Math.min(wa.size, wb.size) < MIN_WORDS) return 0;
  const shared = [...wa].filter((w) => wb.has(w)).length / Math.max(wa.size, wb.size);
  return shared >= SAME_SECTION ? shared : 0;
}

/** Every section with a heading, at every level, with its body: the text below its heading to the section's end. */
function headedSections(parsed: ParsedContent, input: string): HeadedSection[] {
  const out: HeadedSection[] = [];
  const visit = (s: ParsedSection) => {
    if (s.heading && s.headingIndex !== undefined) {
      const headingEnd = parsed.blocks[s.headingIndex]!.span.end;
      out.push({ path: s.path.join(PATH_SEPARATOR), parent: s.path.slice(0, -1).join(PATH_SEPARATOR), depth: s.path.length, body: input.slice(headingEnd, s.span.end) });
    }
    s.subsections.forEach(visit);
  };
  parsed.sections.forEach(visit);
  return out;
}

/** Sections whose path occurs once: a repeated heading can't be told apart by its path, so it is never matched. */
function unique(sections: HeadedSection[]): HeadedSection[] {
  const count = new Map<string, number>();
  for (const s of sections) count.set(s.path, (count.get(s.path) ?? 0) + 1);
  return sections.filter((s) => count.get(s.path) === 1);
}
