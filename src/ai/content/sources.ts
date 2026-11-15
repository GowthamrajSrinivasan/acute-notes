/**
 * Content source versioning (F37): each Visualize run is tied to a
 * `ContentSource`; "Update from new content" (F39) appends a new
 * `ContentSourceVersion` to the same source instead of starting an unrelated
 * one. A version is recorded only when its change set is **accepted** — a
 * rejected run leaves no trace. Device-local (`ContentSourceRepository`),
 * never in workspace documents, Yjs or exports.
 */
import type { ContentSourceRecord } from "@/ai/changes/changeSet";
import { parseContent } from "@/ai/content/parser";
import type { Lineage, UnitSet } from "@/ai/fidelity/contracts";
import { matchVersions, splitUnits } from "@/ai/fidelity/sourceUnits";
import { nextPathIds } from "@/ai/reconcile/topicIds";
import type { VisualNode, VisualPlan } from "@/ai/visual-plan/types";
import { newId } from "@/domain/ids";
import type { ContentSource, ContentSourceVersion, DocumentHome } from "@/domain/types";
import type { ContentSourceRepository } from "@/persistence/repositories/types";

export function newContentSourceId(): string {
  return newId("src");
}

/**
 * Writes still in flight, per repository and source. Accept records a version without waiting (the undo step is
 * already written), so `loadLatest` waits for them: a re-send right after Accept compares against the version
 * that Accept just recorded, never the one before it.
 */
const inFlight = new WeakMap<ContentSourceRepository, Map<string, Promise<void>>>();

/** Writes an accepted change set's content version: a new source at version 1, or the next version of an existing one. */
export function recordAcceptedSource(repo: ContentSourceRepository, home: DocumentHome, record: ContentSourceRecord, now = Date.now()): Promise<void> {
  return enqueue(repo, record.sourceId, () => writeAccepted(repo, home, record, now));
}

/**
 * An accept that left some of the source's cards unapplied (a claim-level patch skipped because its card changed since
 * the update was planned, or a conflict left undecided): the version recorded says, for each of those cards' nodes
 * (`unapplied`, stable node keys), what the previous version said — in its plan and in its text — so the next update
 * from the same content diffs those nodes again and offers just them ("Update again to redo it"), while the facts that
 * were applied stay recorded and are not proposed again. When that can't be done exactly (a node without a source
 * span, a heading, a node the previous version doesn't have), no version is recorded: the next update then diffs from
 * the previous one, and nothing is lost. Waits like any recording (`loadLatest`).
 */
export function recordPartlyAppliedSource(repo: ContentSourceRepository, home: DocumentHome, record: ContentSourceRecord, unapplied: readonly string[], now = Date.now()): Promise<void> {
  if (!unapplied.length) return recordAcceptedSource(repo, home, record, now);
  return enqueue(repo, record.sourceId, async () => {
    const previous = record.version > 1 ? await repo.getVersion(record.sourceId, record.version - 1) : null;
    const kept = previous ? withUnappliedNodes(record, previous, unapplied) : null;
    if (!kept) {
      console.warn("[acute-notes] Part of the update wasn't applied and can't be kept apart; the content version is not recorded, so the next update offers it again.");
      return;
    }
    await writeAccepted(repo, home, kept, now);
  });
}

type SpannedNode = VisualNode & { sourceSpan: { start: number; end: number } };
const spanned = (n: VisualNode | undefined): n is SpannedNode => !!n?.sourceSpan && n.sourceSpan.start >= 0 && n.sourceSpan.end >= n.sourceSpan.start;

/**
 * `record` with each `unapplied` node (by stable key) as `previous` had it: its content in the plan, and its source
 * span's text in the text (later spans shifted to match). Keys the record's plan doesn't have are ignored (a merged set
 * passes every part the same keys); a node whose content is unchanged needs nothing. Null when a node can't be put back
 * exactly. The record's units and lineage are dropped (they describe the text as proposed): the recording computes them
 * again from the previous version's.
 */
export function withUnappliedNodes(record: ContentSourceRecord, previous: Pick<ContentSourceVersion, "text" | "plan">, unapplied: readonly string[]): ContentSourceRecord | null {
  const plan = record.plan as Partial<VisualPlan> | null;
  const before = previous.plan as Partial<VisualPlan> | null;
  if (!Array.isArray(plan?.nodes) || !Array.isArray(before?.nodes)) return null;
  const old = new Map(before.nodes.flatMap((n) => (n.stableKey ? [[n.stableKey, n] as const] : [])));
  const splices: { at: { start: number; end: number }; text: string; node: VisualNode }[] = [];
  for (const key of new Set(unapplied)) {
    const next = plan.nodes.find((n) => n.stableKey === key);
    if (!next) continue;
    const was = old.get(key);
    if (!spanned(next) || !spanned(was) || next.type === "heading" || next.type === "group" || next.type !== was.type) return null;
    if (next.sourceSpan.end > record.text.length || was.sourceSpan.end > previous.text.length) return null;
    const text = previous.text.slice(was.sourceSpan.start, was.sourceSpan.end);
    if (JSON.stringify(was.content) === JSON.stringify(next.content) && text === record.text.slice(next.sourceSpan.start, next.sourceSpan.end)) continue;
    const { title: _title, ...rest } = next;
    splices.push({ at: next.sourceSpan, text, node: { ...rest, content: was.content, ...(was.title !== undefined ? { title: was.title } : {}) } as VisualNode });
  }
  if (!splices.length) return record;
  splices.sort((a, b) => a.at.start - b.at.start);
  for (let i = 1; i < splices.length; i++) if (splices[i]!.at.start < splices[i - 1]!.at.end) return null;
  // A position after (or at the end of) a put-back span moves by how much longer or shorter the old text is.
  const shift = (pos: number) => pos + splices.reduce((d, s) => (s.at.end <= pos ? d + s.text.length - (s.at.end - s.at.start) : d), 0);
  let text = record.text;
  for (const s of [...splices].reverse()) text = text.slice(0, s.at.start) + s.text + text.slice(s.at.end);
  const replaced = new Map(splices.map((s) => [s.node.stableKey!, s] as const));
  const nodes = plan.nodes.map((n): VisualNode => {
    const s = n.stableKey ? replaced.get(n.stableKey) : undefined;
    if (s) return { ...s.node, sourceSpan: { start: shift(s.at.start), end: shift(s.at.start) + s.text.length } };
    return n.sourceSpan ? { ...n, sourceSpan: { start: shift(n.sourceSpan.start), end: shift(n.sourceSpan.end) } } : n;
  });
  const { units: _units, lineage: _lineage, ...kept } = record;
  return { ...kept, text, plan: { ...plan, nodes } };
}

/** Writes to one source run in order, so the latest version always wins; `loadLatest` waits for them. */
function enqueue(repo: ContentSourceRepository, sourceId: string, write: () => Promise<void>): Promise<void> {
  let writes = inFlight.get(repo);
  if (!writes) inFlight.set(repo, (writes = new Map()));
  const map = writes;
  const run = (map.get(sourceId) ?? Promise.resolve()).then(write);
  const settled = run.then(
    () => undefined,
    () => undefined,
  );
  map.set(sourceId, settled);
  void settled.then(() => {
    if (map.get(sourceId) === settled) map.delete(sourceId);
  });
  return run;
}

async function writeAccepted(repo: ContentSourceRepository, home: DocumentHome, record: ContentSourceRecord, now: number): Promise<void> {
  const existing = await repo.get(record.sourceId);
  const identity = await unitsOf(repo, record);
  const source: ContentSource = existing
    ? { ...existing, latestVersion: Math.max(existing.latestVersion, record.version), updatedAt: now }
    : {
        id: record.sourceId,
        workspaceId: home.workspaceId,
        canvasId: home.canvasId,
        origin: record.origin,
        tier: record.tier,
        template: record.template,
        latestVersion: record.version,
        createdAt: now,
        updatedAt: now,
      };
  const version: ContentSourceVersion = {
    sourceId: record.sourceId,
    version: record.version,
    text: record.text,
    plan: record.plan,
    ...(record.pathIds ? { pathIds: record.pathIds } : {}),
    ...(record.revisions?.length ? { revisions: record.revisions } : {}),
    ...(identity?.units ? { units: identity.units } : {}),
    ...(identity?.lineage ? { lineage: identity.lineage } : {}),
    createdAt: now,
  };
  await repo.append(source, version);
}

/**
 * The version's source units and lineage (knowledge-notes-plan §3.1, §6.3, WP1.3): the record's own when it carries
 * them; else carried over from the previous version's units by `matchVersions` (with the new version's `pathIds`, so a
 * renamed section keeps its units' topic and isn't read as a move); else, for a first version or one after a version
 * recorded before unit ids, fresh ids and no lineage. Never fails the recording: a text that can't be split is stored
 * without units, as before.
 */
async function unitsOf(repo: ContentSourceRepository, record: ContentSourceRecord): Promise<{ units: UnitSet; lineage?: Lineage } | null> {
  if (record.units) return { units: record.units, ...(record.lineage ? { lineage: record.lineage } : {}) };
  try {
    const previous = record.version > 1 ? await repo.getVersion(record.sourceId, record.version - 1) : null;
    const pathIds = record.pathIds ?? (previous ? nextPathIds(previous.pathIds, await parseContent(previous.text), previous.text, await parseContent(record.text), record.text) : undefined);
    if (previous && isUnitSet(previous.units)) {
      const { units, lineage } = await matchVersions({ ...previous.units, version: previous.version }, { text: record.text, version: record.version, ...(pathIds ? { pathIds } : {}) });
      return { units, lineage };
    }
    return { units: await splitUnits(record.text, pathIds ? { pathIds } : {}) };
  } catch (err) {
    console.warn("[acute-notes] Source units couldn't be computed; the version is stored without them.", err);
    return null;
  }
}

/** Stored units that can be matched against (an imported bundle's are passed through unchecked). */
function isUnitSet(v: unknown): v is UnitSet {
  if (typeof v !== "object" || v === null) return false;
  const { units, nextId } = v as Partial<UnitSet>;
  return Array.isArray(units) && Number.isInteger(nextId) && units.every((u) => typeof u?.id === "string" && typeof u.hash === "string" && typeof u.text === "string" && typeof u.topic === "string");
}

/** A source and its latest accepted version; null when either is missing (e.g. objects imported from another device). */
export async function loadLatest(repo: ContentSourceRepository, sourceId: string): Promise<{ source: ContentSource; version: ContentSourceVersion } | null> {
  await inFlight.get(repo)?.get(sourceId);
  const source = await repo.get(sourceId);
  if (!source) return null;
  const version = await repo.getVersion(sourceId, source.latestVersion);
  return version ? { source, version } : null;
}
