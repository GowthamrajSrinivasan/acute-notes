/**
 * Counts model requests as they leave the process (§12.29), BELOW fetch: Node's fetch is undici, which publishes every
 * request it creates — including any redirect or retry it might make — on the `undici:request:create` diagnostics
 * channel. Only POSTs whose path ends in `/chat/completions` count (a model catalogue GET is not a model request).
 * Used by the reliability runner as an independent check of the transport's own count.
 */
import diagnostics from "node:diagnostics_channel";

export interface WireCounter {
  count(): number;
  dispose(): void;
}

export function countModelRequestsOnTheWire(pathSuffix = "/chat/completions"): WireCounter {
  let n = 0;
  const channel = diagnostics.channel("undici:request:create");
  const onMessage = (message: unknown) => {
    const request = (message as { request?: { method?: string; path?: string } }).request;
    if (request?.method?.toUpperCase() === "POST" && (request.path ?? "").split("?")[0]!.endsWith(pathSuffix)) n++;
  };
  channel.subscribe(onMessage);
  return { count: () => n, dispose: () => void channel.unsubscribe(onMessage) };
}
