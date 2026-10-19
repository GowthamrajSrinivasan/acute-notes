/**
 * What an IDE agent may send to the repo-map tools (F43), and the limits it
 * is held to. Everything it sends is untrusted data: validated here, whole
 * call at a time — a call over any limit, with an unknown node or relation
 * type, a duplicate key or a possible secret is rejected whole, naming the
 * reason, and changes nothing.
 *
 * The SDK checks only the rough shape (`*_SHAPE`, which also documents the
 * tools for the agent); this module does the strict validation, so every
 * rejection says exactly which rule and which key.
 */
import { z } from "zod";
import { GROUP_ARRANGEMENTS, PLAN_SHAPES, type GroupArrangement, type PlanShape } from "@/ai/visual-plan/types";
import { RELATION_TYPES, type RelationType } from "@/domain/types";
import { COMPOSITE_SHAPES_DESCRIBED } from "@/domain/canvas/compositeShapes";
import { LENS_MAX_LEVEL, NODE_KINDS, type ArchitectureKind } from "@/domain/canvas/diagram";
import { findSecret } from "./secrets";

export const REPO_MAP_LIMITS = {
  nodesPerCall: 50,
  /**
   * Primary cards per call: the budget is per iteration, not per map (Wave 1b). Detail cards (the target of an
   * `explained_by` link from a card in the same call) don't count; more primary cards go in child sections (`parent`).
   */
  primaryCardsPerCall: 12,
  textPerNode: 2_000,
  relationshipsPerCall: 100,
  requestBytes: 64 * 1024,
  sectionsPerMap: 60,
  nodesPerMap: 1_500,
  codeLines: 40,
  keyLength: 200,
  statusKeys: 2_000,
  changedPaths: 2_000,
  linksPerCall: 100,
  keysPerRemove: 200,
  pathLength: 500,
} as const;

export const MAP_NODE_TYPES = ["text", "heading", "table", "todo", "shape", "code"] as const;
export type MapNodeType = (typeof MAP_NODE_TYPES)[number];

export type RejectionReason =
  | "limit_exceeded"
  | "map_full"
  | "invalid_input"
  | "unknown_node_type"
  | "unknown_relation_type"
  | "duplicate_key"
  | "possible_secret"
  | "invalid_path"
  | "unknown_parent";

export interface Rejection {
  reason: RejectionReason;
  message: string;
  /** The keys at fault, when the reason is about specific ones. */
  keys?: string[];
}

export class RepoMapRejection extends Error {
  constructor(readonly rejection: Rejection) {
    super(rejection.message);
    this.name = "RepoMapRejection";
  }
}

const reject = (reason: RejectionReason, message: string, keys?: string[]): never => {
  throw new RepoMapRejection({ reason, message, ...(keys?.length ? { keys } : {}) });
};

export interface MapSource {
  path: string;
  lines?: [number, number];
}

/** `kind`: the card's architecture kind (Lens Phase 2): it names the card in Lens and colours a shape. */
export type MapNodeInput = { key: string; title?: string; source?: MapSource; kind?: ArchitectureKind } & (
  | { type: "text"; markdown: string }
  | { type: "heading"; text: string }
  | { type: "table"; columns: string[]; rows: string[][] }
  | { type: "todo"; items: { text: string; checked: boolean }[] }
  | { type: "shape"; shape: PlanShape; label: string }
  | { type: "code"; code: string; language?: string }
);

export interface MapRelationshipInput {
  from: string;
  to: string;
  type: RelationType;
  label?: string;
}

export interface SectionInput {
  commit: string;
  /**
   * `parent`: the key of a card in another section that this section details (a level down). `level`: the section's
   * Lens level (0 System … 4 Operation; Lens Phase 2), else inferred from how deep it is under its parents.
   */
  section: { key: string; label: string; arrangement: GroupArrangement; summary?: string; parent?: string; level?: number };
  nodes: MapNodeInput[];
  relationships: MapRelationshipInput[];
}

// ---------------------------------------------------------------------------
// Shapes the SDK checks (and advertises as the tools' JSON Schema)

const key = z.string().describe("A stable key, 1–200 characters, unique within the map, e.g. mod:<dir>, file:<path>, sym:<path>#<name>.");
const sourceShape = z
  .object({ path: z.string().describe("Repo-relative path, e.g. src/ai/runtime.ts (never absolute)."), lines: z.array(z.number()).optional().describe("[first, last] line.") })
  .optional();

/** Which map a call is for: the `mapId` from begin_repo_map, or the repo name the map was begun with. */
export const MAP_REF = z.string().describe("The mapId from begin_repo_map, or the repo name the map was begun with (e.g. org/name).");

export const SECTION_SHAPE = {
  mapId: MAP_REF,
  commit: z.string().describe("The commit this section describes (e.g. the short SHA)."),
  section: z
    .object({
      key,
      label: z.string().describe("The section's name on its frame, e.g. 'AI runtime'."),
      arrangement: z.string().optional().describe(`How its cards are laid out: ${GROUP_ARRANGEMENTS.join(", ")} (default grid).`),
      summary: z.string().optional().describe("One or two sentences shown under the title."),
      parent: z
        .string()
        .optional()
        .describe("Key of a card, already sent in another section, that this section details one level down (e.g. an overview card). The section is placed under that card's section and linked from the card."),
      level: z
        .number()
        .optional()
        .describe(`The section's Lens level: 0 system, 1 architecture (the overview), 2 components (a module's parts), 3 flow (a handler's steps), 4 operation (functions; give their source lines). Default: one below its parent's section.`),
    })
    .describe("One module of the repo; becomes one frame."),
  nodes: z
    .array(
      z.looseObject({
        key,
        type: z.string().describe(`One of ${MAP_NODE_TYPES.join(", ")}.`),
        title: z.string().optional(),
        markdown: z.string().optional().describe("text: the card's Markdown (short)."),
        text: z.string().optional().describe("heading: its text."),
        columns: z.array(z.string()).optional().describe("table: column names."),
        rows: z.array(z.array(z.string())).optional().describe("table: rows of cells."),
        items: z.array(z.object({ text: z.string(), checked: z.boolean().optional() })).optional().describe("todo: items."),
        shape: z.string().optional().describe(`shape: rectangle, diamond, ellipse, or a diagram shape: ${COMPOSITE_SHAPES_DESCRIBED}.`),
        label: z.string().optional().describe("shape: its label."),
        code: z.string().optional().describe(`code: at most ${REPO_MAP_LIMITS.codeLines} lines.`),
        language: z.string().optional(),
        kind: z.string().optional().describe(`The card's architecture kind, one of ${NODE_KINDS.join(", ")} (endpoint, step, function, event, store for flow and operation levels).`),
        source: sourceShape,
      }),
    )
    .describe(`The section's cards: at most ${REPO_MAP_LIMITS.primaryCardsPerCall} primary cards (detail cards linked explained_by from one of them don't count), ${REPO_MAP_LIMITS.nodesPerCall} in all. Put the rest in child sections (section.parent).`),
  relationships: z
    .array(z.object({ from: z.string(), to: z.string(), type: z.string().describe(`One of ${RELATION_TYPES.join(", ")}.`), label: z.string().optional() }))
    .optional()
    .describe(`Links by key, at most ${REPO_MAP_LIMITS.relationshipsPerCall}; the other end may be in any section, sent or not.`),
};

export const LINKS_SHAPE = {
  mapId: MAP_REF,
  links: z
    .array(z.object({ from: z.string(), to: z.string(), type: z.string().describe(`One of ${RELATION_TYPES.join(", ")}.`), label: z.string().optional() }))
    .describe(`Links by key, at most ${REPO_MAP_LIMITS.linksPerCall}.`),
};

// ---------------------------------------------------------------------------
// Strict validation

const nonEmpty = (max: number) => z.string().trim().min(1).max(max);
const keySchema = z.string().min(1).max(REPO_MAP_LIMITS.keyLength).refine((s) => s.trim() === s && !/[\p{Cc}]/u.test(s), "keys have no surrounding spaces or control characters");
const pathSchema = z.string().min(1).max(REPO_MAP_LIMITS.pathLength);
const lines = z.tuple([z.number().int().min(1), z.number().int().min(1)]).refine(([a, b]) => b >= a, "lines are [first, last]");
const common = { key: keySchema, title: nonEmpty(200).optional(), source: z.object({ path: pathSchema, lines: lines.optional() }).strict().optional(), kind: z.enum(NODE_KINDS).optional() };
const cell = z.string().max(REPO_MAP_LIMITS.textPerNode);

const NODE_SCHEMAS: Record<MapNodeType, z.ZodType> = {
  text: z.object({ ...common, type: z.literal("text"), markdown: nonEmpty(REPO_MAP_LIMITS.textPerNode) }).strict(),
  heading: z.object({ ...common, type: z.literal("heading"), text: nonEmpty(300) }).strict(),
  table: z.object({ ...common, type: z.literal("table"), columns: z.array(cell).min(1).max(30), rows: z.array(z.array(cell).max(30)).max(300) }).strict(),
  todo: z.object({ ...common, type: z.literal("todo"), items: z.array(z.object({ text: nonEmpty(500), checked: z.boolean().optional() }).strict()).min(1).max(100) }).strict(),
  shape: z.object({ ...common, type: z.literal("shape"), shape: z.enum(PLAN_SHAPES).optional(), label: nonEmpty(300) }).strict(),
  code: z.object({ ...common, type: z.literal("code"), code: z.string().min(1).max(REPO_MAP_LIMITS.textPerNode), language: nonEmpty(40).optional() }).strict(),
};

const issues = (e: z.ZodError) => e.issues.map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`).join("; ");

/** Everything a node shows, for the text limit and the secret scan. */
function nodeText(n: MapNodeInput): string {
  const parts = [n.title ?? ""];
  switch (n.type) {
    case "text":
      parts.push(n.markdown);
      break;
    case "heading":
      parts.push(n.text);
      break;
    case "table":
      parts.push(...n.columns, ...n.rows.flat());
      break;
    case "todo":
      parts.push(...n.items.map((i) => i.text));
      break;
    case "shape":
      parts.push(n.label);
      break;
    case "code":
      parts.push(n.code);
      break;
  }
  return parts.join("\n");
}

/** A repo-relative path: no drive, no leading slash, no scheme, no `..` escaping the repo. Normalized to forward slashes. */
export function normalizePath(path: string): string | null {
  const p = path.trim().replace(/\\/g, "/").replace(/^\.\//, "");
  if (!p || p.startsWith("/") || /^[A-Za-z]:/.test(p) || /^[a-z][a-z0-9+.-]*:\/\//i.test(p) || p.split("/").includes("..") || /[\p{Cc}]/u.test(p)) return null;
  return p;
}

function checkRelation(r: Record<string, unknown>, i: number, where: string): MapRelationshipInput {
  if (typeof r.type === "string" && !(RELATION_TYPES as readonly string[]).includes(r.type)) {
    reject("unknown_relation_type", `${where}.${i}: unknown relation type "${r.type.slice(0, 40)}"; use one of ${RELATION_TYPES.join(", ")}.`);
  }
  const parsed = z
    .object({ from: keySchema, to: keySchema, type: z.enum(RELATION_TYPES), label: z.string().trim().min(1).max(200).optional() })
    .strict()
    .safeParse(r);
  if (!parsed.success) reject("invalid_input", `${where}.${i}: ${issues(parsed.error)}`);
  const rel = parsed.data!;
  if (rel.from === rel.to) reject("invalid_input", `${where}.${i}: a key can't be linked to itself.`, [rel.from]);
  return rel;
}

/** Size of the request as sent, in bytes. */
export function requestBytes(args: unknown): number {
  return new TextEncoder().encode(JSON.stringify(args ?? null)).length;
}

/** Strict validation of an `upsert_map_section` call (minus `mapId`); throws `RepoMapRejection`. */
export function parseSectionInput(args: { commit: unknown; section: unknown; nodes: unknown; relationships?: unknown }): SectionInput {
  const L = REPO_MAP_LIMITS;
  if (requestBytes(args) > L.requestBytes) reject("limit_exceeded", `The request is over ${L.requestBytes / 1024} KB (limit: request size); split the section and retry.`);
  const rawNodes = Array.isArray(args.nodes) ? args.nodes : reject("invalid_input", "nodes must be a list.");
  const rawRels = args.relationships === undefined ? [] : Array.isArray(args.relationships) ? args.relationships : reject("invalid_input", "relationships must be a list.");
  if (rawNodes.length > L.nodesPerCall) reject("limit_exceeded", `${rawNodes.length} nodes is over the limit of ${L.nodesPerCall} per call (limit: nodes); split the section and retry.`);
  if (rawRels.length > L.relationshipsPerCall) reject("limit_exceeded", `${rawRels.length} relationships is over the limit of ${L.relationshipsPerCall} per call (limit: relationships).`);

  const commit = z.string().trim().min(1).max(100).safeParse(args.commit);
  if (!commit.success) reject("invalid_input", `commit: ${issues(commit.error)}`);
  const section = z
    .object({ key: keySchema, label: nonEmpty(200), arrangement: z.string().optional(), summary: nonEmpty(L.textPerNode).optional(), parent: keySchema.optional(), level: z.number().int().min(0).max(LENS_MAX_LEVEL - 1).optional() })
    .strict()
    .safeParse(args.section);
  if (!section.success) reject("invalid_input", `section: ${issues(section.error)}`);
  const s = section.data!;
  if (s.arrangement !== undefined && !(GROUP_ARRANGEMENTS as readonly string[]).includes(s.arrangement)) {
    reject("invalid_input", `section.arrangement: "${s.arrangement.slice(0, 40)}" isn't one of ${GROUP_ARRANGEMENTS.join(", ")}.`);
  }

  const nodes: MapNodeInput[] = [];
  const seen = new Set<string>([s.key]);
  rawNodes.forEach((raw, i) => {
    const type = (raw as { type?: unknown } | null)?.type;
    const nodeKey = typeof (raw as { key?: unknown } | null)?.key === "string" ? String((raw as { key: string }).key).slice(0, 200) : `#${i}`;
    if (typeof type !== "string" || !(MAP_NODE_TYPES as readonly string[]).includes(type)) {
      reject("unknown_node_type", `nodes.${i} (${nodeKey}): type "${String(type).slice(0, 40)}" isn't one of ${MAP_NODE_TYPES.join(", ")}.`, [nodeKey]);
    }
    if (isRecord(raw) && isRecord(raw.source) && typeof raw.source.path === "string" && raw.source.path.length <= L.pathLength && !normalizePath(raw.source.path)) {
      reject("invalid_path", `nodes.${i} (${nodeKey}): source.path must be repo-relative (no drive, leading slash, URL or ".."), e.g. src/ai/runtime.ts.`, [nodeKey]);
    }
    const parsed = NODE_SCHEMAS[type as MapNodeType].safeParse(raw);
    if (!parsed.success) {
      const tooLong = parsed.error.issues.some((x) => x.code === "too_big");
      reject(tooLong ? "limit_exceeded" : "invalid_input", `nodes.${i} (${nodeKey}): ${issues(parsed.error)}`, [nodeKey]);
    }
    const node = parsed.data as MapNodeInput & { items?: { text: string; checked?: boolean }[]; shape?: string };
    if (seen.has(node.key)) reject("duplicate_key", `nodes.${i}: the key "${node.key}" is used twice in this call (keys are unique within the map).`, [node.key]);
    seen.add(node.key);
    const text = nodeText(node as MapNodeInput);
    if (text.length > L.textPerNode) reject("limit_exceeded", `nodes.${i} (${node.key}): ${text.length} characters of text is over the limit of ${L.textPerNode} per node (limit: text); shorten it or move detail into explained_by children.`, [node.key]);
    if (node.type === "code" && node.code.split("\n").length > L.codeLines) reject("limit_exceeded", `nodes.${i} (${node.key}): a code node is at most ${L.codeLines} lines (limit: code lines).`, [node.key]);
    if (node.type === "table") {
      const long = node.rows.findIndex((r) => r.length > node.columns.length);
      if (long >= 0) reject("invalid_input", `nodes.${i} (${node.key}): rows.${long} has more cells than there are columns.`, [node.key]);
    }
    const source = node.source ? { path: normalizePath(node.source.path)!, ...(node.source.lines ? { lines: node.source.lines } : {}) } : undefined;
    const normalized = {
      ...node,
      ...(node.type === "todo" ? { items: node.items!.map((it) => ({ text: it.text, checked: it.checked ?? false })) } : {}),
      ...(node.type === "shape" ? { shape: node.shape ?? "rectangle" } : {}),
      ...(source ? { source } : {}),
    } as MapNodeInput;
    nodes.push(normalized);
  });

  const relationships = rawRels.map((r, i) => checkRelation(isRecord(r) ? r : {}, i, "relationships"));
  if (s.parent !== undefined && (s.parent === s.key || nodes.some((n) => n.key === s.parent))) {
    reject("invalid_input", `section.parent: "${s.parent}" is in this section; a parent is a card in another (higher-level) section.`, [s.parent]);
  }

  // The per-iteration budget: primary cards only; detail hangs off them (explained_by) and doesn't count.
  const inCall = new Set(nodes.map((n) => n.key));
  const detail = new Set(relationships.filter((r) => r.type === "explained_by" && inCall.has(r.from) && inCall.has(r.to) && r.from !== r.to).map((r) => r.to));
  const primary = nodes.filter((n) => !detail.has(n.key));
  if (primary.length > L.primaryCardsPerCall) {
    reject(
      "limit_exceeded",
      `${primary.length} primary cards is over the limit of ${L.primaryCardsPerCall} per call (limit: primary cards). Keep the ${L.primaryCardsPerCall} most important here; move detail into explained_by children, or send the rest as child sections with section.parent set to the card they detail.`,
    );
  }

  // The secret backstop, over everything the call would put on the canvas.
  const texts: [string, string][] = [
    [s.key, `${s.label}\n${s.summary ?? ""}`],
    ...nodes.map((n) => [n.key, nodeText(n)] as [string, string]),
    ...relationships.map((r) => [`${r.from}→${r.to}`, r.label ?? ""] as [string, string]),
  ];
  const secrets = texts.flatMap(([k, t]) => {
    const found = findSecret(t);
    return found ? [{ k, found }] : [];
  });
  if (secrets.length) {
    reject(
      "possible_secret",
      `Rejected: ${secrets.map((x) => `${x.k} looks like it contains a secret (${x.found})`).join("; ")}. Never send secret values, credentials or keys; describe them instead ("reads the API key from the environment").`,
      secrets.map((x) => x.k),
    );
  }

  return {
    commit: commit.data!,
    section: {
      key: s.key,
      label: s.label,
      arrangement: (s.arrangement as GroupArrangement | undefined) ?? "grid",
      ...(s.summary ? { summary: s.summary } : {}),
      ...(s.parent ? { parent: s.parent } : {}),
      ...(s.level !== undefined ? { level: s.level } : {}),
    },
    nodes,
    relationships,
  };
}

/** Strict validation of `link_map_nodes`' links. */
export function parseLinks(raw: unknown): MapRelationshipInput[] {
  const list = Array.isArray(raw) ? raw : reject("invalid_input", "links must be a list.");
  if (list.length > REPO_MAP_LIMITS.linksPerCall) reject("limit_exceeded", `${list.length} links is over the limit of ${REPO_MAP_LIMITS.linksPerCall} per call (limit: links).`);
  const links = list.map((r, i) => checkRelation(isRecord(r) ? r : {}, i, "links"));
  const secret = links.find((l) => l.label && findSecret(l.label));
  if (secret) reject("possible_secret", `links: the label of ${secret.from}→${secret.to} looks like it contains a secret.`, [secret.from]);
  return links;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}
