/**
 * Acute Lens's MCP tools (plan §7.1, Phase 3; D41, D43, D55): `get_lens` (the hierarchy, overview first and paged),
 * `trace_lens_path` (the path between two nodes, every hop named), `focus_lens` (opens Lens in the tab: UI only) and
 * `link_lens_detail` (proposes drill links and levels through the `set_lens` change kind), plus the
 * `acute://lens/{lensKey}` resource (the same payload as `get_lens` for that root). Names are the canonical API (D55).
 *
 * Reads build Lens from every canvas (the open one live, the others as persisted) through the pure `domain/lens`
 * readers, over a `SceneSource` (D41); nothing here touches React or the panel. The one write proposes a reviewed
 * change set on the open canvas like every other write (D5, D6).
 */
import { McpServer, ResourceTemplate } from "@modelcontextprotocol/sdk/server/mcp.js";
import { McpError } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import type { ChangeSet, ProposedChange } from "@/ai/changes/changeSet";
import { LENS_LIMITS, LENS_MAX_LEVEL } from "@/domain/canvas/diagram";
import { evidenceByRole } from "@/domain/lens/evidence";
import { lensProfile } from "@/domain/lens/lensProfile";
import { drillTarget, lensFrame, lensRootFrames, lensTree, lensView, type FrameRef, type LensTreeNode, type SceneSource } from "@/domain/lens/lensView";
import { locateInLens } from "@/domain/lens/locate";
import { encodeCursor, pageStart, queryHash, sceneVersion } from "@/domain/lens/paging";
import { findTraceEnd, tracePath, TRACE_KINDS, TRACE_LIMITS, type LensPath, type TraceEnd } from "@/domain/lens/trace";
import { samePath } from "@/domain/project/impact";
import { ancestorsOf, frameLevelOf, frameOf, resolve, type GraphFrame, type GraphNode } from "@/domain/project/workspaceGraph";
import { guarded, READ_ANNOTATIONS, ToolFailure, toolResult, WRITE_ANNOTATIONS } from "./common";
import type { LensFocusHost } from "./lensFocus";
import { loadWorkspace, type Loaded, type ProjectToolDeps } from "./projectTools";
import { PROPOSED_SHAPE, proposeChangeSet, sanitizeClientName, type WriteToolDeps } from "./writeTools";

export const LENS_READ_TOOLS = ["get_lens", "trace_lens_path", "focus_lens"] as const;
export const LENS_WRITE_TOOLS = ["link_lens_detail"] as const;
export const LENS_RESOURCE_TEMPLATE = "acute://lens/{lensKey}";

export const LENS_MCP_LIMITS = { nodes: 2_000, frames: 500, page: 200, pageMax: 500, roots: 100, links: 50, highlight: 50, depth: 5, perRole: 5 } as const;

export interface LensToolDeps extends ProjectToolDeps {
  /** The tab's Lens panel (tab-only, D41); null when no tab hosts one. */
  lensFocus(): LensFocusHost | null;
}

const address = z.string().trim().min(1).max(LENS_LIMITS.key);

/** A `SceneSource` over the loaded workspace: every canvas as read for this call. */
function scenesOf(loaded: Loaded): SceneSource {
  const byId = new Map(loaded.canvases.map((c) => [c.canvasId, c.elements] as const));
  return { elements: (id) => byId.get(id), getDocument: loaded.getDocument };
}

const frameAt = (loaded: Loaded, ref: FrameRef) => loaded.g.frames.find((f) => f.canvasId === ref.canvasId && f.id === ref.frameId);
const canvasTitle = (loaded: Loaded, canvasId: string) => loaded.canvases.find((c) => c.canvasId === canvasId)?.title || undefined;

// ---------------------------------------------------------------------------
// get_lens: the listing
// ---------------------------------------------------------------------------

export interface LensFrameOut {
  key: string;
  title: string;
  canvasId: string;
  level: number;
  /** "L2 Component". */
  levelName: string;
  profile?: string;
  /** The node that drills into this frame. */
  parent?: string;
  nodes: number;
  /** This frame already appears above it (a drill link cycle): not expanded again. */
  loop?: true;
}

export interface LensNodeOut {
  key: string;
  id: string;
  label: string;
  kind?: string;
  /** Its frame's key. */
  frame: string;
  canvasId: string;
  level: number;
  /** The frame zooming into it shows. */
  child?: { frame: string; canvasId: string; via: string };
  /** It has code and no child frame: zooming in shows its source (L5). */
  source?: true;
  /** Code evidence grouped by role (D48): implementation, test, config, doc. */
  evidence?: Partial<Record<string, { path: string; lines?: [number, number]; commit?: string; origin: string }[]>>;
  badge?: string;
  status?: string;
}

export interface LensEdgeOut {
  frame: string;
  from: string;
  to: string;
  relation?: string;
  label?: string;
  explanation?: string;
}

interface Listing {
  frames: LensFrameOut[];
  nodes: LensNodeOut[];
  edges: LensEdgeOut[];
  canvases: Set<string>;
  truncated: boolean;
}

function levelName(profileId: string | undefined, level: number): string {
  const l = lensProfile(profileId as never).levels.find((x) => x.index === level);
  return l ? `${l.short} ${l.name}` : `L${level}`;
}

/** Every frame of `trees` (breadth first, each once) with its nodes and edges, bounded. */
function flatten(loaded: Loaded, trees: readonly { tree: LensTreeNode; parent?: string }[]): Listing {
  const out: Listing = { frames: [], nodes: [], edges: [], canvases: new Set(), truncated: false };
  const seen = new Set<string>();
  const queue = [...trees];
  while (queue.length) {
    const { tree, parent } = queue.shift()!;
    const addr = `${tree.frame.canvasId}/${tree.frame.frameId}`;
    if (seen.has(addr)) continue;
    seen.add(addr);
    if (out.frames.length >= LENS_MCP_LIMITS.frames || out.nodes.length + tree.nodes.length > LENS_MCP_LIMITS.nodes) {
      out.truncated = true;
      continue;
    }
    const gFrame = frameAt(loaded, tree.frame);
    const parentRef = parent ?? loaded.g.drilledFrom.get(addr);
    out.canvases.add(tree.frame.canvasId);
    out.frames.push({
      key: tree.key,
      title: tree.title,
      canvasId: tree.frame.canvasId,
      level: tree.level,
      levelName: levelName(gFrame?.profile, tree.level),
      ...(gFrame?.profile ? { profile: gFrame.profile } : {}),
      ...(parentRef ? { parent: parentRef } : {}),
      nodes: tree.nodes.length,
      ...(tree.loop ? { loop: true as const } : {}),
    });
    const keyOfId = new Map(tree.nodes.map((n) => [n.id, n.key] as const));
    for (const n of tree.nodes) {
      const childTree = n.childFrame && tree.children.find((c) => c.frame.canvasId === n.childFrame!.canvasId && c.frame.frameId === n.childFrame!.frameId);
      const childKey = n.childFrame && (childTree?.key ?? frameAt(loaded, n.childFrame)?.ref ?? n.childFrame.frameId);
      const roles = evidenceByRole(n.evidence);
      out.nodes.push({
        key: n.key,
        id: n.id,
        label: n.label,
        ...(n.semantics.kind ? { kind: n.semantics.kind } : {}),
        frame: tree.key,
        canvasId: tree.frame.canvasId,
        level: tree.level,
        ...(n.childFrame && childKey ? { child: { frame: childKey, canvasId: n.childFrame.canvasId, via: n.childFrame.via } } : {}),
        ...(drillTarget(n) === "source" ? { source: true as const } : {}),
        ...(roles.length
          ? {
              evidence: Object.fromEntries(
                roles.map((r) => [r.role, r.items.slice(0, LENS_MCP_LIMITS.perRole).map((e) => ({ path: e.path!, ...(e.lines ? { lines: e.lines } : {}), ...(e.commit ? { commit: e.commit } : {}), origin: e.origin }))]),
              ),
            }
          : {}),
        ...(n.badge ? { badge: n.badge } : {}),
        ...(n.project?.status ? { status: n.project.status } : {}),
      });
    }
    for (const e of tree.edges) {
      const from = keyOfId.get(e.from);
      const to = keyOfId.get(e.to);
      if (!from || !to) continue;
      out.edges.push({ frame: tree.key, from, to, ...(e.relation ? { relation: e.relation } : {}), ...(e.label ? { label: e.label } : {}), ...(e.explanation ? { explanation: e.explanation } : {}) });
    }
    for (const child of tree.children) {
      const via = tree.nodes.find((n) => n.childFrame?.canvasId === child.frame.canvasId && n.childFrame.frameId === child.frame.frameId);
      queue.push({ tree: child, ...(via ? { parent: via.key } : {}) });
    }
  }
  return out;
}

/** A frame as a one-level tree (no children), for the levels above `around`. */
function levelTree(scenes: SceneSource, loaded: Loaded, f: GraphFrame): LensTreeNode | undefined {
  const lvl = lensFrame(scenes, { canvasId: f.canvasId, frameId: f.id }, frameLevelOf(loaded.g, f));
  return lvl && { frame: lvl.frame, key: lvl.key, title: lvl.title, level: lvl.level, nodes: lvl.nodes, edges: lvl.edges, children: [], loop: false };
}

export interface LensRootOut {
  key: string;
  title: string;
  canvasId: string;
  canvasTitle?: string;
  level: number;
  profile?: string;
}

function rootsOf(loaded: Loaded, canvasIds: readonly string[]): LensRootOut[] {
  const scenes = scenesOf(loaded);
  return canvasIds
    .flatMap((canvasId) =>
      lensRootFrames(scenes, canvasId).map((r) => {
        const f = frameAt(loaded, { canvasId, frameId: r.frameId });
        return { key: f?.ref ?? r.frameId, title: r.title, canvasId, ...(canvasTitle(loaded, canvasId) ? { canvasTitle: canvasTitle(loaded, canvasId)! } : {}), level: r.level, ...(f?.profile ? { profile: f.profile } : {}) };
      }),
    )
    .slice(0, LENS_MCP_LIMITS.roots);
}

export interface GetLensArgs {
  root?: string;
  around?: string;
  up?: number;
  down?: number;
  paths?: string[];
  limit?: number;
  cursor?: string;
}

/** The node or frame an `around` / `focus_lens` address names: a key or id, else a node label. */
function target(loaded: Loaded, text: string): GraphNode | GraphFrame {
  const hit = resolve(loaded.g, text);
  if (hit) {
    if (loaded.g.ambiguous.has(text)) throw new ToolFailure(`The key "${text}" is on more than one object; use its id instead.`);
    return hit;
  }
  const end = findTraceEnd(loaded.g, text);
  if (end.ok) return end.node;
  throw new ToolFailure(endMessage(end));
}

const endMessage = (end: Extract<TraceEnd, { ok: false }>) =>
  `${end.message}${end.candidates.length ? ` Candidates: ${end.candidates.map((c) => `${c.label} (${c.ref})`).join("; ")}.` : ""}`;

type LensRead = { summary: string; payload: Record<string, unknown> };

/** `get_lens` (and `acute://lens/{key}`): what to list, then one page of it. */
export async function readLens(deps: ProjectToolDeps, args: GetLensArgs): Promise<LensRead> {
  const loaded = await loadWorkspace(deps);
  const scenes = scenesOf(loaded);
  const { g } = loaded;
  let listing: Listing;
  let head: Record<string, unknown>;

  if (args.around) {
    const t = target(loaded, args.around);
    const frame = t.what === "frame" ? t : frameOf(g, t);
    if (!frame) throw new ToolFailure(`"${t.what === "node" ? t.label : t.title}" isn't in a frame, so it has no Lens level.`);
    const up = args.up ?? 1;
    const down = args.down ?? 1;
    const lvl = frameLevelOf(g, frame);
    const tree = lensTree(scenes, { canvasId: frame.canvasId, frameId: frame.id }, lvl, new Set(), down);
    if (!tree) throw new ToolFailure(`The frame "${frame.title}" couldn't be read.`);
    // Centred on a node: below it, only its own child level.
    if (t.what === "node") tree.children = tree.children.filter((c) => tree.nodes.some((n) => n.id === t.id && n.childFrame?.canvasId === c.frame.canvasId && n.childFrame.frameId === c.frame.frameId));
    const above = ancestorsOf(g, frame).filter((a): a is GraphFrame => a.what === "frame").slice(0, up).reverse();
    const aboveTrees = above.flatMap((f) => levelTree(scenes, loaded, f) ?? []);
    listing = flatten(loaded, [...aboveTrees.map((tree) => ({ tree })), { tree }]);
    head = { mode: "around", around: { key: t.ref, label: t.what === "node" ? t.label : t.title, what: t.what, frame: frame.ref, level: lvl }, up, down };
  } else {
    let rootFrame: GraphFrame | undefined;
    if (args.root) {
      const hit = resolve(g, args.root);
      if (hit?.what === "frame") rootFrame = hit;
      else if (hit?.what === "node") return readLens(deps, { ...args, root: undefined, around: args.root });
      else {
        const canvas = loaded.canvases.find((c) => c.canvasId === args.root || c.title.trim().toLowerCase() === args.root!.trim().toLowerCase());
        if (!canvas) throw new ToolFailure(`No frame, node or canvas "${args.root}" in this workspace.`);
        const roots = rootsOf(loaded, [canvas.canvasId]);
        if (roots.length !== 1) return rootsRead(loaded, roots, `Canvas "${canvas.title}" has ${roots.length} Lens roots; pass one's key as \`root\`.`);
        rootFrame = resolve(g, roots[0]!.key) as GraphFrame;
      }
    } else {
      const roots = rootsOf(loaded, loaded.canvases.map((c) => c.canvasId));
      if (roots.length !== 1) return rootsRead(loaded, roots, roots.length ? `${roots.length} Lens roots in this workspace; pass one's key as \`root\` (or \`around\` a node).` : "No interactive frames in this workspace yet, so there is no Lens to read.");
      rootFrame = resolve(g, roots[0]!.key) as GraphFrame;
    }
    const tree = lensTree(scenes, { canvasId: rootFrame.canvasId, frameId: rootFrame.id }, frameLevelOf(g, rootFrame));
    if (!tree) throw new ToolFailure(`The frame "${rootFrame.title}" couldn't be read.`);
    listing = flatten(loaded, [{ tree }]);
    head = { mode: "tree", root: { key: tree.key, title: tree.title, canvasId: tree.frame.canvasId, level: tree.level } };
  }

  // "Which nodes cite this file?" (D48): only nodes with matching code evidence, in the frames that hold them.
  if (args.paths?.length) {
    const cites = (n: LensNodeOut) => Object.values(n.evidence ?? {}).some((items) => items?.some((e) => args.paths!.some((p) => samePath(e.path, p))));
    const nodes = listing.nodes.filter(cites);
    const keep = new Set(nodes.map((n) => `${n.frame} ${n.key}`));
    const frames = new Set(nodes.map((n) => n.frame));
    listing = {
      ...listing,
      nodes,
      frames: listing.frames.filter((f) => frames.has(f.key)),
      edges: listing.edges.filter((e) => keep.has(`${e.frame} ${e.from}`) && keep.has(`${e.frame} ${e.to}`)),
    };
  }

  // One page (G2): page 1 carries the frame outline (the overview); every page is cut from the same scene version.
  const version = sceneVersion(loaded.canvases.filter((c) => listing.canvases.has(c.canvasId)));
  const limit = Math.min(args.limit ?? LENS_MCP_LIMITS.page, LENS_MCP_LIMITS.pageMax);
  const query = queryHash({ root: args.root, around: args.around, up: args.up, down: args.down, paths: args.paths, limit });
  const start = pageStart(args.cursor, "lens", version, query);
  if (!start.ok) throw new ToolFailure(start.message);
  const nodes = listing.nodes.slice(start.offset, start.offset + limit);
  const index = new Map(listing.nodes.map((n, i) => [`${n.frame} ${n.key}`, i] as const));
  // An edge is listed on the page holding its later end, so reading every page lists it once.
  const edges = listing.edges.filter((e) => {
    const a = index.get(`${e.frame} ${e.from}`);
    const b = index.get(`${e.frame} ${e.to}`);
    if (a === undefined || b === undefined) return false;
    const later = Math.max(a, b);
    return later >= start.offset && later < start.offset + limit;
  });
  const next = start.offset + limit;
  const payload = {
    kind: "lens",
    version,
    ...head,
    ...(start.offset === 0 ? { frames: listing.frames } : {}),
    nodes,
    edges,
    counts: { frames: listing.frames.length, nodes: listing.nodes.length, edges: listing.edges.length },
    page: { offset: start.offset, limit, ...(next < listing.nodes.length ? { nextCursor: encodeCursor({ k: "lens", v: version, o: next, q: query }) } : {}) },
    truncated: listing.truncated,
    ...(args.paths?.length ? { paths: args.paths, ...(listing.nodes.length ? {} : { note: "No node in this Lens cites those paths (a node's Source field, or a repo map's code locations)." }) } : {}),
  };
  const what = head.mode === "around" ? `around "${(head.around as { label: string }).label}"` : `"${(head.root as { title: string }).title}"`;
  const pageNote = payload.page.nextCursor ? `; nodes ${start.offset + 1}–${start.offset + nodes.length} of ${listing.nodes.length}, more with page.nextCursor` : "";
  return { summary: `Lens ${what}: ${listing.frames.length} level${listing.frames.length === 1 ? "" : "s"}, ${listing.nodes.length} node${listing.nodes.length === 1 ? "" : "s"}${pageNote}${listing.truncated ? " (truncated)" : ""}.`, payload };
}

function rootsRead(loaded: Loaded, roots: LensRootOut[], message: string): LensRead {
  return { summary: message, payload: { kind: "lens-roots", version: sceneVersion(loaded.canvases), roots, message } };
}

// ---------------------------------------------------------------------------
// Registration
// ---------------------------------------------------------------------------

export function registerLensTools(server: McpServer, deps: LensToolDeps): void {
  const client = () => sanitizeClientName(deps.clientName());
  const title = (what: string) => `${client() ?? "MCP"}: ${what}`.slice(0, 200);
  const meta = (task: string): ChangeSet["metadata"] => ({ createdBy: "mcp", task, ...(client() ? { provider: client()! } : {}) });
  const writeDeps: WriteToolDeps = { workspaceId: deps.workspaceId, liveCanvas: deps.liveCanvas, policy: deps.policy, clientName: deps.clientName, sessionId: deps.sessionId };
  const read = <S extends z.ZodRawShape>(name: (typeof LENS_READ_TOOLS)[number], t: string, description: string, inputSchema: S, run: (args: z.infer<z.ZodObject<S>>) => Promise<ReturnType<typeof toolResult>>, idempotent = true) =>
    server.registerTool(name, { title: t, description, inputSchema, annotations: { ...READ_ANNOTATIONS, idempotentHint: idempotent } }, ((args: z.infer<z.ZodObject<S>>) => guarded(() => run(args))) as never);

  read(
    "get_lens",
    "Get lens",
    "Acute Lens's architecture hierarchy (plan §7.1): levels (L0 System … L5 Source) as frames linked by drill links, each with its nodes (key, label, kind, level, the frame it zooms into, code evidence grouped by role: implementation / test / config / doc) and relations. " +
      "`root` (a frame's key or id, or a canvas) lists the whole tree under it; with no root, the workspace's Lens roots (or the only one's tree). " +
      "`around` (a node's or frame's key, id or label) centres on it instead: `up` levels above (default 1), its own level, and `down` levels below it (default 1) — zoom out and in without a second tool. " +
      "`paths` keeps only nodes citing those files (\"which nodes cite this file?\"). " +
      `Overview first, then drill in: page 1 carries every level's outline (\`frames\`) and the first nodes (at most ${LENS_MCP_LIMITS.page}, \`limit\` up to ${LENS_MCP_LIMITS.pageMax}); pass \`page.nextCursor\` as \`cursor\` with the same arguments for more. ` +
      `A cursor is tied to the scene version and refused after an edit. Bounded (≤ ${LENS_MCP_LIMITS.nodes} nodes, \`truncated\`).`,
    {
      root: address.optional(),
      around: address.optional(),
      up: z.number().int().min(0).max(LENS_MCP_LIMITS.depth).optional(),
      down: z.number().int().min(0).max(LENS_MCP_LIMITS.depth).optional(),
      paths: z.array(z.string().trim().min(1).max(LENS_LIMITS.path)).max(20).optional(),
      limit: z.number().int().min(1).max(LENS_MCP_LIMITS.pageMax).optional(),
      cursor: z.string().min(1).max(500).optional(),
    },
    async (args) => {
      if (args.root && args.around) throw new ToolFailure("Pass `root` or `around`, not both.");
      const { summary, payload } = await readLens(deps, args);
      return toolResult(summary, payload);
    },
  );

  read(
    "trace_lens_path",
    "Trace lens path",
    "The shortest path between two nodes across canvases and Lens levels (plan §4), every hop named: the relation it follows (\"Checkout calls Payments\") or the level it crosses (\"Payments contains Webhook handler, zoom in\"), with each stop's code evidence. " +
      "`from` / `to`: a key, id or label. `kind`: dependency, data, execution, or any (default). A path along the arrows wins; only without one may a hop run against its arrow (`forward: false`). " +
      `At most ${TRACE_LIMITS.maxHops} hops; \`found: false\` when there is none.`,
    { from: address, to: address, kind: z.enum(TRACE_KINDS).optional(), maxHops: z.number().int().min(1).max(TRACE_LIMITS.maxHops).optional() },
    async (args) => {
      const { g } = await loadWorkspace(deps);
      const from = findTraceEnd(g, args.from);
      if (!from.ok) throw new ToolFailure(`from: ${endMessage(from)}`);
      const to = findTraceEnd(g, args.to);
      if (!to.ok) throw new ToolFailure(`to: ${endMessage(to)}`);
      const kind = args.kind ?? "any";
      const path: LensPath | undefined = tracePath(g, from.node, to.node, kind, args.maxHops);
      if (!path) {
        const hint = kind === "any" ? "" : " Try kind \"any\".";
        return toolResult(`No ${kind === "any" ? "" : `${kind} `}path from "${from.node.label}" to "${to.node.label}" within ${args.maxHops ?? TRACE_LIMITS.maxHops} hops.${hint}`, {
          found: false,
          kind,
          from: { ref: from.node.ref, label: from.node.label, canvasId: from.node.canvasId },
          to: { ref: to.node.ref, label: to.node.label, canvasId: to.node.canvasId },
        });
      }
      const how = path.hops.length ? (path.directed ? "along the arrows" : "partly against the arrows") : "the same node";
      return toolResult(`Path from "${from.node.label}" to "${to.node.label}" (${path.hops.length} hop${path.hops.length === 1 ? "" : "s"}, ${how}): ${path.hops.map((h) => h.text).join("; ")}.`, { found: true, ...path });
    },
  );

  read(
    "focus_lens",
    "Focus lens",
    "Opens the Lens panel in the user's tab at a node or frame (key, id or label), selects it and highlights `highlight` (node keys, e.g. a trace's stops): the agent's \"look here\". " +
      "`level` zooms out to an ancestor level (or into the node's own detail when it is one below). UI only: it changes nothing in the workspace, so it works with writes off. " +
      "Tab-only: `focused: false` when no tab of this workspace is open.",
    { key: address, level: z.number().int().min(0).max(LENS_MAX_LEVEL).optional(), highlight: z.array(address).max(LENS_MCP_LIMITS.highlight).optional() },
    async (args) => {
      const host = deps.lensFocus();
      if (!host || host.workspaceId !== deps.workspaceId) return toolResult("No tab of this workspace is open, so Lens can't be shown; nothing changed.", { focused: false, reason: "no_tab" });
      const loaded = await loadWorkspace(deps);
      const scenes = scenesOf(loaded);
      const t = target(loaded, args.key);
      const frame = t.what === "frame" ? t : frameOf(loaded.g, t);
      const at = locateInLens(loaded.g, scenes, t);
      if (!frame || !at) throw new ToolFailure(`"${t.what === "node" ? t.label : t.title}" isn't in a frame, so it has no Lens level.`);
      const { root } = at;
      let { path, nodeKey } = at;
      const notes: string[] = [];
      if (args.level !== undefined) {
        const view = lensView(scenes, root, path);
        const current = view?.level ?? frameLevelOf(loaded.g, frame);
        if (args.level < current && view) {
          // Zoom out: the deepest crumb at or above the level asked for, with the node drilled through selected.
          const i = view.crumbs.findLastIndex((c) => c.level <= args.level!);
          if (i >= 0) {
            nodeKey = path[i] ?? null;
            path = path.slice(0, i);
          } else notes.push(`Nothing above L${current} is linked; showing L${current}.`);
        } else if (args.level > current) {
          const node = t.what === "node" ? view?.nodes.find((n) => n.key === t.ref) : undefined;
          if (node && drillTarget(node)) {
            path = [...path, node.key];
            nodeKey = null;
          } else notes.push(`"${t.what === "node" ? t.label : t.title}" has no level below; showing L${current}.`);
        }
      }
      const unresolved: string[] = [];
      const highlight = (args.highlight ?? []).flatMap((h) => {
        const hit = resolve(loaded.g, h);
        if (hit?.what === "node") return [hit.ref];
        unresolved.push(h);
        return [];
      });
      host.focus({ root, path, nodeKey, highlight });
      const shown = lensView(scenes, root, path);
      if (root.canvasId !== host.canvasId) notes.push(`That level is on canvas "${canvasTitle(loaded, root.canvasId) ?? root.canvasId}"; Lens shows it read-only from the open tab.`);
      const payload = {
        focused: true,
        root: { canvasId: root.canvasId, frame: frameAt(loaded, root)?.ref ?? root.frameId },
        path,
        ...(shown ? { level: shown.level, frame: shown.key, title: shown.title } : {}),
        ...(nodeKey ? { node: nodeKey } : {}),
        highlight,
        ...(unresolved.length ? { unresolved } : {}),
        ...(notes.length ? { notes } : {}),
      };
      return toolResult(`Lens opened at "${shown?.title ?? frame.title}"${shown ? ` (${levelName(frame.profile, shown.level)})` : ""}${nodeKey ? `, ${t.what === "node" ? `"${t.label}"` : "a node"} selected` : ""}${highlight.length ? `, ${highlight.length} highlighted` : ""}.${notes.length ? ` ${notes.join(" ")}` : ""}`, payload);
    },
    false,
  );

  server.registerTool(
    "link_lens_detail",
    {
      title: "Link lens detail",
      description:
        "Proposes Lens's hierarchy links on existing objects of the open canvas (plan §7.1, D43): `links` sets which frame zooming into a node shows (`frame`: the frame's key or id, on any canvas; null removes the link), " +
        "`levels` sets a frame's level (0–5 in the architecture profile, 0–1 in a project; null makes it inferred again). Create the nodes and frames themselves with the map or canvas tools; this only links them. " +
        "Proposes a change for the user's review; nothing changes until they accept it. Logged and revertible (revert_agent_changes). Never auto-accepted.",
      inputSchema: {
        links: z.array(z.object({ node: address, frame: address.nullable() })).max(LENS_MCP_LIMITS.links).optional(),
        levels: z.array(z.object({ frame: address, level: z.number().int().min(0).max(LENS_MAX_LEVEL).nullable() })).max(LENS_MCP_LIMITS.links).optional(),
        reason: z.string().trim().min(1).max(500).optional().describe("One line: why (kept with the change in the agent log)."),
      },
      outputSchema: PROPOSED_SHAPE,
      annotations: WRITE_ANNOTATIONS,
    },
    ((args: { links?: { node: string; frame: string | null }[]; levels?: { frame: string; level: number | null }[]; reason?: string }) =>
      guarded(() =>
        proposeChangeSet(writeDeps, args, async (live, operationId) => {
          if (!args.links?.length && !args.levels?.length) throw new ToolFailure("Nothing to change: pass `links` or `levels`.");
          const { g } = await loadWorkspace(deps);
          const problems: string[] = [];
          const warnings: string[] = [];
          const byTarget = new Map<string, Extract<ProposedChange, { kind: "set_lens" }>>();
          const change = (id: string) => byTarget.get(id) ?? byTarget.set(id, { kind: "set_lens", target: id }).get(id)!;
          const onOpen = (what: string, t: GraphNode | GraphFrame) => {
            if (t.canvasId === live.canvasId) return true;
            problems.push(`${what}: on another canvas (${t.canvasId}); changes can only be proposed on the open canvas`);
            return false;
          };
          const liveEl = (id: string) => live.elements().find((e) => e.id === id && !e.isDeleted);

          for (const link of args.links ?? []) {
            const n = resolve(g, link.node);
            if (!n) { problems.push(`${link.node}: no such node`); continue; }
            if (n.what !== "node") { problems.push(`${link.node}: a frame, not a node (\`levels\` sets a frame's level)`); continue; }
            if (g.ambiguous.has(link.node)) { problems.push(`${link.node}: the key is on more than one node; use its id`); continue; }
            if (!onOpen(link.node, n)) continue;
            const current = liveEl(n.id)?.customData?.acuteNode as { expandsTo?: { frameKey: string; canvasId?: string } } | undefined;
            if (link.frame === null) {
              if (!current?.expandsTo) warnings.push(`"${n.label}" has no zoom-in link to remove; skipped`);
              else change(n.id).expandsTo = null;
              continue;
            }
            const f = resolve(g, link.frame);
            if (!f) { problems.push(`${link.frame}: no such frame`); continue; }
            if (f.what !== "frame") { problems.push(`${link.frame}: a node, not a frame — name the frame zooming into "${n.label}" should show`); continue; }
            if (f.canvasId === n.canvasId && f.id === n.frameId) { problems.push(`"${n.label}" can't zoom into its own frame`); continue; }
            const expandsTo = { frameKey: f.key ?? f.id, ...(f.canvasId !== n.canvasId ? { canvasId: f.canvasId } : {}) };
            if (current?.expandsTo?.frameKey === expandsTo.frameKey && (current.expandsTo.canvasId ?? undefined) === expandsTo.canvasId) {
              warnings.push(`"${n.label}" already zooms into "${f.title}"; skipped`);
              continue;
            }
            if (!f.interactive) warnings.push(`"${f.title}" isn't an interactive frame; Lens still drills into it`);
            const own = frameOf(g, n);
            // A cycle when the target already sits above the node's own level.
            if (own && ancestorsOf(g, own).some((a) => a.what === "frame" && a.canvasId === f.canvasId && a.id === f.id)) warnings.push(`"${f.title}" is already above "${n.label}": this makes a drill loop (Lens stops at it)`);
            change(n.id).expandsTo = expandsTo;
          }

          for (const lv of args.levels ?? []) {
            const f = resolve(g, lv.frame);
            if (!f) { problems.push(`${lv.frame}: no such frame`); continue; }
            if (f.what !== "frame") { problems.push(`${lv.frame}: a node — a level belongs to its frame`); continue; }
            if (!onOpen(lv.frame, f)) continue;
            const max = lensProfile(f.profile).levels.at(-1)!.index;
            if (lv.level !== null && lv.level > max) { problems.push(`"${f.title}": level ${lv.level} is past its profile's last level (L${max})`); continue; }
            if ((f.level ?? null) === lv.level) { warnings.push(`"${f.title}" is already ${lv.level === null ? "inferred" : `L${lv.level}`}; skipped`); continue; }
            change(f.id).level = lv.level;
          }

          if (problems.length) throw new ToolFailure(`Nothing was proposed. ${problems.slice(0, 10).join("; ")}.`);
          const changes = [...byTarget.values()];
          if (!changes.length) throw new ToolFailure(`Nothing to change. ${warnings.join("; ")}.`);
          const linkCount = changes.filter((c) => c.expandsTo !== undefined).length;
          const levelCount = changes.filter((c) => c.level !== undefined).length;
          const what = [linkCount && `${linkCount} drill link${linkCount === 1 ? "" : "s"}`, levelCount && `${levelCount} level${levelCount === 1 ? "" : "s"}`].filter(Boolean).join(" and ");
          return { set: { operationId, title: title(`Lens: set ${what}`), metadata: meta("link_lens_detail"), ...(args.reason ? { reason: args.reason } : {}), changes }, warnings };
        }),
      )) as never,
  );
}

/** `acute://lens/{lensKey}`: the same payload as `get_lens` with that root (its first page). */
export function registerLensResource(server: McpServer, deps: ProjectToolDeps): void {
  const RESOURCE_NOT_FOUND = -32002;
  server.registerResource(
    "lens",
    new ResourceTemplate(LENS_RESOURCE_TEMPLATE, {
      list: async () => {
        const loaded = await loadWorkspace(deps);
        return { resources: rootsOf(loaded, loaded.canvases.map((c) => c.canvasId)).map((r) => ({ uri: `acute://lens/${encodeURIComponent(r.key)}`, name: r.title, mimeType: "application/json" })) };
      },
    }),
    { title: "Lens", description: "A Lens root's hierarchy (the same payload as get_lens with that root, first page).", mimeType: "application/json" },
    async (uri, vars) => {
      const raw = Array.isArray(vars.lensKey) ? vars.lensKey[0] : vars.lensKey;
      let key: string | null = null;
      try {
        key = raw ? decodeURIComponent(raw) : null;
      } catch {
        key = null;
      }
      if (!key) throw new McpError(RESOURCE_NOT_FOUND, `Resource not found: ${uri.href}`, { uri: uri.href });
      try {
        const { payload } = await readLens(deps, { root: key });
        return { contents: [{ uri: uri.href, mimeType: "application/json", text: JSON.stringify(payload) }] };
      } catch (err) {
        if (err instanceof ToolFailure) throw new McpError(RESOURCE_NOT_FOUND, err.message, { uri: uri.href });
        throw err;
      }
    },
  );
}
