/**
 * Web Worker entry for content analysis (F28): parsing takes > 16 ms from
 * about 2k characters (≈ 25 ms at 5k, ≈ 250 ms at 50k in profiling), so it
 * runs here, off the canvas's interaction thread. See `analyzeContent`.
 */
import { analyzeInThread, type AnalyzeRequest, type WorkerReply } from "./analyze";

self.onmessage = async (e: MessageEvent<AnalyzeRequest>) => {
  const { id } = e.data;
  let reply: WorkerReply;
  try {
    reply = { id, ok: true, result: await analyzeInThread(e.data.input, e.data.options) };
  } catch (err) {
    const error = err as Error & { length?: number; limit?: number };
    reply = { id, ok: false, error: { name: error.name, message: error.message, ...(error.length !== undefined ? { length: error.length, limit: error.limit } : {}) } };
  }
  (self as unknown as Worker).postMessage(reply);
};
