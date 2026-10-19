/**
 * "Regenerate" in the Visualize review (content fidelity plan): regenerates only the sections that fell short —
 * reusing the run's outline and every other section's reply as they were — each told which of its points the
 * earlier plan left out. The result is a new change set, proposed in place of the one under review.
 *
 * The runs it can regenerate are kept in memory, for the few most recent Visualize results (a proposal under review
 * lives in this session only): a page reload simply ends the offer.
 */
import { checkProposal } from "@/ai/changes/proposalGeometry";
import type { AIRuntime } from "@/ai/runtime";
import type { SceneElement } from "@/domain/canvas/adapter";
import type { OutlinedReuse, SectionReply } from "@/ai/visualize/outlined";
import type { Outline } from "@/ai/visualize/outline";
import type { VisualizeInput, VisualizeOptions, VisualizeResult } from "@/ai/visualize/types";

interface Regenerable {
  input: Omit<VisualizeInput, "operationId" | "context">;
  outline: Outline;
  replies: ReadonlyMap<string, SectionReply>;
  /** Sections already regenerated once: not offered again (Wave A2). */
  regenerated?: ReadonlySet<string>;
}

const MAX_KEPT = 5;
const runs = new Map<string, Regenerable>();

/** Keeps an outlined run (by its change set's operation id) so its sections can be regenerated. */
export function rememberRun(operationId: string, run: Regenerable): void {
  runs.delete(operationId);
  runs.set(operationId, run);
  while (runs.size > MAX_KEPT) runs.delete(runs.keys().next().value!);
}

export function canRegenerate(operationId: string): boolean {
  return runs.has(operationId);
}

/** The sections of a kept run already regenerated once (empty for an unknown run). */
export function regeneratedSections(operationId: string): ReadonlySet<string> {
  return runs.get(operationId)?.regenerated ?? new Set();
}

/** What a regenerated section is told it missed: the points added from the source, and the exact terms it left out. */
function retryHints(reply: SectionReply | undefined): string[] {
  const c = reply?.coverage;
  if (!c) return [];
  return [...c.added, ...(c.keyTerms.missing.length ? [`Keep these exact terms: ${c.keyTerms.missing.join(", ")}`] : [])];
}

/**
 * Regenerates `sectionKeys` of the run behind `operationId`. Throws when that run is no longer kept (reload, or
 * newer runs pushed it out).
 *
 * It never makes the result worse (content fidelity Wave A2): a section keeps its earlier reply when the new one
 * places less of the source (`visualizeOutlined`), and — given the canvas `scene` — a regenerated section whose
 * layout adds issues (arrow crossings, links through cards…) is put back as it was. That check renders again from
 * the replies at hand, with no AI call.
 */
export async function regenerateSections(
  operationId: string,
  sectionKeys: readonly string[],
  runtime: AIRuntime,
  request: { operationId: string; context: VisualizeInput["context"]; scene?: readonly SceneElement[] },
  options: VisualizeOptions = {},
): Promise<VisualizeResult> {
  const run = runs.get(operationId);
  if (!run) throw new Error("This result can no longer be regenerated. Run Visualize again.");
  const retry = new Map(sectionKeys.map((k) => [k, retryHints(run.replies.get(k))] as const));
  const regenerated = new Set([...(run.regenerated ?? []), ...sectionKeys]);
  const reuse: OutlinedReuse = { outline: run.outline, replies: run.replies, retry, regenerated };
  // Imported here: `visualize.ts` imports this module (to remember runs), so a static import would be circular.
  const { visualizeContent } = await import("@/ai/visualize/visualize");
  const result = await visualizeContent({ ...run.input, operationId: request.operationId, context: request.context }, runtime, { ...options, reuse });

  const fresh = runs.get(result.changeSet.operationId);
  const scene = request.scene;
  const replaced = fresh ? sectionKeys.filter((k) => fresh.replies.get(k) && fresh.replies.get(k)!.raw !== run.replies.get(k)?.raw) : [];
  if (!scene || !fresh || !replaced.length) return result;
  // The same content rendered from other replies, with no AI call: every section is reused.
  const render = (replies: ReadonlyMap<string, SectionReply>, id: string) =>
    visualizeContent({ ...run.input, operationId: id, context: request.context }, runtime, {
      ...(options.parseMarkdown ? { parseMarkdown: options.parseMarkdown } : {}),
      reuse: { outline: run.outline, replies, retry: new Map(), regenerated },
    });
  const probe = async (replies: ReadonlyMap<string, SectionReply>, i: number) => {
    const id = `${request.operationId}~probe${i}`;
    const r = await render(replies, id);
    runs.delete(id);
    return checkProposal(r.changeSet.changes, scene).score;
  };
  const before = await probe(run.replies, 0);
  if (checkProposal(result.changeSet.changes, scene).score <= before) return result;
  // Messier than before: add the regenerated sections back one at a time, each only if the layout stays as clean.
  let chosen = new Map(run.replies);
  let best = before;
  const reverted: string[] = [];
  for (const [i, key] of replaced.entries()) {
    const candidate = new Map(chosen).set(key, fresh.replies.get(key)!);
    const score = await probe(candidate, i + 1);
    if (score <= best) {
      chosen = candidate;
      best = score;
    } else reverted.push(key);
  }
  const final = await render(chosen, request.operationId);
  const label = (key: string) => `"${run.outline.sections.find((s) => s.key === key)?.label ?? key}"`;
  if (reverted.length) final.notices.push(`Kept the earlier version of ${reverted.map(label).join(", ")}: the regenerated one made the layout messier (more crossing arrows).`);
  return final;
}

/** Structure-only runs (content fidelity plan, Wave A), by their change set's operation id: what "Analyse with AI" reruns. */
const inputs = new Map<string, Omit<VisualizeInput, "operationId" | "context">>();

/** Keeps a structure-only run's input so it can be run again with AI. */
export function rememberInput(operationId: string, input: Omit<VisualizeInput, "operationId" | "context">): void {
  inputs.delete(operationId);
  inputs.set(operationId, input);
  while (inputs.size > MAX_KEPT) inputs.delete(inputs.keys().next().value!);
}

export function canRetryWithAI(operationId: string): boolean {
  return inputs.has(operationId);
}

/**
 * Runs a structure-only result's content again with AI: asked even when the local tier judged the content fully
 * explicit (`forceAI`), never local-only. Throws when that run is no longer kept.
 */
export async function retryWithAI(
  operationId: string,
  runtime: AIRuntime,
  request: { operationId: string; context: VisualizeInput["context"] },
  options: VisualizeOptions = {},
): Promise<VisualizeResult> {
  const input = inputs.get(operationId);
  if (!input) throw new Error("This result can no longer be run again. Run Visualize again.");
  const { visualizeContent } = await import("@/ai/visualize/visualize");
  return visualizeContent({ ...input, forceLocalOnly: false, forceAI: true, operationId: request.operationId, context: request.context }, runtime, options);
}
