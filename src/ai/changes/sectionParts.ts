/**
 * A change set too big to review in one piece, split into one part per section (`ChangeSet.parts`, F43).
 *
 * A single producer's set is capped at `MAX_CHANGES` (500); a set with parts may hold up to `MAX_MERGED_CHANGES`, each
 * part still within 500. Visualize, update and merge of a long document (an AI chat pasted whole) can create more than
 * 500 objects, so before review such a set is divided by its top-level frames: a section's frame, everything inside it
 * and the links among them are one part, which stays reviewable and acceptable on its own. Nothing is dropped or
 * truncated: if a section is itself over the limit, or the whole is over the merged limit, this throws a
 * `ChangeSetTooLargeError` that says so, and the caller shows it (nothing is proposed).
 *
 * A set within the limit is returned untouched, so every existing single-set behaviour is unchanged.
 */
import { MAX_CHANGES, MAX_MERGED_CHANGES, type ChangeSet, type ChangeSetPart, type ChangeTarget, type ConflictItem, type ProposedChange } from "./changeSet";

export class ChangeSetTooLargeError extends Error {
  override name = "ChangeSetTooLargeError";
}

export const OVERVIEW_PART = "~overview";
export const REST_PART = "~rest";
const JOIN_PREFIX = "~join:";

type Frame = Extract<ProposedChange, { kind: "create_frame" }>;

/** The text of a section's title block (`<frame>::title`), else the frame's own title, else its key. */
function partTitle(frame: Frame, changes: readonly ProposedChange[]): string {
  const title = changes.find((c) => c.kind === "create_block" && c.key === `${frame.key}::title`);
  if (title && "content" in title) {
    const first = (title.content as { content?: unknown }[])[0];
    if (first && typeof first.content === "string" && first.content.trim()) return first.content.trim().slice(0, 200);
  }
  return (frame.title || frame.key).slice(0, 200);
}

const created = (t: ChangeTarget): string | null => ("created" in t ? t.created : null);

/** `set` divided into one part per top-level frame when it has more than `MAX_CHANGES` changes or conflicts; otherwise `set` itself. */
export function splitIntoSectionParts(set: ChangeSet): ChangeSet {
  const conflicts = set.conflicts ?? [];
  if (set.parts || (set.changes.length <= MAX_CHANGES && conflicts.length <= MAX_CHANGES)) return set;

  const frames = set.changes.filter((c): c is Frame => c.kind === "create_frame");
  const nested = new Set(frames.flatMap((f) => f.children));
  const roots = frames.filter((f) => !nested.has(f.key));
  const byKey = new Map(frames.map((f) => [f.key, f] as const));

  // Which part creates each key: a root frame, everything inside it (frames within frames included).
  const ownerOf = new Map<string, string>();
  const claim = (frame: Frame, part: string, seen: Set<string>) => {
    if (seen.has(frame.key)) return;
    seen.add(frame.key);
    ownerOf.set(frame.key, part);
    for (const child of frame.children) {
      ownerOf.set(child, part);
      const inner = byKey.get(child);
      if (inner) claim(inner, part, seen);
    }
  };
  for (const root of roots) claim(root, root.key, new Set());

  // New objects joined to an existing frame (an update or merge filling a section already on the canvas) belong to that
  // frame's part, with the join itself; otherwise the join would be separated from the objects it names.
  const joins: string[] = [];
  for (const c of set.changes) {
    if (c.kind !== "update_frame") continue;
    const part = JOIN_PREFIX + c.target;
    if (!joins.includes(part)) joins.push(part);
    for (const key of c.add) if (!ownerOf.has(key)) ownerOf.set(key, part);
  }

  const partOf = (c: ProposedChange): string => {
    if (c.kind === "update_frame") return ownerOf.get(c.add[0] ?? "") ?? REST_PART;
    if (c.kind === "connect") return ownerOf.get(created(c.from) ?? "") ?? ownerOf.get(created(c.to) ?? "") ?? OVERVIEW_PART;
    if ("key" in c) return ownerOf.get(c.key) ?? OVERVIEW_PART;
    return REST_PART;
  };

  const order = [OVERVIEW_PART, ...roots.map((r) => r.key), ...joins, REST_PART];
  const grouped = new Map<string, ProposedChange[]>(order.map((k) => [k, []]));
  for (const c of set.changes) grouped.get(partOf(c))!.push(c);
  const restConflicts: ConflictItem[] = [...conflicts];

  const label = (key: string): string => {
    if (key === OVERVIEW_PART) return "Overview";
    if (key === REST_PART) return "Other changes";
    if (key.startsWith(JOIN_PREFIX)) return `Additions to an existing section (${joins.indexOf(key) + 1})`;
    return partTitle(byKey.get(key)!, grouped.get(key)!);
  };
  const parts: ChangeSetPart[] = [];
  const changes: ProposedChange[] = [];
  for (const key of order) {
    const own = grouped.get(key)!;
    const owned = key === REST_PART ? restConflicts : [];
    if (!own.length && !owned.length) continue;
    if (own.length > MAX_CHANGES || owned.length > MAX_CHANGES) {
      throw new ChangeSetTooLargeError(
        `The section "${label(key)}" alone would create ${own.length.toLocaleString("en-US")} objects, more than the ${MAX_CHANGES} one review can hold. Nothing was changed. Split the content into smaller pieces and visualize them separately.`,
      );
    }
    parts.push({ key, title: label(key), changes: own.length, conflicts: owned.length, ...(set.contentSource ? { contentSource: set.contentSource } : {}) });
    changes.push(...own);
  }
  if (changes.length > MAX_MERGED_CHANGES) {
    throw new ChangeSetTooLargeError(
      `This content would create ${changes.length.toLocaleString("en-US")} objects, more than the ${MAX_MERGED_CHANGES.toLocaleString("en-US")} one review can hold. Nothing was changed. Split the content into smaller pieces and visualize them separately.`,
    );
  }

  const { contentSource: _contentSource, conflicts: _conflicts, ...rest } = set;
  return { ...rest, changes, ...(restConflicts.length ? { conflicts: restConflicts } : {}), parts };
}
