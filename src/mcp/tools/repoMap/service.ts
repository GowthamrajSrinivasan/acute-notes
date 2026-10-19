/**
 * The repo map (F43) behind the five tools: an IDE agent sends a repository
 * one module (section) at a time; Acute validates, lays out, reconciles and
 * stages it. Acute never reads the repository, runs git or calls a model:
 * every section goes through the existing pipeline only —
 *
 *   input (schema.ts, secrets) → sectioned VisualPlan (convert.ts)
 *     → F29 validateVisualPlan → F38/F38b reconciliation and F30/F41
 *       placement (`ai/reconcile/mapSection.ts`) → one part of the canvas's
 *       one pending change set (F19, merged: `PendingChanges.merge`)
 *
 * — and each accepted part records the section's next F37 content version
 * (`origin: "mcp"`), as Visualize does. The map's bookkeeping (keys → content
 * sources, links, commits) is a `RepoMapRecord` in the local store.
 *
 * Calls for one map run one at a time. A rejected call changes nothing: the
 * record is written only after the section was staged.
 *
 * A mapping session starts with `begin_repo_map` and ends when a new one
 * starts or after 30 minutes without a call; the user's "auto-accept this
 * session" (`sessionAutoAccept`) ends with it.
 */
import { sessionAutoAccept } from "@/ai/changes/autoAccept";
import { InvalidChangeSetError, parseChangeSet, type ChangeSet, type ChangeTarget } from "@/ai/changes/changeSet";
import { checkLayout, LAYOUT_LIMITS, type LayoutReport } from "@/ai/changes/layoutCheck";
import { partSlices, type PartSlice } from "@/ai/changes/parts";
import { checkProposal, focusOf, isObstacle, proposalGeometry } from "@/ai/changes/proposalGeometry";
import type { SceneElement } from "@/domain/canvas/adapter";
import { PendingReviewError } from "@/ai/changes/pendingChanges";
import { loadLatest, newContentSourceId } from "@/ai/content/sources";
import { mapObjectIndex, mapObjectText, reconcileMapSection, type CrossLink, type MapObject } from "@/ai/reconcile/mapSection";
import type { ParseMarkdown } from "@/ai/renderer/mapNode";
import { loadDefaultParser, type Box } from "@/ai/renderer/render";
import { SECTIONS_MAX_WIDTH } from "@/ai/renderer/layout";
import type { VisualPlan } from "@/ai/visual-plan/types";
import { InvalidVisualPlanError, validateVisualPlan } from "@/ai/visual-plan/validate";
import { randomId } from "@/domain/ids";
import type { CanvasRepository, ContentSourceRepository, RepoMapLink, RepoMapRecord, RepoMapRepository } from "@/persistence/repositories/types";
import { ToolFailure, type ToolPolicy } from "../common";
import type { LiveCanvasActions } from "../liveCanvas";
import { convertSection, sectionFromText, summaryKey } from "./convert";
import type { RepoMapHost } from "./host";
import { normalizePath, REPO_MAP_LIMITS, RepoMapRejection, type MapRelationshipInput, type SectionInput } from "./schema";
import { affectedAncestors } from "./ancestors";

export const SESSION_IDLE_MS = 30 * 60_000;

export const REPO_MAP_MESSAGES = {
  writesDisabled: "This workspace is read-only for MCP clients — change it in ⋮ → MCP access. get_map_status still works.",
  noHost: "Acute-Notes can't create or open canvases from here; open Acute-Notes with MCP access on.",
  notFound: (mapId: string) => `No repo map ${mapId} in this workspace; call begin_repo_map first.`,
  notOpen: "The map canvas isn't open in Acute-Notes; call begin_repo_map to open it again.",
  reviewing: "The user is reviewing other changes on the map canvas; ask them to accept or reject those first.",
} as const;

export interface RepoMapServices {
  store: RepoMapRepository;
  contentSources: ContentSourceRepository;
}

export interface RepoMapDeps {
  workspaceId: string;
  services: RepoMapServices;
  canvases: Pick<CanvasRepository, "get">;
  liveCanvas(): LiveCanvasActions | null;
  host(): RepoMapHost | null;
  policy(): ToolPolicy;
  clientName(): string | undefined;
  parseMarkdown?: ParseMarkdown;
  now?(): number;
  /** How long `begin_repo_map` waits for the map canvas to open. */
  openTimeoutMs?: number;
}

/** `tidy_map_section`'s input (Wave 1b item 1b): structure only, never card text. */
export interface TidyInput {
  section: string;
  /** Card keys in the order to lay them out; the rest follow, ordered by the section's own links. */
  order?: string[];
  arrangement?: "grid" | "row" | "column";
  /** Links the map drew, by their ends' keys (and type, when two links join the same pair). */
  dropLinks?: { from: string; to: string; type?: string }[];
  /** A new parent card (a level up), or null to make the section top-level. */
  parent?: string | null;
}

/** Space between cards a tidy lays out, and around cards it keeps clear of. */
const TIDY_GAP = 48;
const TIDY_MARGIN = 16;

export type NodeOutcomeEntry = { key: string; outcome: "added" | "updated" | "unchanged" | "conflict"; reason?: string };

export interface StageResult {
  status: "staged" | "applied" | "unchanged";
  outcomes: NodeOutcomeEntry[];
  removed: string[];
  pendingEdges: { from: string; to: string; type: string }[];
  warnings: string[];
  /** Layout checks (Wave 1b item 4) on what this call staged, by map key; absent when nothing was staged. */
  layout?: LayoutReport;
}

// ---------------------------------------------------------------------------
// Tab-wide state: one mapping session per map, and one call at a time per map
// (a tab serves several MCP client sessions, each with its own server).

interface Session {
  id: string;
  lastCallAt: number;
}
const sessions = new Map<string, Session>();
const queues = new Map<string, Promise<unknown>>();

/** For tests: forgets sessions and queues. */
export function resetRepoMapState(): void {
  sessions.clear();
  queues.clear();
}

export const mergeKeyOf = (mapId: string) => `repomap:${mapId}`;

function serialized<T>(mapId: string, run: () => Promise<T>): Promise<T> {
  const previous = queues.get(mapId) ?? Promise.resolve();
  const next = previous.then(run, run);
  queues.set(
    mapId,
    next.then(
      () => undefined,
      () => undefined,
    ),
  );
  return next;
}

export class RepoMapService {
  constructor(private readonly deps: RepoMapDeps) {}

  private now = () => this.deps.now?.() ?? Date.now();

  /** The current session of a map, a new one when there is none or it went idle (which ends auto-accept). */
  private session(mapId: string, fresh = false): Session {
    const now = this.now();
    let s = sessions.get(mapId);
    if (fresh || !s || now - s.lastCallAt > SESSION_IDLE_MS) {
      sessionAutoAccept.end(mergeKeyOf(mapId));
      s = { id: `rms_${randomId(12)}`, lastCallAt: now };
      sessions.set(mapId, s);
    }
    s.lastCallAt = now;
    return s;
  }

  private requireWrites(): void {
    if (!this.deps.policy().allowWrites) throw new ToolFailure(REPO_MAP_MESSAGES.writesDisabled);
  }

  /**
   * A map reference from a tool call → the map's id. It is the `mapId` from begin_repo_map or the repo name the
   * map was begun with, so a new agent session can check status without calling begin_repo_map first. Resolved
   * before `serialized`/`session`, which key on the id. An unknown reference is returned as is; `record` reports it.
   */
  async resolveMapId(ref: string): Promise<string> {
    const byId = await this.deps.services.store.get(ref);
    if (byId && byId.workspaceId === this.deps.workspaceId) return byId.id;
    const byRepo = await this.deps.services.store.findByRepo(this.deps.workspaceId, ref.trim());
    return byRepo?.id ?? ref;
  }

  private async record(mapId: string): Promise<RepoMapRecord> {
    const rec = await this.deps.services.store.get(mapId);
    if (!rec || rec.workspaceId !== this.deps.workspaceId) throw new ToolFailure(REPO_MAP_MESSAGES.notFound(mapId));
    return rec;
  }

  /** The open map canvas, able to stage; the map writes to no other canvas. */
  private mapCanvas(rec: RepoMapRecord): LiveCanvasActions & Required<Pick<LiveCanvasActions, "merge" | "pending" | "getDocument">> {
    const live = this.deps.liveCanvas();
    if (!live || live.workspaceId !== this.deps.workspaceId || live.canvasId !== rec.canvasId || !live.merge || !live.pending || !live.getDocument) {
      throw new ToolFailure(REPO_MAP_MESSAGES.notOpen);
    }
    return live as LiveCanvasActions & Required<Pick<LiveCanvasActions, "merge" | "pending" | "getDocument">>;
  }

  // -------------------------------------------------------------------------
  // begin_repo_map

  async begin(args: { repo: string; commit: string; title?: string; repoRoot?: string }) {
    this.requireWrites();
    const repo = args.repo.trim();
    const existing = await this.deps.services.store.findByRepo(this.deps.workspaceId, repo);
    let rec = existing && (await this.deps.canvases.get(existing.canvasId)) ? existing : null;
    let created = false;
    if (!rec) {
      const host = this.deps.host();
      if (!host) throw new ToolFailure(REPO_MAP_MESSAGES.noHost);
      const title = (args.title?.trim() || `Repo map · ${repo}`).slice(0, 200);
      const canvasId = await host.createCanvas(title);
      const now = this.now();
      rec = {
        id: existing?.id ?? `map_${randomId(12)}`,
        workspaceId: this.deps.workspaceId,
        canvasId,
        repo,
        title,
        ids: {},
        nextId: 1,
        sections: {},
        links: [],
        reported: {},
        createdAt: now,
        updatedAt: now,
      };
      await this.deps.services.store.put(rec);
      created = true;
    }
    // Where the repo lives on this computer (Lens Phase 2's "Open in VS Code"), kept when given.
    if (args.repoRoot && rec.repoRoot !== args.repoRoot) {
      rec = { ...rec, repoRoot: args.repoRoot, updatedAt: this.now() };
      await this.deps.services.store.put(rec);
    }
    const session = this.session(rec.id, true);
    const open = await this.openMapCanvas(rec);
    const status = await this.status(rec.id, { commit: args.commit, mark: false });
    return { mapId: rec.id, canvasId: rec.canvasId, created, open, session: session.id, status };
  }

  private async openMapCanvas(rec: RepoMapRecord): Promise<boolean> {
    const isOpen = () => this.deps.liveCanvas()?.canvasId === rec.canvasId;
    if (isOpen()) return true;
    const host = this.deps.host();
    if (!host) return false;
    host.openCanvas(rec.canvasId);
    const deadline = this.now() + (this.deps.openTimeoutMs ?? 10_000);
    while (!isOpen() && Date.now() < deadline) await new Promise((r) => setTimeout(r, 50));
    return isOpen();
  }

  // -------------------------------------------------------------------------
  // upsert_map_section

  upsert(mapId: string, input: SectionInput): Promise<StageResult & { mapId: string; section: string }> {
    this.requireWrites();
    return serialized(mapId, async () => {
      const rec = await this.record(mapId);
      const live = this.mapCanvas(rec);
      const key = input.section.key;
      this.checkKeys(rec, input);
      this.session(mapId);
      const result = await this.stage(rec, live, key, input, { auto: true });
      const section = rec.sections[key];
      rec.sections[key] = {
        sourceId: section!.sourceId,
        label: input.section.label,
        commit: input.commit,
        nodes: Object.fromEntries(input.nodes.map((n) => [n.key, n.source ? { path: n.source.path, ...(n.source.lines ? { lines: n.source.lines } : {}) } : {}] as const)),
        order: section?.order ?? Object.keys(rec.sections).length,
        ...(input.section.parent ? { parent: input.section.parent } : {}),
      };
      rec.lastCommit = input.commit;
      rec.updatedAt = this.now();
      await this.deps.services.store.put(rec);
      return { mapId, section: key, ...result };
    });
  }

  /** The section that owns `key` (a card key or a section key), if any. */
  private ownerOf(rec: RepoMapRecord, key: string | undefined): string | undefined {
    if (key === undefined) return undefined;
    if (rec.sections[key]) return key;
    return Object.entries(rec.sections).find(([, s]) => key in s.nodes)?.[0];
  }

  /** A section's frame box: on the canvas (its title's or any member's frame), else as staged in the pending set. */
  private sectionFrame(rec: RepoMapRecord, sectionKey: string, elements: readonly SceneElement[], index: Map<string, Map<string, MapObject>>, others: readonly PartSlice[]): Box | null {
    const section = rec.sections[sectionKey];
    if (!section) return null;
    const objects = index.get(section.sourceId);
    const members = [objects?.get(sectionKey), ...(objects?.values() ?? [])].filter((o): o is MapObject => !!o);
    for (const o of members) {
      const el = elements.find((e) => e.id === o.objectId);
      const frame = el?.frameId ? elements.find((e) => e.id === el.frameId && !e.isDeleted) : undefined;
      if (frame) return { x: frame.x, y: frame.y, width: frame.width, height: frame.height };
    }
    const staged = others.find((x) => x.part.key === sectionKey)?.changes.find((c) => c.kind === "create_frame");
    return staged && staged.kind === "create_frame" ? staged.box : null;
  }

  /**
   * Where a child section goes (Wave 1b levels): in a band under its parent's section, after the siblings already
   * there, wrapping to a new row past the section width. Null when the parent's frame isn't on the canvas or staged.
   */
  private childAnchor(
    rec: RepoMapRecord,
    parentKey: string,
    key: string,
    elements: readonly SceneElement[],
    index: Map<string, Map<string, MapObject>>,
    others: readonly PartSlice[],
  ): { anchor: Box; side: "right" | "below" } | null {
    const parentSection = this.ownerOf(rec, parentKey);
    const parentFrame = parentSection ? this.sectionFrame(rec, parentSection, elements, index, others) : null;
    if (!parentSection || !parentFrame) return null;
    const siblings = Object.entries(rec.sections)
      .filter(([k, s]) => k !== key && this.ownerOf(rec, s.parent) === parentSection)
      .map(([k]) => this.sectionFrame(rec, k, elements, index, others))
      .filter((b): b is Box => !!b);
    const below = { anchor: { x: parentFrame.x, y: parentFrame.y + parentFrame.height, width: 0, height: 0 }, side: "below" as const };
    if (!siblings.length) return below;
    const top = Math.max(...siblings.map((f) => f.y));
    const last = siblings.filter((f) => f.y >= top - 1).reduce((a, f) => (f.x + f.width > a.x + a.width ? f : a));
    if (last.x + last.width - parentFrame.x < SECTIONS_MAX_WIDTH) return { anchor: last, side: "right" };
    return { anchor: { x: parentFrame.x, y: Math.max(...siblings.map((f) => f.y + f.height)), width: 0, height: 0 }, side: "below" };
  }

  /** Keys unique within the map, and the map's size limits. */
  private checkKeys(rec: RepoMapRecord, input: SectionInput): void {
    const key = input.section.key;
    const owner = new Map<string, string>();
    for (const [sk, s] of Object.entries(rec.sections)) for (const nk of Object.keys(s.nodes)) owner.set(nk, sk);
    const taken = [key, ...input.nodes.map((n) => n.key)].filter((k) => (owner.has(k) && owner.get(k) !== key) || (k !== key && rec.sections[k] && Object.keys(rec.sections[k]!.nodes).length));
    if (owner.has(key) && owner.get(key) !== key) taken.unshift(key);
    // A parent is a card (or a section) another section already sent: the level above this one.
    const parent = input.section.parent;
    if (parent !== undefined && !((owner.has(parent) && owner.get(parent) !== key) || (parent !== key && rec.sections[parent] && Object.keys(rec.sections[parent]!.nodes).length))) {
      throw new RepoMapRejection({
        reason: "unknown_parent",
        message: `section.parent "${parent}" isn't a card of another section in this map. Send the higher-level section (e.g. the overview) first, then use one of its card keys as the parent.`,
        keys: [parent],
      });
    }
    if (taken.length) {
      const where = (k: string) => (rec.sections[k] ? `a section` : `section ${owner.get(k)}`);
      throw new RepoMapRejection({
        reason: "duplicate_key",
        message: `Keys are unique within the map: ${[...new Set(taken)].map((k) => `"${k}" is already used by ${where(k)}`).join("; ")}. Remove it there first (remove_map_nodes) or use another key.`,
        keys: [...new Set(taken)],
      });
    }
    const others = Object.entries(rec.sections).filter(([k, s]) => k !== key && Object.keys(s.nodes).length);
    if (others.length + 1 > REPO_MAP_LIMITS.sectionsPerMap) {
      throw new RepoMapRejection({ reason: "map_full", message: `The map already has ${others.length} sections (limit: ${REPO_MAP_LIMITS.sectionsPerMap} per map). Map at a coarser module level: merge small modules into one section.` });
    }
    const nodes = others.reduce((n, [, s]) => n + Object.keys(s.nodes).length, 0) + input.nodes.length;
    if (nodes > REPO_MAP_LIMITS.nodesPerMap) {
      throw new RepoMapRejection({ reason: "map_full", message: `This section would bring the map to ${nodes} nodes (limit: ${REPO_MAP_LIMITS.nodesPerMap} per map). Map at a coarser level: fewer, broader cards per section.` });
    }
  }

  /**
   * Reconciles one section (`input`; null removes it whole) with the canvas and stages the result as that
   * section's part of the pending set. Assigns the section's content source (in `rec`, which the caller saves).
   */
  private async stage(rec: RepoMapRecord, live: ReturnType<RepoMapService["mapCanvas"]>, key: string, input: SectionInput | null, opts: { auto: boolean }): Promise<StageResult> {
    const mergeKey = mergeKeyOf(rec.id);
    const pending = live.pending(mergeKey);
    if (pending && pending.mergeKey !== mergeKey) throw new ToolFailure(REPO_MAP_MESSAGES.reviewing);
    const slices = pending ? partSlices(pending) : [];
    const staged = slices.find((s) => s.part.key === key);
    const others = slices.filter((s) => s.part.key !== key);

    const idOf = (k: string) => (rec.ids[k] ??= `k${rec.nextId++}`);
    const sourceId = rec.sections[key]?.sourceId ?? newContentSourceId();
    const label = input?.section.label ?? rec.sections[key]?.label ?? key;
    rec.sections[key] ??= { sourceId, label, commit: input?.commit ?? rec.lastCommit ?? "", nodes: {}, order: Object.keys(rec.sections).length };

    const converted = input ? convertSection(input, idOf) : null;
    let plan: VisualPlan | null = null;
    let warnings: string[] = [];
    if (converted) {
      try {
        ({ plan, warnings } = validateVisualPlan(converted.plan));
      } catch (err) {
        if (err instanceof InvalidVisualPlanError) throw new RepoMapRejection({ reason: "invalid_input", message: `The section can't be rendered: ${err.problems.join("; ")}` });
        throw err;
      }
    }
    const inputKeys = input ? [input.section.key, ...(input.section.summary ? [summaryKey(input.section.key)] : []), ...input.nodes.map((n) => n.key)] : [];

    // Links: this section's own cross links replace what it declared before; the other end is resolved below.
    if (input) {
      const declared = converted!.cross.map((r) => ({ from: r.from, to: r.to, type: r.type, ...(r.label ? { label: r.label } : {}), by: key }));
      // A child section is linked from the card it details: detail goes one level down (explained_by).
      if (input.section.parent) declared.push({ from: input.section.parent, to: key, type: "explained_by", label: "details", by: key });
      rec.links = dedupeLinks([...rec.links.filter((l) => l.by !== key), ...declared]);
    }
    const own = new Set(inputKeys);

    const elements = live.elements();
    const getDocument = (id: string) => live.getDocument(id);
    const sourceIds = new Set(Object.values(rec.sections).map((s) => s.sourceId));
    const index = mapObjectIndex(elements, getDocument, sourceIds);
    const latest = await loadLatest(this.deps.services.contentSources, sourceId);
    let previous: { plan: VisualPlan; version: number } | null = null;
    if (latest) {
      try {
        previous = { plan: validateVisualPlan(latest.version.plan).plan, version: latest.version.version };
      } catch {
        previous = null; // a removed section's empty version
      }
    }

    // Re-sent exactly as staged: nothing new.
    if (converted && staged?.part.contentSource && withoutCommit(staged.part.contentSource.text) === converted.body) {
      live.clearStale?.([...(index.get(sourceId)?.values() ?? [])].map((o) => o.objectId));
      return { status: "unchanged", outcomes: inputKeys.map((k) => ({ key: k, outcome: "unchanged", reason: "already_staged" })), removed: [], pendingEdges: this.pendingEdgesOf(rec, own), warnings };
    }

    // Placement context: the live canvas plus everything the other staged sections will create.
    const rc = live.renderContext();
    const stagedBoxes = others.flatMap((s) => s.changes.flatMap((c) => ("box" in c ? [c.box] : [])));
    const stagedMoves = new Map(others.flatMap((s) => s.changes.flatMap((c) => (c.kind === "move" ? [[c.target, c.to] as const] : []))));
    const objects = rc.objects?.map((o) => (stagedMoves.has(o.id) ? { ...o, box: { ...o.box, ...stagedMoves.get(o.id)! }, locked: true } : o));
    const existing: Box[] = [...rc.existing, ...stagedBoxes, ...(objects ?? []).filter((o) => stagedMoves.has(o.id)).map((o) => o.box)];
    const frames = [
      ...elements.filter((e) => e.type === "frame" && !e.isDeleted).map((e) => ({ x: e.x, y: e.y, width: e.width, height: e.height })),
      ...others.flatMap((s) => s.changes.flatMap((c) => (c.kind === "create_frame" ? [c.box] : []))),
    ];

    // Cross links whose other end exists (on the canvas or staged); the rest wait as pending edges.
    const keyOwner = new Map<string, string>();
    for (const [sk, s] of Object.entries(rec.sections)) {
      keyOwner.set(sk, sk);
      keyOwner.set(summaryKey(sk), sk);
      for (const nk of Object.keys(s.nodes)) keyOwner.set(nk, sk);
    }
    const stagedKeys = new Set(others.flatMap((s) => s.changes.flatMap((c) => ("key" in c && c.kind !== "connect" ? [c.key] : []))));
    const resolveOther = (k: string): ChangeTarget | null => {
      const ownerKey = keyOwner.get(k);
      if (!ownerKey || ownerKey === key || !rec.ids[k]) return null;
      const obj = index.get(rec.sections[ownerKey]!.sourceId)?.get(k);
      if (obj) return { existing: obj.objectId };
      const created = ownerKey === k ? `${rec.ids[k]}::title` : rec.ids[k]!;
      return stagedKeys.has(created) ? { created } : null;
    };
    const crossLinks: CrossLink[] = [];
    for (const l of rec.links) {
      const outgoing = own.has(l.from) && !own.has(l.to);
      const incoming = own.has(l.to) && !own.has(l.from);
      if (!outgoing && !incoming) continue;
      const other = resolveOther(outgoing ? l.to : l.from);
      if (other) crossLinks.push({ key: outgoing ? l.from : l.to, outgoing, other, type: l.type, ...(l.label ? { label: l.label } : {}) });
    }

    const client = this.deps.clientName();
    const metadata: ChangeSet["metadata"] = { createdBy: "mcp", task: "repo_map", template: "sectioned", ...(client ? { provider: client } : {}) };
    const operationId = pending?.operationId ?? `op_${randomId()}`;
    const title = `${client ?? "MCP"}: Repo map ${rec.repo}`.slice(0, 200);
    const result = await reconcileMapSection({
      plan,
      groupId: idOf(key),
      label,
      previous,
      sourceId,
      elements,
      getDocument,
      crossLinks,
      context: { existing, viewport: rc.viewport, ...(objects ? { objects } : {}) },
      newSection: (input?.section.parent && this.childAnchor(rec, input.section.parent, key, elements, index, others)) || newSectionAnchor(frames),
      refs: converted?.refs ?? new Map(),
      mapSources: sourceIds,
      keyPrefix: idOf(key),
      operationId,
      title,
      metadata,
      parseMarkdown: this.deps.parseMarkdown ?? (await loadDefaultParser()),
    });

    const outcomes: NodeOutcomeEntry[] = inputKeys.map((k) => {
      const kept = result.userKept.get(k);
      return { key: k, outcome: result.outcomes.get(k) ?? "unchanged", ...(kept ? { reason: kept === "deleted" ? "deleted_by_user" : "excluded_by_user" } : {}) };
    });
    live.clearStale?.([...(index.get(sourceId)?.values() ?? [])].map((o) => o.objectId));
    const pendingEdges = this.pendingEdgesOf(rec, own);

    if (!result.changes.length && !result.conflicts.length) {
      if (staged) live.dropParts?.(mergeKey, [key]);
      return { status: "unchanged", outcomes, removed: [], pendingEdges, warnings };
    }

    const version = (latest?.source.latestVersion ?? 0) + 1;
    const text = converted?.text ?? JSON.stringify({ commit: rec.sections[key]!.commit, section: { key, label }, nodes: [], relationships: [] });
    const set: ChangeSet = {
      operationId,
      title,
      metadata,
      mergeKey,
      session: sessions.get(rec.id)?.id ?? this.session(rec.id).id,
      // The client's own name, for the change log (D32, D61).
      ...(client ? { agent: client } : {}),
      changes: result.changes,
      ...(result.conflicts.length ? { conflicts: result.conflicts } : {}),
      parts: [
        {
          key,
          title: label.slice(0, 200),
          changes: result.changes.length,
          conflicts: result.conflicts.length,
          contentSource: { sourceId, version, origin: "mcp", tier: "ai", template: "sectioned", text, plan: plan ?? { version: 1, template: "sectioned", nodes: [], relationships: [] } },
        },
      ],
    };
    let parsed: ChangeSet;
    try {
      parsed = parseChangeSet(set, { externalKeys: stagedKeys });
    } catch (err) {
      if (err instanceof InvalidChangeSetError) throw new ToolFailure(`The section couldn't be staged: ${err.problems.slice(0, 5).join("; ")}`);
      throw err;
    }
    // The canvas may have changed while this was prepared (the user switched canvases, or another proposal arrived).
    if (this.deps.liveCanvas() !== live) throw new ToolFailure(REPO_MAP_MESSAGES.notOpen);
    try {
      live.merge(parsed);
    } catch (err) {
      if (err instanceof PendingReviewError) throw new ToolFailure(REPO_MAP_MESSAGES.reviewing);
      if (err instanceof InvalidChangeSetError) throw new ToolFailure(`The section couldn't be merged into the staged changes: ${err.problems.slice(0, 5).join("; ")}`);
      throw err;
    }

    // Layout checks on the merged set as it will be drawn, judging only this section's changes (Wave 1b item 4).
    const merged = live.pending(mergeKey);
    const all = merged?.mergeKey === mergeKey ? merged.changes : parsed.changes;
    const layout = checkProposal(all, elements, { focusOn: parsed.changes, name: layoutNames(rec, all, elements, index) });

    // Auto-accept (the user's choice, for this session only): never a section with conflicts or removals.
    const risky = result.conflicts.length > 0 || result.changes.some((c) => c.kind === "remove");
    const session = sessions.get(rec.id);
    let status: StageResult["status"] = "staged";
    if (opts.auto && !risky && session && sessionAutoAccept.isOn(mergeKey, session.id) && live.acceptParts) {
      const applied = live.acceptParts([key], mergeKey);
      if (applied && applied.applied > 0) status = "applied";
    }
    return { status, outcomes, removed: result.removed, pendingEdges, warnings, layout };
  }

  /** Links touching `keys` (or all, without) with an end the map hasn't been sent. */
  private pendingEdgesOf(rec: RepoMapRecord, keys?: ReadonlySet<string>) {
    const known = new Set<string>();
    for (const [sk, s] of Object.entries(rec.sections)) {
      if (!Object.keys(s.nodes).length && !keys?.has(sk)) continue;
      known.add(sk);
      for (const nk of Object.keys(s.nodes)) known.add(nk);
    }
    if (keys) for (const k of keys) known.add(k);
    return rec.links
      .filter((l) => (!keys || keys.has(l.from) || keys.has(l.to)) && (!known.has(l.from) || !known.has(l.to)))
      .map((l) => ({ from: l.from, to: l.to, type: l.type }));
  }

  // -------------------------------------------------------------------------
  // link_map_nodes

  link(mapId: string, links: MapRelationshipInput[]) {
    this.requireWrites();
    return serialized(mapId, async () => {
      const rec = await this.record(mapId);
      const live = this.mapCanvas(rec);
      this.session(mapId);
      rec.links = dedupeLinks([...rec.links, ...links.map((l) => ({ ...l, by: "" }))]);
      const sectionOf = (k: string) => (rec.sections[k] && Object.keys(rec.sections[k]!.nodes).length ? k : Object.entries(rec.sections).find(([, s]) => k in s.nodes)?.[0]);
      const results: { from: string; to: string; state: "staged" | "applied" | "pending" | "already_drawn" }[] = [];
      const touched = new Set<string>();
      for (const l of links) {
        const a = sectionOf(l.from);
        const b = sectionOf(l.to);
        if (!a || !b) {
          results.push({ from: l.from, to: l.to, state: "pending" });
          continue;
        }
        touched.add(a);
        results.push({ from: l.from, to: l.to, state: "staged" });
      }
      // Each section with a new link is staged again from what it last was: only the links are new.
      let applied = false;
      const layouts: LayoutReport[] = [];
      for (const sk of touched) {
        const base = await this.sectionNow(rec, live, sk);
        if (!base) continue;
        const r = await this.stage(rec, live, sk, base, { auto: true });
        if (r.layout) layouts.push(r.layout);
        if (r.status === "applied") applied = true;
        if (r.status === "unchanged") for (const x of results) if (sectionOf(x.from) === sk && x.state === "staged") x.state = "already_drawn";
      }
      if (applied) for (const x of results) if (x.state === "staged") x.state = "applied";
      rec.updatedAt = this.now();
      await this.deps.services.store.put(rec);
      return { mapId, links: results, ...(layouts.length ? { layout: mergeReports(layouts) } : {}) };
    });
  }

  /** A section as it stands now: its staged version, else its last accepted one. */
  private async sectionNow(rec: RepoMapRecord, live: ReturnType<RepoMapService["mapCanvas"]>, key: string): Promise<SectionInput | null> {
    const pending = live.pending(mergeKeyOf(rec.id));
    const staged = pending?.mergeKey === mergeKeyOf(rec.id) ? partSlices(pending).find((s) => s.part.key === key) : undefined;
    const text = staged?.part.contentSource?.text ?? (await loadLatest(this.deps.services.contentSources, rec.sections[key]!.sourceId))?.version.text;
    const input = text ? sectionFromText(text) : null;
    // The parent lives in the record, not in the section's text: a re-stage keeps the section's level (and its parent link).
    const parent = rec.sections[key]?.parent;
    return input && parent && !input.section.parent ? { ...input, section: { ...input.section, parent } } : input;
  }

  // -------------------------------------------------------------------------
  // remove_map_nodes

  remove(mapId: string, keys: string[]) {
    this.requireWrites();
    return serialized(mapId, async () => {
      const rec = await this.record(mapId);
      const live = this.mapCanvas(rec);
      this.session(mapId);
      const bySection = new Map<string, Set<string>>();
      const notFound: string[] = [];
      for (const k of keys) {
        const sk = rec.sections[k] ? k : Object.entries(rec.sections).find(([, s]) => k in s.nodes)?.[0];
        if (!sk) notFound.push(k);
        else bySection.set(sk, (bySection.get(sk) ?? new Set()).add(k));
      }
      const results: { section: string; status: StageResult["status"]; removed: string[] }[] = [];
      for (const [sk, ks] of bySection) {
        const base = await this.sectionNow(rec, live, sk);
        const whole = ks.has(sk) || !base || base.nodes.every((n) => ks.has(n.key));
        const next: SectionInput | null = whole
          ? null
          : { ...base!, nodes: base!.nodes.filter((n) => !ks.has(n.key)), relationships: base!.relationships.filter((r) => !ks.has(r.from) && !ks.has(r.to)) };
        // Always reviewed: removals are never auto-accepted.
        const r = await this.stage(rec, live, sk, next, { auto: false });
        const gone = whole ? [sk, ...Object.keys(rec.sections[sk]!.nodes)] : [...ks];
        const s = rec.sections[sk]!;
        s.nodes = whole ? {} : Object.fromEntries(Object.entries(s.nodes).filter(([k]) => !ks.has(k)));
        // Pending edges are dropped when either end is removed.
        const goneSet = new Set(gone);
        rec.links = rec.links.filter((l) => !goneSet.has(l.from) && !goneSet.has(l.to));
        results.push({ section: sk, status: r.status, removed: gone });
      }
      rec.updatedAt = this.now();
      await this.deps.services.store.put(rec);
      return { mapId, sections: results, notFound };
    });
  }

  // -------------------------------------------------------------------------
  // tidy_map_section (Wave 1b item 1b)

  /**
   * Tidies one section of the map without regenerating it: drops links the map drew, re-parents the section, and
   * lays its cards out again (moves only). Never edits card text, never moves a card the user moved or locked, never
   * touches anything the map didn't draw. Staged for review like every map change — never auto-accepted — and
   * measured: the result compares the section's layout before and after.
   */
  tidy(mapId: string, input: TidyInput) {
    this.requireWrites();
    return serialized(mapId, async () => {
      const rec = await this.record(mapId);
      const live = this.mapCanvas(rec);
      this.session(mapId);
      const key = input.section;
      const section = rec.sections[key];
      if (!section || !Object.keys(section.nodes).length) {
        throw new RepoMapRejection({ reason: "invalid_input", message: `There is no section "${key}" in this map (get_map_status lists them).`, keys: [key] });
      }
      const mergeKey = mergeKeyOf(rec.id);
      const pendingBefore = live.pending(mergeKey);
      if (pendingBefore && pendingBefore.mergeKey !== mergeKey) throw new ToolFailure(REPO_MAP_MESSAGES.reviewing);
      if (pendingBefore && partSlices(pendingBefore).some((x) => x.part.key === key)) {
        throw new ToolFailure(`Section ${key} has changes waiting for the user's review; ask them to accept or reject those first, then tidy it.`);
      }

      const elements = live.elements();
      const byId = new Map(elements.map((e) => [e.id, e] as const));
      const getDocument = (id: string) => live.getDocument(id);
      const sourceIds = new Set(Object.values(rec.sections).map((x) => x.sourceId));
      const index = mapObjectIndex(elements, getDocument, sourceIds);
      const objects = index.get(section.sourceId) ?? new Map<string, MapObject>();
      if (!objects.size) throw new ToolFailure(`Section ${key} isn't on the canvas yet (not accepted); tidy it once the user has accepted it.`);
      const base = await this.sectionNow(rec, live, key);
      if (!base) throw new ToolFailure(`Section ${key} has no accepted version to tidy.`);

      // What is judged: this section's cards and every link touching them.
      const sectionIds = new Set([...objects.values()].map((o) => o.objectId));
      const focus = new Set(sectionIds);
      for (const el of elements) {
        if (el.type === "arrow" && !el.isDeleted && (sectionIds.has(el.startBinding?.elementId ?? "") || sectionIds.has(el.endBinding?.elementId ?? ""))) focus.add(el.id);
      }
      const before = checkLayout(proposalGeometry(pendingBefore?.changes ?? [], elements), { focus, name: layoutNames(rec, pendingBefore?.changes ?? [], elements, index) });

      // 1. Links: the section's own relationships, other sections' declared links, and links sent with link_map_nodes.
      const edits = new Map<string, SectionInput>([[key, base]]);
      const restage = new Set<string>();
      const dropped: { from: string; to: string; type: string }[] = [];
      const notFound: string[] = [];
      const ownerOf = (k: string) => this.ownerOf(rec, k);
      for (const d of input.dropLinks ?? []) {
        const same = (r: { from: string; to: string; type: string }) => r.from === d.from && r.to === d.to && (!d.type || r.type === d.type);
        let done = false;
        for (const sk of new Set([key, ownerOf(d.from), ownerOf(d.to)].filter((x): x is string => !!x))) {
          const current = edits.get(sk) ?? (await this.sectionNow(rec, live, sk));
          if (!current) continue;
          const kept = current.relationships.filter((r) => !same(r));
          if (kept.length === current.relationships.length) continue;
          dropped.push(...current.relationships.filter(same).map((r) => ({ from: r.from, to: r.to, type: r.type })));
          edits.set(sk, { ...current, relationships: kept });
          restage.add(sk);
          done = true;
        }
        const sent = rec.links.filter((l) => l.by === "" && same(l));
        if (sent.length) {
          rec.links = rec.links.filter((l) => !(l.by === "" && same(l)));
          dropped.push(...sent.map((l) => ({ from: l.from, to: l.to, type: l.type })));
          for (const sk of [ownerOf(d.from), ownerOf(d.to)]) if (sk && Object.keys(rec.sections[sk]?.nodes ?? {}).length) restage.add(sk);
          done = true;
        }
        if (!done) notFound.push(`${d.from} → ${d.to}`);
      }

      // 2. Parent: a card in another section, or none.
      if (input.parent !== undefined) {
        const next = input.parent ?? undefined;
        if (next !== undefined) {
          const owner = ownerOf(next);
          if (!owner || owner === key || !Object.keys(rec.sections[owner]?.nodes ?? {}).length) {
            throw new RepoMapRejection({ reason: "unknown_parent", message: `parent "${next}" isn't a card of another section in this map.`, keys: [next] });
          }
        }
        if (next !== base.section.parent) {
          const current = edits.get(key)!;
          const { parent: _old, ...sectionRest } = current.section;
          edits.set(key, { ...current, section: next ? { ...sectionRest, parent: next } : sectionRest });
          restage.add(key);
        }
      }

      for (const sk of restage) {
        const next = edits.get(sk) ?? (await this.sectionNow(rec, live, sk));
        if (!next) continue;
        await this.stage(rec, live, sk, next, { auto: false });
        const s = rec.sections[sk]!;
        if (next.section.parent) s.parent = next.section.parent;
        else delete s.parent;
      }

      // 3. Layout: the section's cards again, in order, where Acute placed them (moves only).
      const layoutMoves = tidyMoves(key, objects, edits.get(key)!, input, elements, byId, live.renderContext().objects ?? []);
      const partKey = `tidy:${key}`;
      const pending = live.pending(mergeKey);
      const stagedTidy = pending?.mergeKey === mergeKey && partSlices(pending).some((x) => x.part.key === partKey);
      if (layoutMoves.moves.length) {
        const client = this.deps.clientName();
        const set: ChangeSet = {
          operationId: pending?.operationId ?? `op_${randomId()}`,
          title: pending?.title ?? `${client ?? "MCP"}: Repo map ${rec.repo}`.slice(0, 200),
          metadata: { createdBy: "mcp", task: "repo_map", template: "sectioned", ...(client ? { provider: client } : {}) },
          mergeKey,
          session: sessions.get(rec.id)?.id ?? this.session(rec.id).id,
          ...(client ? { agent: client } : {}),
          changes: layoutMoves.moves,
          parts: [{ key: partKey, title: `Tidy: ${section.label}`.slice(0, 200), changes: layoutMoves.moves.length, conflicts: 0 }],
        };
        let parsed: ChangeSet;
        try {
          parsed = parseChangeSet(set);
        } catch (err) {
          if (err instanceof InvalidChangeSetError) throw new ToolFailure(`The tidy couldn't be staged: ${err.problems.slice(0, 5).join("; ")}`);
          throw err;
        }
        if (this.deps.liveCanvas() !== live) throw new ToolFailure(REPO_MAP_MESSAGES.notOpen);
        try {
          live.merge(parsed);
        } catch (err) {
          if (err instanceof PendingReviewError) throw new ToolFailure(REPO_MAP_MESSAGES.reviewing);
          throw err;
        }
      } else if (stagedTidy) {
        live.dropParts?.(mergeKey, [partKey]);
      }

      const after = live.pending(mergeKey);
      const ours = after?.mergeKey === mergeKey ? partSlices(after).filter((x) => x.part.key === partKey || restage.has(x.part.key)).flatMap((x) => x.changes) : [];
      const afterReport = checkLayout(proposalGeometry(after?.changes ?? [], elements), {
        focus: new Set([...focus, ...focusOf(ours)]),
        name: layoutNames(rec, after?.changes ?? [], elements, index),
      });
      rec.updatedAt = this.now();
      await this.deps.services.store.put(rec);
      const changed = layoutMoves.moves.length > 0 || restage.size > 0;
      return {
        mapId,
        section: key,
        status: changed ? ("staged" as const) : ("unchanged" as const),
        moved: layoutMoves.moves.length,
        kept: layoutMoves.kept,
        droppedLinks: dropped,
        notFound,
        layout: { before: { counts: before.counts, score: before.score }, after: afterReport, improved: afterReport.score < before.score },
      };
    });
  }

  // -------------------------------------------------------------------------
  // get_map_status

  async status(mapId: string, opts: { commit?: string; changedPaths?: string[]; changedFiles?: { path: string; lines?: [number, number][] }[]; mark?: boolean; layout?: boolean } = {}) {
    const rec = await this.record(mapId);
    const live = this.deps.liveCanvas();
    const open = !!live && live.canvasId === rec.canvasId && live.workspaceId === this.deps.workspaceId && !!live.getDocument;
    const mergeKey = mergeKeyOf(rec.id);
    const pending = open ? (live!.pending?.() ?? null) : null;
    const stagedParts = new Map<string, PartSlice>(pending?.mergeKey === mergeKey ? partSlices(pending).map((s) => [s.part.key, s] as const) : []);
    const elements = open ? live!.elements() : [];
    const getDocument = (id: string) => live?.getDocument?.(id);
    const sections = Object.entries(rec.sections).sort((a, b) => a[1].order - b[1].order);
    const index = open ? mapObjectIndex(elements, getDocument, new Set(sections.map(([, s]) => s.sourceId))) : new Map<string, Map<string, MapObject>>();
    const latest = new Map(await Promise.all(sections.map(async ([k, s]) => [k, await loadLatest(this.deps.services.contentSources, s.sourceId)] as const)));

    const paths = new Set<string>();
    const prefixes: string[] = [];
    for (const raw of (opts.changedPaths ?? []).slice(0, REPO_MAP_LIMITS.changedPaths)) {
      const p = normalizePath(raw);
      if (!p) continue;
      if (p.endsWith("/")) prefixes.push(p);
      else paths.add(p);
    }
    // `changedFiles`: a path with line ranges only makes a card stale when the card's lines overlap one (or it has none).
    const ranged = new Map<string, [number, number][] | null>();
    for (const f of (opts.changedFiles ?? []).slice(0, REPO_MAP_LIMITS.changedPaths)) {
      const p = normalizePath(f.path);
      if (!p) continue;
      const prev = ranged.get(p);
      ranged.set(p, f.lines?.length && prev !== null ? [...(prev ?? []), ...f.lines] : null);
    }
    const byPath = paths.size > 0 || prefixes.length > 0 || ranged.size > 0;
    const cites = (path: string | undefined, lines?: [number, number]) => {
      if (!path) return false;
      if (paths.has(path) || prefixes.some((pre) => path.startsWith(pre))) return true;
      if (!ranged.has(path)) return false;
      const r = ranged.get(path);
      return !r || !lines || r.some(([a, b]) => a <= lines[1] && lines[0] <= b);
    };

    let budget = REPO_MAP_LIMITS.statusKeys;
    let truncated = false;
    const take = <T>(list: T[], cost = 1): T[] => {
      const n = Math.max(0, Math.min(list.length, Math.floor(budget / cost)));
      if (n < list.length) truncated = true;
      budget -= n * cost;
      return list.slice(0, n);
    };

    const out: { key: string; label: string; commit: string; state: "on_canvas" | "staged" | "not_on_canvas"; nodes: string[] }[] = [];
    const stale: string[] = [];
    const staleIds: string[] = [];
    let nodeCount = 0;
    for (const [sk, s] of sections) {
      const nodeKeys = Object.keys(s.nodes);
      const objects = index.get(s.sourceId);
      if (!nodeKeys.length && !objects?.size) continue;
      nodeCount += nodeKeys.length;
      const state = stagedParts.has(sk) ? "staged" : objects?.size || (!open && latest.get(sk)) ? "on_canvas" : "not_on_canvas";
      out.push({ key: sk, label: s.label, commit: s.commit, state, nodes: nodeKeys, ...(s.parent ? { parent: s.parent } : {}) });
      for (const nk of nodeKeys) {
        const isStale = byPath ? cites(s.nodes[nk]!.path, s.nodes[nk]!.lines) : !!opts.commit && s.commit !== opts.commit;
        if (!isStale) continue;
        stale.push(nk);
        const obj = objects?.get(nk);
        if (obj) staleIds.push(obj.objectId);
      }
    }

    // The user's corrections since the agent last saw them: edits (with the current text), deletions, opt-outs.
    const corrections: { key: string; kind: "edited" | "deleted" | "excluded"; text?: string }[] = [];
    const reported = { ...rec.reported };
    if (open) {
      for (const [sk, s] of sections) {
        const version = latest.get(sk)?.version;
        if (!version || stagedParts.has(sk)) continue;
        const accepted = acceptedKeys(version.plan);
        const objects = index.get(s.sourceId);
        for (const k of accepted) {
          const obj = objects?.get(k);
          let kind: "edited" | "deleted" | "excluded" | null = null;
          let text: string | undefined;
          if (!obj) kind = "deleted";
          else if (obj.excluded) kind = "excluded";
          else if (obj.edited) {
            kind = "edited";
            text = (mapObjectText(elements, getDocument, obj.objectId) ?? "").slice(0, REPO_MAP_LIMITS.textPerNode);
          }
          const token = kind ? `${kind}:${kind === "edited" ? hash(text ?? "") : ""}` : null;
          if (!token) {
            delete reported[k];
            continue;
          }
          if (reported[k] === token) continue;
          reported[k] = token;
          corrections.push({ key: k, kind: kind!, ...(text !== undefined ? { text } : {}) });
        }
      }
    }

    // §8.1 rule 4: the parent chain of each stale key, which may be affected too (keys only; never rewritten here).
    const ancestors = affectedAncestors(rec.sections, stale);
    const ancestorIds = ancestors.flatMap((k) => {
      const sk = this.ownerOf(rec, k);
      const obj = sk ? index.get(rec.sections[sk]!.sourceId)?.get(k) : undefined;
      return obj ? [obj.objectId] : [];
    });

    // The quiet "stale" marker on the canvas, for what cites a changed path; Lens rings what may be affected.
    if (open && opts.mark !== false && (byPath || opts.commit)) live!.setStale?.(staleIds, ancestorIds);

    const pendingEdges = this.pendingEdgesOf(rec);
    const payload = {
      mapId: rec.id,
      repo: rec.repo,
      canvasId: rec.canvasId,
      canvasOpen: open,
      lastCommit: rec.lastCommit ?? null,
      counts: { sections: out.length, nodes: nodeCount },
      limits: { sectionsPerMap: REPO_MAP_LIMITS.sectionsPerMap, nodesPerMap: REPO_MAP_LIMITS.nodesPerMap, nodesPerCall: REPO_MAP_LIMITS.nodesPerCall },
      staged: [...stagedParts.keys()],
      autoAccept: !!sessions.get(rec.id) && sessionAutoAccept.isOn(mergeKey, sessions.get(rec.id)!.id),
      sections: [] as typeof out,
      stale: [] as string[],
      affectedAncestors: [] as string[],
      pendingEdges: [] as typeof pendingEdges,
      corrections: [] as typeof corrections,
      truncated: false,
    };
    payload.corrections = take(corrections, 1);
    payload.stale = take(stale);
    payload.affectedAncestors = take(ancestors);
    payload.pendingEdges = take(pendingEdges, 2);
    for (const s of out) {
      if (budget <= 0) {
        truncated = true;
        break;
      }
      budget -= 1;
      payload.sections.push({ ...s, nodes: take(s.nodes) });
    }
    payload.truncated = truncated;
    // The map canvas's layout as it stands (with what is staged), by map key: where a tidy would help (Wave 1b).
    const layout = open && opts.layout ? checkLayout(proposalGeometry(pending?.changes ?? [], elements), { name: layoutNames(rec, pending?.changes ?? [], elements, index) }) : undefined;
    // Reported corrections are remembered (only those actually sent).
    const sent = new Set(payload.corrections.map((c) => c.key));
    const nextReported = Object.fromEntries(Object.entries(reported).filter(([k]) => sent.has(k) || rec.reported[k] === reported[k]));
    if (JSON.stringify(nextReported) !== JSON.stringify(rec.reported)) {
      rec.reported = nextReported;
      await this.deps.services.store.put(rec);
    }
    return layout ? { ...payload, layout } : payload;
  }
}

/**
 * Moves that lay a section's cards out again (tidy): in `order`, then along the section's own links, then where they
 * are now. Cards the user moved or locked stay put, and no slot overlaps anything the tidy doesn't move.
 */
function tidyMoves(
  key: string,
  objects: Map<string, MapObject>,
  base: SectionInput,
  input: TidyInput,
  elements: readonly SceneElement[],
  byId: Map<string, SceneElement>,
  placement: readonly { id: string; locked: boolean; placedByAcute: boolean }[],
): { moves: ChangeSet["changes"]; kept: string[] } {
  const hint = new Map(placement.map((o) => [o.id, o] as const));
  const cards = [...objects.entries()].flatMap(([k, o]) => {
    const el = k === key ? undefined : byId.get(o.objectId);
    return el ? [{ key: k, el }] : [];
  });
  const movable = cards.filter((c) => !c.el.locked && hint.get(c.el.id)?.placedByAcute === true);
  const movableKeys = new Set(movable.map((c) => c.key));
  const kept = cards.filter((c) => !movableKeys.has(c.key)).map((c) => c.key);
  if (!movable.length) return { moves: [], kept };

  // Order: as asked, then a walk along the section's own links from its most connected card (linked cards end up
  // neighbours), then the rest where they are now (top to bottom, left to right).
  const byPosition = [...movable].sort((a, b) => a.el.y - b.el.y || a.el.x - b.el.x || (a.key < b.key ? -1 : 1));
  const adjacent = new Map<string, string[]>();
  for (const r of base.relationships) {
    if (!movableKeys.has(r.from) || !movableKeys.has(r.to)) continue;
    (adjacent.get(r.from) ?? adjacent.set(r.from, []).get(r.from)!).push(r.to);
    (adjacent.get(r.to) ?? adjacent.set(r.to, []).get(r.to)!).push(r.from);
  }
  const order: string[] = [];
  const seen = new Set<string>();
  const visit = (k: string) => {
    if (seen.has(k) || !movableKeys.has(k)) return false;
    seen.add(k);
    order.push(k);
    return true;
  };
  visit(summaryKey(key));
  for (const k of input.order ?? []) visit(k);
  const degree = (k: string) => adjacent.get(k)?.length ?? 0;
  while (seen.size < movable.length) {
    const start = byPosition.map((c) => c.key).filter((k) => !seen.has(k)).reduce((a, b) => (degree(b) > degree(a) ? b : a));
    visit(start);
    const queue = [start];
    while (queue.length) for (const next of adjacent.get(queue.shift()!) ?? []) if (visit(next)) queue.push(next);
  }

  // Slots: a grid (or one row / column) of uniform cells under the section's title card, skipping any slot that
  // would overlap something the tidy doesn't move.
  const arrangement = input.arrangement ?? (base.section.arrangement === "chain" ? "row" : base.section.arrangement === "stack" ? "column" : "grid");
  const columns = arrangement === "row" ? movable.length : arrangement === "column" ? 1 : Math.ceil(Math.sqrt(movable.length));
  const cellW = Math.max(...movable.map((c) => c.el.width)) + TIDY_GAP;
  const cellH = Math.max(...movable.map((c) => c.el.height)) + TIDY_GAP;
  const titleId = objects.get(key)?.objectId;
  const title = titleId ? byId.get(titleId) : undefined;
  const originX = Math.min(...cards.map((c) => c.el.x), ...(title ? [title.x] : []));
  const originY = title ? title.y + title.height + TIDY_GAP : Math.min(...cards.map((c) => c.el.y));
  const moving = new Set(movable.map((c) => c.el.id));
  const fixed = elements.filter((e) => isObstacle(e) && !moving.has(e.id));
  const clear = (b: Box) =>
    !fixed.some((f) => b.x < f.x + f.width + TIDY_MARGIN && f.x < b.x + b.width + TIDY_MARGIN && b.y < f.y + f.height + TIDY_MARGIN && f.y < b.y + b.height + TIDY_MARGIN);
  const byKey = new Map(movable.map((c) => [c.key, c] as const));
  const moves: ChangeSet["changes"] = [];
  let slot = 0;
  for (const k of order) {
    const c = byKey.get(k)!;
    let to = { x: originX, y: originY };
    for (let tries = 0; tries < 10_000; tries += 1) {
      to = { x: originX + (slot % columns) * cellW, y: originY + Math.floor(slot / columns) * cellH };
      slot += 1;
      if (clear({ ...to, width: c.el.width, height: c.el.height })) break;
    }
    if (Math.abs(to.x - c.el.x) > 1 || Math.abs(to.y - c.el.y) > 1) moves.push({ kind: "move", target: c.el.id, to });
  }
  return { moves, kept };
}

/** Several sections' layout reports as one (issues concatenated, capped like one report). */
function mergeReports(reports: readonly LayoutReport[]): LayoutReport {
  const issues = reports.flatMap((r) => r.issues);
  const counts = { throughCards: 0, crossings: 0, sharedCorridors: 0, onFrameBorders: 0, labelCollisions: 0 };
  for (const r of reports) for (const k of Object.keys(counts) as (keyof typeof counts)[]) counts[k] += r.counts[k];
  return { issues: issues.slice(0, LAYOUT_LIMITS.issues), counts, score: reports.reduce((n, r) => n + r.score, 0), truncated: issues.length > LAYOUT_LIMITS.issues || reports.some((r) => r.truncated) };
}

/**
 * Layout-check ids → what the agent knows: map keys for cards, "from → to" for links, "section <key>" for frames.
 * Anything not in the map (the user's own objects) is named as such.
 */
function layoutNames(rec: RepoMapRecord, changes: readonly ChangeSet["changes"][number][], elements: readonly SceneElement[], index: Map<string, Map<string, MapObject>>) {
  const byId = new Map(elements.map((e) => [e.id, e] as const));
  const keyOfObject = new Map<string, string>();
  const frameSection = new Map<string, string>();
  const sectionOfSource = new Map(Object.entries(rec.sections).map(([k, s]) => [s.sourceId, k] as const));
  for (const [sourceId, objects] of index) {
    for (const [key, o] of objects) {
      keyOfObject.set(o.objectId, key);
      const frameId = byId.get(o.objectId)?.frameId;
      const section = sectionOfSource.get(sourceId);
      if (frameId && section) frameSection.set(frameId, section);
    }
  }
  // A created object's change key is its plan node id (`rec.ids`); a section's title card is "<group id>::title".
  const keyOfId = new Map(Object.entries(rec.ids).map(([key, id]) => [id, key] as const));
  const created = new Map<string, string>();
  const connects = new Map<string, ChangeTarget[]>();
  for (const c of changes) {
    if (c.kind === "create_block" || c.kind === "create_shape" || c.kind === "create_page") {
      const key = keyOfId.get(c.key) ?? keyOfId.get(c.key.replace(/::title$/, ""));
      if (key) created.set(`created:${c.key}`, key);
    }
    if (c.kind === "create_frame") created.set(`created:${c.key}`, `section ${c.title}`);
    if (c.kind === "connect") connects.set(c.key, [c.from, c.to]);
  }
  const card = (id: string): string => created.get(id) ?? keyOfObject.get(id) ?? (frameSection.has(id) ? `section ${frameSection.get(id)}` : `an object not in the map (${id})`);
  const target = (t: ChangeTarget) => card("existing" in t ? t.existing : `created:${t.created}`);
  return (id: string): string => {
    const link = connects.get(id);
    if (link) return `${target(link[0]!)} → ${target(link[1]!)}`;
    const arrow = byId.get(id);
    if (arrow?.type === "arrow" && arrow.startBinding && arrow.endBinding) return `${card(arrow.startBinding.elementId)} → ${card(arrow.endBinding.elementId)}`;
    return card(id);
  };
}

/** Every key an accepted version put on the canvas (members, the section's own title, its summary). */
function acceptedKeys(plan: unknown): string[] {
  const nodes = (plan as { nodes?: { stableKey?: unknown }[] } | null)?.nodes;
  return Array.isArray(nodes) ? nodes.flatMap((n) => (typeof n?.stableKey === "string" ? [n.stableKey] : [])) : [];
}

function withoutCommit(text: string): string {
  try {
    const { commit: _commit, ...rest } = JSON.parse(text) as Record<string, unknown>;
    return JSON.stringify(rest);
  } catch {
    return text;
  }
}

function dedupeLinks(links: RepoMapLink[]): RepoMapLink[] {
  const seen = new Map<string, RepoMapLink>();
  for (const l of links) {
    const k = `${l.from}\u0000${l.to}\u0000${l.type}`;
    if (!seen.has(k) || l.by) seen.set(k, l);
  }
  return [...seen.values()];
}

/** Where a new section's frame goes: after the last one in its row, or below everything once the row is full. */
function newSectionAnchor(frames: readonly Box[]): { anchor: Box; side: "right" | "below" } {
  if (!frames.length) return { anchor: { x: -64, y: 0, width: 0, height: 0 }, side: "right" };
  const left = Math.min(...frames.map((f) => f.x));
  const top = Math.max(...frames.map((f) => f.y));
  const row = frames.filter((f) => f.y >= top - 1);
  const last = row.reduce((a, f) => (f.x + f.width > a.x + a.width ? f : a));
  if (last.x + last.width - left < SECTIONS_MAX_WIDTH) return { anchor: last, side: "right" };
  const bottom = Math.max(...frames.map((f) => f.y + f.height));
  return { anchor: { x: left, y: bottom, width: 0, height: 0 }, side: "below" };
}

/** A short, stable hash (FNV-1a) — to notice that an edit changed again, without keeping its text. */
function hash(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(36);
}
