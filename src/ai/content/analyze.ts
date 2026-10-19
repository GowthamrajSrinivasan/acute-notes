/**
 * `analyzeContent` (F28): the one entry point for turning content into its
 * parse tree and local plan. Visualize (F31), Markdown import and MCP use it.
 *
 * - In the browser it runs in a Web Worker (`contentWorker.ts`), so a large
 *   paste never blocks typing, panning or zooming. Where workers aren't
 *   available (tests, server), or the worker fails to start, it runs in the
 *   current thread instead.
 * - Cancellable: an aborted request rejects with an `AbortError` at once, and
 *   its result is discarded when it arrives.
 * - The size limit is checked before anything is sent to the worker.
 */
import { planLocally, type LocalPlanResult } from "./localPlanner";
import { ContentTooLargeError, MAX_CONTENT_CHARS, parseContent, type ParseOptions } from "./parser";
import type { ParsedContent } from "./types";

export interface ContentAnalysis {
  parsed: ParsedContent;
  /** The local deterministic tier: its plan, and whether AI analysis is needed. */
  local: LocalPlanResult;
}

export interface AnalyzeOptions extends ParseOptions {
  signal?: AbortSignal;
}

/** Parse + local plan in the current thread. */
export async function analyzeInThread(input: string, options: ParseOptions = {}): Promise<ContentAnalysis> {
  const parsed = await parseContent(input, options);
  return { parsed, local: planLocally(parsed, input) };
}

// ---- worker protocol -------------------------------------------------------

export interface AnalyzeRequest {
  id: number;
  input: string;
  options: ParseOptions;
}

export type WorkerReply =
  | { id: number; ok: true; result: ContentAnalysis }
  | { id: number; ok: false; error: { name: string; message: string; length?: number; limit?: number } };

type Pending = { resolve: (r: ContentAnalysis) => void; reject: (e: unknown) => void };

let worker: Worker | null = null;
let workerBroken = false;
let nextId = 1;
const pending = new Map<number, Pending>();

function getWorker(): Worker | null {
  if (workerBroken || typeof Worker === "undefined") return null;
  if (worker) return worker;
  try {
    worker = new Worker(new URL("./contentWorker.ts", import.meta.url), { type: "module", name: "acute-content" });
  } catch {
    workerBroken = true;
    return null;
  }
  worker.onmessage = (e: MessageEvent<WorkerReply>) => {
    const reply = e.data;
    const p = pending.get(reply.id);
    if (!p) return; // cancelled
    pending.delete(reply.id);
    if (reply.ok) p.resolve(reply.result);
    else p.reject(reply.error.name === "ContentTooLargeError" ? new ContentTooLargeError(reply.error.length ?? 0, reply.error.limit) : Object.assign(new Error(reply.error.message), { name: reply.error.name }));
  };
  worker.onerror = (e) => {
    // The worker couldn't load or crashed: finish what was queued in this thread from now on.
    e.preventDefault();
    workerBroken = true;
    worker?.terminate();
    worker = null;
    const queued = [...pending.values()];
    pending.clear();
    for (const p of queued) p.reject(new WorkerUnavailable());
  };
  return worker;
}

class WorkerUnavailable extends Error {}

const abortError = () => new DOMException("Content analysis was cancelled.", "AbortError");

/** Parses content and builds its local plan, off the interaction thread when possible. */
export async function analyzeContent(input: string, options: AnalyzeOptions = {}): Promise<ContentAnalysis> {
  const { signal, ...parseOptions } = options;
  if (signal?.aborted) throw abortError();
  if (input.length > MAX_CONTENT_CHARS) throw new ContentTooLargeError(input.length);
  const w = getWorker();
  if (!w) return withAbort(analyzeInThread(input, parseOptions), signal);
  const id = nextId++;
  const result = new Promise<ContentAnalysis>((resolve, reject) => {
    pending.set(id, { resolve, reject });
    w.postMessage({ id, input, options: parseOptions } satisfies AnalyzeRequest);
  });
  try {
    return await withAbort(result, signal, () => pending.delete(id));
  } catch (err) {
    if (err instanceof WorkerUnavailable) return withAbort(analyzeInThread(input, parseOptions), signal);
    throw err;
  }
}

function withAbort<T>(work: Promise<T>, signal: AbortSignal | undefined, onAbort?: () => void): Promise<T> {
  if (!signal) return work;
  return new Promise<T>((resolve, reject) => {
    const abort = () => {
      onAbort?.();
      reject(abortError());
    };
    signal.addEventListener("abort", abort, { once: true });
    work.then(
      (v) => {
        signal.removeEventListener("abort", abort);
        resolve(v);
      },
      (e: unknown) => {
        signal.removeEventListener("abort", abort);
        reject(e);
      },
    );
  });
}
