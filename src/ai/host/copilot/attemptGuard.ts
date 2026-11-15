/**
 * One physical model request per call (intelligent-update-engine-plan §12.29, P1).
 *
 * Measured against a local mock provider (copilotRetry.spike.test.ts, @github/copilot-sdk 1.0.14): the Copilot runtime
 * retries a failed model request **5 times** on 429 and on 5xx (6 physical requests for one call; "retried 5 times"),
 * and the SDK exposes no setting to turn that off. A budget reservation must cover exactly one request, so a call that
 * asks for `singleAttempt` gets this handler as the client's `requestHandler` (an SDK hook that receives every outbound
 * model-layer request before it leaves the process):
 * - the first model request (an HTTP POST) is sent, unchanged;
 * - every later one is answered locally with a non-retryable 400 and never reaches the provider;
 * - WebSocket model transports are refused outright: a reused connection can carry several requests the handler can't
 *   tell apart, so it can't guarantee one. (The consistency check only runs over BYOK HTTP connections.)
 * Non-model requests (GET, e.g. a model catalogue) pass through and are not counted.
 *
 * A fresh client is built per call (CopilotHostRuntime), so the counts are per call.
 */
import { CopilotRequestHandler, CopilotWebSocketCloseStatus, CopilotWebSocketHandler, type CopilotRequestContext } from "@github/copilot-sdk";

export const ATTEMPT_REFUSED_MESSAGE = "Acute: single-attempt call: a repeat model request was not sent.";

export interface AttemptCounts {
  /** Model requests that went to the provider. Never more than 1. */
  sent: number;
  /** Repeat (retry, switch, fallback) model requests answered locally instead. */
  refused: number;
}

class RefusedWebSocket extends CopilotWebSocketHandler {
  constructor(context: CopilotRequestContext) {
    super(context);
    queueMicrotask(() => void this.close(new CopilotWebSocketCloseStatus(ATTEMPT_REFUSED_MESSAGE, "single_attempt")).catch(() => undefined));
  }
  sendRequestMessage(): void {
    // Never forwarded.
  }
}

export class SingleAttemptRequestHandler extends CopilotRequestHandler {
  readonly counts: AttemptCounts = { sent: 0, refused: 0 };

  /** The physical send. Overridable in tests; the SDK's default is `fetch(request, { signal })`. */
  protected forward(request: Request, ctx: CopilotRequestContext): Promise<Response> {
    return super.sendRequest(request, ctx);
  }

  protected override async sendRequest(request: Request, ctx: CopilotRequestContext): Promise<Response> {
    if (request.method.toUpperCase() !== "POST") return this.forward(request, ctx);
    if (this.counts.sent >= 1) {
      this.counts.refused++;
      return new Response(JSON.stringify({ error: { message: ATTEMPT_REFUSED_MESSAGE, type: "invalid_request_error", code: "single_attempt" } }), {
        status: 400,
        headers: { "content-type": "application/json" },
      });
    }
    this.counts.sent++;
    return this.forward(request, ctx);
  }

  protected override async openWebSocket(ctx: CopilotRequestContext): Promise<CopilotWebSocketHandler> {
    this.counts.refused++;
    return new RefusedWebSocket(ctx);
  }

  /** Test seam: the hooks are protected in the SDK. */
  handle(request: Request, ctx: CopilotRequestContext): Promise<Response> {
    return this.sendRequest(request, ctx);
  }
}
