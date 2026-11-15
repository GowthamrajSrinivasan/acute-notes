/**
 * Study Mode Phase 4 (`.ai/docs/study-mode-implementation-plan.md` §6): `get_weak_concepts`, read-only.
 *
 * - **Read-only:** the meta store is reached only through `get` (the deps type has no `set`/`delete`), on the keys of
 *   this connection's own workspace (`study.<workspaceId>` and the shards its index lists). No attempt, flag or setting
 *   can change through MCP. `READ_ANNOTATIONS`.
 * - **Inside the canvas authorization boundary:** every card a concept names is checked against this workspace's scan
 *   (`WorkspaceScan.canvas` refuses another workspace's canvas) and the live scene; anything else is dropped. A
 *   `canvasId` of another workspace is "not found".
 * - **Never returned:** source ids, unit ids, concept keys (an opaque `handle` instead), local and retired concepts,
 *   attempt timestamps other than the last, and passage text (no passages in v1: user decision 2026-11-15).
 * - **Review fields:** `reviewStatus` from the Notes view's snapshot; `unknown` with no snapshot or a snapshot older than
 *   the concept's source version. `verified` is always the literal `false` (OD5: never "verified").
 * - **Bounds:** ≤ 25 concepts, ≤ 3 cards each, about 20k characters of payload (then `truncated`).
 */
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { cyrb53 } from "@/ai/content/fingerprint";
import { isLocalConcept } from "@/ai/study/concept";
import { bandOf, freshAttempts, masteryOf, rankWeak, WEAK_RULE, type Band, type WeakBecause } from "@/ai/study/mastery";
import { readStudyIndex, readStudyShard, studyIndexKey, studyShardKey, type StudyConceptRecord } from "@/ai/study/store";
import type { MetaRepository } from "@/persistence/repositories/types";
import { objectUriOf, type CurrentContext } from "../context/currentContext";
import type { WorkspaceScan } from "../resources/workspaceScan";
import { resourceUri } from "../resources/uris";
import { guarded, plural, READ_ANNOTATIONS, ToolFailure, toolResult } from "./common";

export const STUDY_LIMITS = { defaultResults: 10, maxResults: 25, payloadChars: 20_000, canvases: 50 } as const;

/** The Notes view's own caution, reused (§7.5): a passed check or a strong band is not proof of correctness. */
export const STUDY_CAUTION = "Study results are the reader's own answers. Cards are checked against the source by rules, not by AI: a card that passes isn't proven correct.";

export interface StudyToolDeps {
  scan: WorkspaceScan;
  workspaceId: string;
  currentContext(): Promise<CurrentContext | null>;
  /** Read-only by type: the tool can't write. Absent: the tool says study history isn't available. */
  meta?: Pick<MetaRepository, "get">;
}

export type ReviewStatus = "needs_review" | "no_open_review" | "unknown";

export interface WeakConceptItem {
  handle: string;
  title: string;
  cards: { objectId: string; canvasUri: string; uri?: string }[];
  band: Band;
  mastery: number;
  freshAttempts: number;
  recentAccuracy: number;
  lastAttemptAt: string;
  lastCorrect: boolean;
  weakBecause: WeakBecause;
  state?: "source_changed" | "needs_review";
  reviewStatus: ReviewStatus;
  reviewStatusAsOf?: string;
  verified: false;
}

export interface WeakConceptsResult {
  scope: { workspaceId: string; canvasId?: string };
  rule: typeof WEAK_RULE;
  concepts: WeakConceptItem[];
  counts: { weak: number; studied: number; retiredHidden: number; localHidden: number; needsReviewHidden: number };
  truncated: boolean;
  caution: string;
}

/** The opaque handle: stable for a concept, but reveals no source or unit id. */
export const conceptHandle = (key: string) => `sc_${cyrb53(key)}`;

export function reviewStatusOf(rec: StudyConceptRecord): ReviewStatus {
  if (rec.state === "needs_review") return "needs_review";
  const cs = rec.cardStatus;
  if (!cs) return "unknown";
  if (rec.sourceVersion !== undefined && (cs.version === undefined || cs.version < rec.sourceVersion)) return "unknown";
  return cs.status === "open" ? "needs_review" : "no_open_review";
}

const iso = (ms: number) => new Date(ms).toISOString();
const round2 = (x: number) => Math.round(x * 100) / 100;

/** The tool's work, separate from the transport (tests call it directly too). */
export async function weakConcepts(
  deps: StudyToolDeps,
  input: { canvasId?: string; allCanvases?: boolean; limit?: number; includeNeedsReview?: boolean },
  now: number = Date.now(),
): Promise<WeakConceptsResult> {
  if (!deps.meta) throw new ToolFailure("Study history isn't available in this connection.");
  const meta = deps.meta;
  const canvasId = input.canvasId ?? (input.allCanvases ? undefined : (await deps.currentContext())?.canvas.id);
  if (canvasId && !(await deps.scan.canvas(canvasId))) throw new ToolFailure(`Canvas not found: ${canvasId}`);
  const limit = Math.min(input.limit ?? STUDY_LIMITS.defaultResults, STUDY_LIMITS.maxResults);

  // Everything of this workspace's study history, read through `get` only.
  const index = readStudyIndex(await meta.get<unknown>(studyIndexKey(deps.workspaceId)));
  const records = new Map<string, StudyConceptRecord>();
  for (const shardId of Object.keys(index?.shards ?? {}).sort()) {
    const shard = readStudyShard(await meta.get<unknown>(studyShardKey(deps.workspaceId, shardId)));
    for (const [key, rec] of Object.entries(shard?.concepts ?? {})) records.set(key, rec);
  }

  // Cards: only those still live on a canvas of this workspace.
  const canvasIds = [...new Set([...records.values()].flatMap((r) => (r.cards ?? []).map((c) => c.canvasId)))].sort().slice(0, STUDY_LIMITS.canvases);
  const live = new Map<string, Map<string, ReturnType<typeof objectUriOf>>>();
  for (const id of canvasIds) {
    if (!(await deps.scan.canvas(id))) continue;
    const elements = await deps.scan.scene(id);
    live.set(id, new Map(elements.filter((el) => !el.isDeleted).map((el) => [el.id, objectUriOf(el)] as const)));
  }
  const cardsOf = (rec: StudyConceptRecord) =>
    (rec.cards ?? []).flatMap((c) => {
      const scene = live.get(c.canvasId);
      if (!scene?.has(c.objectId)) return [];
      const uri = scene.get(c.objectId);
      return [{ objectId: c.objectId, canvasUri: resourceUri("canvas", c.canvasId), ...(uri ? { uri } : {}), canvasId: c.canvasId }];
    });

  const counts = { weak: 0, studied: 0, retiredHidden: 0, localHidden: 0, needsReviewHidden: 0 };
  const eligible: Record<string, StudyConceptRecord> = {};
  const cards = new Map<string, ReturnType<typeof cardsOf>>();
  for (const [key, rec] of records) {
    const mine = cardsOf(rec);
    const inScope = canvasId ? (isLocalConcept(key) ? key.startsWith(`l:${canvasId}:`) : mine.some((c) => c.canvasId === canvasId)) : true;
    if (!inScope) continue;
    if (isLocalConcept(key)) {
      counts.localHidden++;
      continue;
    }
    if (rec.state === "retired") {
      counts.retiredHidden++;
      continue;
    }
    counts.studied++;
    eligible[key] = rec;
    cards.set(key, canvasId ? mine.filter((c) => c.canvasId === canvasId) : mine);
  }

  const ranked = rankWeak(eligible, now);
  counts.weak = ranked.length;
  const concepts: WeakConceptItem[] = [];
  let chars = 0;
  let truncated = false;
  for (const w of ranked) {
    const rec = eligible[w.key]!;
    const reviewStatus = reviewStatusOf(rec);
    if (input.includeNeedsReview === false && reviewStatus === "needs_review") {
      counts.needsReviewHidden++;
      continue;
    }
    if (concepts.length >= limit) {
      truncated = true;
      break;
    }
    const fresh = freshAttempts(rec);
    const window = fresh.slice(-WEAK_RULE.window);
    const last = fresh[fresh.length - 1]!;
    const item: WeakConceptItem = {
      handle: conceptHandle(w.key),
      title: rec.title.slice(0, 120) || "Untitled card",
      cards: cards.get(w.key)!.slice(0, 3).map((c) => ({ objectId: c.objectId, canvasUri: c.canvasUri, ...(c.uri ? { uri: c.uri } : {}) })),
      band: bandOf(rec, now, reviewStatus === "needs_review"),
      mastery: round2(masteryOf(rec, now).m),
      freshAttempts: fresh.length,
      recentAccuracy: round2(window.reduce((s, a) => s + a[2], 0) / window.length),
      lastAttemptAt: iso(last[0]),
      lastCorrect: last[2] === 1,
      weakBecause: w.because,
      ...(rec.state === "source_changed" || rec.state === "needs_review" ? { state: rec.state } : {}),
      reviewStatus,
      ...(rec.cardStatus && reviewStatus !== "unknown" ? { reviewStatusAsOf: iso(rec.cardStatus.at) } : {}),
      verified: false,
    };
    const size = JSON.stringify(item).length;
    if (chars + size > STUDY_LIMITS.payloadChars) {
      truncated = true;
      break;
    }
    chars += size;
    concepts.push(item);
  }
  return { scope: { workspaceId: deps.workspaceId, ...(canvasId ? { canvasId } : {}) }, rule: WEAK_RULE, concepts, counts, truncated, caution: STUDY_CAUTION };
}

export function registerStudyTools(server: McpServer, deps: StudyToolDeps): void {
  server.registerTool(
    "get_weak_concepts",
    {
      title: "Get weak concepts",
      description:
        "The concepts the user keeps missing in Study mode (quiz answers and flashcard self-grades, stored on their device), weakest first, " +
        "with the cards that teach each one (read them with get_canvas or the card's uri), mastery, recent accuracy and why it counts as weak " +
        "(`low_accuracy`: under 60% of the last 5; `last_wrong`). `reviewStatus` says whether the teaching card has an open source review " +
        "(`unknown` when not seen since the source changed); `verified` is always false. Defaults to the open canvas, else the whole " +
        "workspace (`allCanvases` for the whole workspace anyway). Read-only: study history can't be changed here. To help the user revise, " +
        "propose new material with create_block, which they review.",
      inputSchema: {
        canvasId: z.string().min(1).max(200).optional().describe("Only concepts taught on this canvas. Defaults to the open canvas."),
        allCanvases: z.boolean().optional().describe("The whole workspace, even when a canvas is open."),
        limit: z.number().int().min(1).max(STUDY_LIMITS.maxResults).optional().describe(`At most this many (default ${STUDY_LIMITS.defaultResults}).`),
        includeNeedsReview: z.boolean().optional().describe("Include concepts whose card needs review (default true; they're marked either way)."),
      },
      annotations: READ_ANNOTATIONS,
    },
    (args) =>
      guarded(async () => {
        const r = await weakConcepts(deps, args);
        const where = r.scope.canvasId ? "on this canvas" : "in this workspace";
        const top = r.concepts
          .slice(0, 5)
          .map((c) => `"${c.title.slice(0, 60)}" (${c.weakBecause === "low_accuracy" ? `${Math.round(c.recentAccuracy * 100)}% recently` : "last answer wrong"}${c.reviewStatus === "needs_review" ? ", card needs review" : ""})`)
          .join("; ");
        const summary = r.counts.weak
          ? `${plural(r.counts.weak, "weak concept")} of ${r.counts.studied} studied ${where}${r.truncated ? ` (showing ${r.concepts.length})` : ""}: ${top}${r.concepts.length > 5 ? "; …" : ""}. ${STUDY_CAUTION}`
          : r.counts.studied
            ? `No weak concepts ${where} (${r.counts.studied} studied).`
            : `Nothing has been studied ${where} yet.`;
        return toolResult(summary, r);
      }),
  );
}
