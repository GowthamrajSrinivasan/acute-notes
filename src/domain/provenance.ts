/**
 * Provenance (F25, PRD §5.1): where an object came from and which logical AI
 * operation created it.
 *
 * Descriptive only. Nothing may branch on these fields for editing,
 * rendering, search, sync, export or MCP behaviour. An AI-created object
 * behaves exactly like a manually created one. The few places that read
 * provenance live here: this module describes an object's origin for display
 * and finds the objects of one operation for "View changes". A guard test
 * (`provenanceGuard.test.ts`) fails if any other code compares provenance
 * fields.
 *
 * All provenance is optional and backwards-compatible: an object without it
 * is a user object. `normalize*` is the one gate every read and serialization
 * path uses (canvas elements, document records, workspace import/export,
 * change sets). It keeps only the known fields, with the right types and
 * bounded sizes, so malformed or oversized input, and any field that could
 * carry a secret, never travel with an object.
 */
import type { AIMetadata, DocumentRecord, ObjectId, ObjectMetadata, SourceRef } from "./types";

/** The structural slice of a canvas element read here (no renderer or adapter import). */
export interface ProvenanceElement {
  id: ObjectId;
  type: string;
  isDeleted: boolean;
  containerId?: string | null;
  customData?: Record<string, unknown>;
}

export const PROVENANCE_ORIGINS = ["user", "ai", "import", "mcp"] as const satisfies readonly AIMetadata["createdBy"][];
export const AUTH_TYPES = ["subscription", "api_key", "oauth", "local"] as const satisfies readonly NonNullable<AIMetadata["authType"]>[];

const MAX_TEXT = 200;
const MAX_URL = 2048;
const MAX_SOURCE_REFS = 20;
const MAX_TAGS = 50;

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);
const text = (v: unknown, max = MAX_TEXT): string | undefined => (typeof v === "string" && v.trim() ? v.slice(0, max) : undefined);
const oneOf = <T extends string>(v: unknown, values: readonly T[]): T | undefined => (values.includes(v as T) ? (v as T) : undefined);

/** Only web links: a provenance URL is shown to users, so `javascript:` and the like are dropped. */
function webUrl(v: unknown): string | undefined {
  const s = text(v, MAX_URL);
  if (!s) return undefined;
  try {
    const url = new URL(s);
    return url.protocol === "https:" || url.protocol === "http:" ? url.href : undefined;
  } catch {
    return undefined;
  }
}

function sourceRef(raw: unknown): SourceRef | undefined {
  if (!isObj(raw)) return undefined;
  const provider = text(raw.provider);
  if (!provider) return undefined;
  const externalId = text(raw.externalId, 500);
  const url = webUrl(raw.url);
  const lastSyncedAt = typeof raw.lastSyncedAt === "number" && Number.isFinite(raw.lastSyncedAt) ? raw.lastSyncedAt : undefined;
  return { provider, ...(externalId ? { externalId } : {}), ...(url ? { url } : {}), ...(lastSyncedAt !== undefined ? { lastSyncedAt } : {}) };
}

/**
 * Known provenance fields only; undefined when there is no valid provenance.
 *
 * The reconciliation fields (F37) are dropped unless `reconciliation` is set:
 * every descriptive reader — export, MCP context, the adapter, the Origin
 * section, change-set parsing — goes through this default, so none of them
 * can see (or branch on) those fields. Only the reconciliation engine and the
 * code that stamps/maintains them ask for them (`provenanceGuard.test.ts`).
 */
export function normalizeAIMetadata(raw: unknown, options: { reconciliation?: boolean } = {}): AIMetadata | undefined {
  if (!isObj(raw)) return undefined;
  const createdBy = oneOf(raw.createdBy, PROVENANCE_ORIGINS);
  if (!createdBy) return undefined;
  const out: AIMetadata = { createdBy };
  for (const key of ["operationId", "task", "provider", "model", "template", "visualPlanNodeId"] as const) {
    const v = text(raw[key]);
    if (v) out[key] = v;
  }
  const authType = oneOf(raw.authType, AUTH_TYPES);
  if (authType) out.authType = authType;
  if (Array.isArray(raw.sourceRefs)) {
    const refs = raw.sourceRefs.slice(0, MAX_SOURCE_REFS).map(sourceRef).filter((r): r is SourceRef => !!r);
    if (refs.length) out.sourceRefs = refs;
  }
  if (options.reconciliation) {
    for (const key of ["contentSourceId", "stableNodeKey", "contentFingerprint"] as const) {
      const v = text(raw[key], 300);
      if (v) out[key] = v;
    }
    if (typeof raw.contentSourceVersion === "number" && Number.isInteger(raw.contentSourceVersion) && raw.contentSourceVersion > 0) {
      out.contentSourceVersion = raw.contentSourceVersion;
    }
    if (raw.excludeFromReconciliation === true) out.excludeFromReconciliation = true;
    const splitOf = text(raw.splitOf, 300);
    const splitFingerprint = text(raw.splitFingerprint, 300);
    if (splitOf && splitFingerprint) {
      out.splitOf = splitOf;
      out.splitFingerprint = splitFingerprint;
    }
  }
  return out;
}

/** The reconciliation link of an object's metadata (F37) — present only for Visualize-derived objects. */
export interface ReconciliationLink {
  contentSourceId: string;
  contentSourceVersion: number;
  stableNodeKey: string;
  contentFingerprint: string;
  excludeFromReconciliation: boolean;
  /** A piece of a split block (F42 Phase 4): the node it shows part of, and that node's fingerprint when split. */
  splitOf?: { stableNodeKey: string; fingerprint: string };
}

/**
 * An object's reconciliation link, or undefined for manual objects and any
 * object missing part of it. Read only by the reconciliation engine and the
 * explicit user actions around it (F38/F39).
 */
export function reconciliationOf(el: Pick<ProvenanceElement, "customData">, getDocument: (id: string) => DocumentRecord | null | undefined): ReconciliationLink | undefined {
  const raw = rawAIOf(el, getDocument);
  const ai = normalizeAIMetadata(raw, { reconciliation: true });
  if (!ai?.contentSourceId || !ai.contentSourceVersion || !ai.stableNodeKey || !ai.contentFingerprint) return undefined;
  return {
    contentSourceId: ai.contentSourceId,
    contentSourceVersion: ai.contentSourceVersion,
    stableNodeKey: ai.stableNodeKey,
    contentFingerprint: ai.contentFingerprint,
    excludeFromReconciliation: ai.excludeFromReconciliation === true,
    ...(ai.splitOf && ai.splitFingerprint ? { splitOf: { stableNodeKey: ai.splitOf, fingerprint: ai.splitFingerprint } } : {}),
  };
}

/**
 * The content source a connector was drawn for (F38b), or undefined for a
 * connector the user drew or any other AI change. Connectors carry only the
 * source link, not a node key: they are matched by their two ends.
 */
export function connectorSourceOf(el: Pick<ProvenanceElement, "customData">): string | undefined {
  const ai = normalizeAIMetadata(rawAIOf(el, () => undefined), { reconciliation: true });
  return ai?.contentSourceId;
}

/** Where an object's raw `metadata.ai` lives: its document for blocks/pages, the element otherwise. */
function rawAIOf(el: Pick<ProvenanceElement, "customData">, getDocument: (id: string) => DocumentRecord | null | undefined): unknown {
  const ref = el.customData?.acute;
  if (isObj(ref)) {
    const docId = ref.kind === "rich-block" ? ref.documentId : ref.kind === "page-preview" ? ref.pageId : undefined;
    return typeof docId === "string" ? getDocument(docId)?.metadata?.ai : undefined;
  }
  const meta = el.customData?.acuteMeta;
  return isObj(meta) ? meta.ai : undefined;
}

/** Object metadata (title, tags, source, provenance) with only known, bounded fields. */
export function normalizeObjectMetadata(raw: unknown): ObjectMetadata | undefined {
  if (!isObj(raw)) return undefined;
  const out: ObjectMetadata = {};
  const title = text(raw.title, 500);
  if (title) out.title = title;
  if (Array.isArray(raw.tags)) {
    const tags = raw.tags.slice(0, MAX_TAGS).map((t) => text(t, 100)).filter((t): t is string => !!t);
    if (tags.length) out.tags = tags;
  }
  const source = sourceRef(raw.source);
  if (source) out.source = source;
  const ai = normalizeAIMetadata(raw.ai);
  if (ai) out.ai = ai;
  return Object.keys(out).length ? out : undefined;
}

/**
 * An object's provenance. Blocks and pages keep it on their document record;
 * other objects keep it on the element (`customData.acuteMeta`).
 */
export function provenanceOf(el: Pick<ProvenanceElement, "customData">, getDocument: (id: string) => DocumentRecord | null | undefined): AIMetadata | undefined {
  const ref = el.customData?.acute;
  if (isObj(ref)) {
    const docId = ref.kind === "rich-block" ? ref.documentId : ref.kind === "page-preview" ? ref.pageId : undefined;
    return typeof docId === "string" ? normalizeAIMetadata(getDocument(docId)?.metadata?.ai) : undefined;
  }
  return normalizeObjectMetadata(el.customData?.acuteMeta)?.ai;
}

/**
 * The external records an object was derived from (`sourceRefs`: Repo Map code locations, imports), for display as
 * evidence (Acute Lens, plan §3.3). Descriptive only, like the rest of provenance.
 */
export function sourceRefsOf(el: Pick<ProvenanceElement, "customData">, getDocument: (id: string) => DocumentRecord | null | undefined): SourceRef[] {
  return provenanceOf(el, getDocument)?.sourceRefs ?? [];
}

/**
 * Who an object's evidence came from, for display on Acute Lens's Evidence and L5 card ("you" / "AI" / "your IDE
 * agent", plan §3.3). Imported objects read as the user's own. Descriptive only, like the rest of provenance.
 */
export function evidenceOriginOf(el: Pick<ProvenanceElement, "customData">, getDocument: (id: string) => DocumentRecord | null | undefined): "user" | "ai" | "mcp" {
  const createdBy = provenanceOf(el, getDocument)?.createdBy;
  return createdBy === "ai" || createdBy === "mcp" ? createdBy : "user";
}

/**
 * The Lens identity a Repo Map or Visualize object carries (plan D21, Phase 2): its reconciliation key — for a map node,
 * the agent's own key — so an agent that keeps the key while renaming a function updates the node instead of replacing
 * it. Read only by `domain/lens/identity.ts` (the Lens identity rule, which also applies the copy rule) and listed in
 * `provenanceGuard.test.ts` with its reason. Never a second store: the canvas element carries it, as it carries the rest
 * of its provenance. Undefined for hand-drawn objects.
 */
export function lensIdentityOf(el: Pick<ProvenanceElement, "customData">, getDocument: (id: string) => DocumentRecord | null | undefined): string | undefined {
  return normalizeAIMetadata(rawAIOf(el, getDocument), { reconciliation: true })?.stableNodeKey;
}

/** Live objects created by one AI operation ("View changes"). */
export function objectsFromOperation(
  elements: readonly ProvenanceElement[],
  operationId: string,
  getDocument: (id: string) => DocumentRecord | null | undefined,
): string[] {
  const ids: string[] = [];
  for (const el of elements) {
    if (el.isDeleted || (el.type === "text" && el.containerId)) continue; // labels go with their container
    if (provenanceOf(el, getDocument)?.operationId === operationId) ids.push(el.id);
  }
  return ids;
}

export interface ProvenanceDescription {
  /** "Created by AI", "Imported", "Added by an external agent". */
  origin: string;
  /** "Summarize · GitHub Copilot · gpt-5", when known. */
  detail: string | null;
  operationId: string | null;
}

const ORIGIN_LABELS: Record<Exclude<AIMetadata["createdBy"], "user">, string> = {
  ai: "Created by AI",
  import: "Imported",
  mcp: "Added by an external agent",
};

const TASK_LABELS: Record<string, string> = {
  summarize: "Summarize",
  transform_note: "Turn into tasks",
  generate_note: "Generated note",
  chat: "Chat reply",
  generate_visual_plan: "Visualize",
  split_locally: "Split locally",
};

/**
 * Display text for an object's origin; null for user objects (nothing to
 * show). `connectionName` turns a connection id into its name.
 */
export function describeProvenance(meta: AIMetadata | undefined, connectionName: (id: string) => string | undefined = () => undefined): ProvenanceDescription | null {
  if (!meta || meta.createdBy === "user") return null;
  const parts = [
    meta.task ? (TASK_LABELS[meta.task] ?? meta.task) : undefined,
    meta.provider ? (connectionName(meta.provider) ?? meta.provider) : undefined,
    meta.model,
    meta.template ? `template: ${meta.template}` : undefined,
    meta.sourceRefs?.length ? `from ${meta.sourceRefs.map((r) => r.provider).join(", ")}` : undefined,
  ].filter(Boolean);
  return { origin: ORIGIN_LABELS[meta.createdBy], detail: parts.length ? parts.join(" · ") : null, operationId: meta.operationId ?? null };
}
