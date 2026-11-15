import { describe, expect, it } from "vitest";
import type { CopilotRequestContext } from "@github/copilot-sdk";
import { ATTEMPT_REFUSED_MESSAGE, SingleAttemptRequestHandler } from "./attemptGuard";

/** A guard whose physical send is a spy instead of the SDK's fetch. */
function guard(reply: () => Response = () => new Response("{}", { status: 200 })) {
  const forwarded: Request[] = [];
  class Spy extends SingleAttemptRequestHandler {
    protected override forward(request: Request): Promise<Response> {
      forwarded.push(request);
      return Promise.resolve(reply());
    }
  }
  return { g: new Spy(), forwarded };
}
const ctx = { requestId: "r", transport: "http", url: "http://x.test/v1/chat/completions", headers: {}, signal: new AbortController().signal } as unknown as CopilotRequestContext;
const post = () => new Request("http://x.test/v1/chat/completions", { method: "POST", body: "{}" });

describe("SingleAttemptRequestHandler (§12.29): one physical model request per call", () => {
  it("forwards the first model request unchanged", async () => {
    const { g, forwarded } = guard();
    const res = await g.handle(post(), ctx);
    expect(res.status).toBe(200);
    expect(forwarded).toHaveLength(1);
    expect(g.counts).toEqual({ sent: 1, refused: 0 });
  });

  it("answers every repeat (the runtime's retry) locally with a non-retryable 400 — it never reaches the provider", async () => {
    const { g, forwarded } = guard(() => new Response("{}", { status: 429 }));
    expect((await g.handle(post(), ctx)).status).toBe(429);
    for (let i = 0; i < 5; i++) {
      const res = await g.handle(post(), ctx);
      expect(res.status).toBe(400);
      expect(await res.text()).toContain(ATTEMPT_REFUSED_MESSAGE);
    }
    expect(forwarded).toHaveLength(1);
    expect(g.counts).toEqual({ sent: 1, refused: 5 });
  });

  it("passes non-model requests (GET) through without counting them", async () => {
    const { g, forwarded } = guard();
    await g.handle(new Request("http://x.test/v1/models"), ctx);
    await g.handle(post(), ctx);
    expect(forwarded).toHaveLength(2);
    expect(g.counts).toEqual({ sent: 1, refused: 0 });
  });

  it("refuses WebSocket model transports (a reused connection can't be held to one request): counted, never forwarded", async () => {
    const { g, forwarded } = guard();
    // The SDK's WebSocket handler can only be built inside the SDK (it needs the runtime's response bridge), so here the
    // refusing handler's construction fails — the refusal is counted first and nothing is forwarded either way. The
    // end-to-end WebSocket path is NOT exercised (the consistency check runs over BYOK HTTP only).
    const open = (g as unknown as { openWebSocket(c: CopilotRequestContext): Promise<unknown> }).openWebSocket({ ...ctx, transport: "websocket" } as CopilotRequestContext);
    await expect(open).rejects.toThrow(/bridge/);
    expect(g.counts).toEqual({ sent: 0, refused: 1 });
    expect(forwarded).toHaveLength(0);
  });
});

describe("SingleAttemptRequestHandler wire overrides (§12.30): the cap and temperature the SDK doesn't send", () => {
  function overriding(overrides: ConstructorParameters<typeof SingleAttemptRequestHandler>[0]) {
    const forwarded: Request[] = [];
    class Spy extends SingleAttemptRequestHandler {
      protected override forward(request: Request): Promise<Response> {
        forwarded.push(request);
        return Promise.resolve(new Response("{}"));
      }
    }
    return { g: new Spy(overrides), forwarded };
  }
  const body = (o: unknown) => new Request("http://x.test/v1/chat/completions", { method: "POST", body: JSON.stringify(o), headers: { "content-type": "application/json" } });

  it("writes max_tokens and temperature into the forwarded body, replacing any other cap field", async () => {
    const { g, forwarded } = overriding({ maxTokens: 512, temperature: 0 });
    await g.handle(body({ model: "m", messages: [], temperature: 1, max_completion_tokens: 9999 }), ctx);
    const sent = JSON.parse(await forwarded[0]!.text()) as Record<string, unknown>;
    expect(sent).toMatchObject({ model: "m", max_tokens: 512, temperature: 0 });
    expect(sent).not.toHaveProperty("max_completion_tokens");
    expect(g.applied).toEqual({ maxTokens: 512, temperature: 0, bodyRewritten: true });
  });
  it("no overrides: the request is forwarded untouched", async () => {
    const { g, forwarded } = overriding({});
    const r = body({ model: "m", temperature: 1 });
    await g.handle(r, ctx);
    expect(forwarded[0]).toBe(r);
    expect(g.applied).toBeUndefined();
  });
  it("a body that isn't JSON is forwarded unchanged and recorded as not rewritten", async () => {
    const { g, forwarded } = overriding({ maxTokens: 10 });
    await g.handle(new Request("http://x.test/v1/chat/completions", { method: "POST", body: "not json" }), ctx);
    expect(await forwarded[0]!.text()).toBe("not json");
    expect(g.applied).toEqual({ bodyRewritten: false });
  });
});
