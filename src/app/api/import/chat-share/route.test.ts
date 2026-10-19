import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { sharePage } from "@/ai/import/chatShare/__fixtures__/sharePage";
import { POST } from "./route";

const ID = "6ac75678-1111-4111-8111-111111111111";
const post = (json: unknown) =>
  new NextRequest("http://localhost/api/import/chat-share", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(json) });
const html = (body: string, init: ResponseInit = {}) => new Response(body, { status: 200, ...init });

const page = sharePage({
  title: "Setup chat",
  conversationId: "c1",
  messages: [
    { id: "u", role: "user", text: "How do I configure it?", at: 1 },
    { id: "a", role: "assistant", text: "Set api_key = sk-ant-abcdefghijklmnopqrstuvwxyz0123 in the config.", at: 2 },
  ],
});

beforeEach(() => vi.stubEnv("NEXT_PUBLIC_AI_FEATURE", "on"));
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("POST /api/import/chat-share", () => {
  it("returns the transcript with credential-shaped text redacted", async () => {
    const fetchMock = vi.fn().mockResolvedValue(html(page));
    vi.stubGlobal("fetch", fetchMock);
    const res = await POST(post({ url: `https://chat.openai.com/share/${ID}` }));
    expect(res.status).toBe(200);
    const { transcript } = await res.json();
    expect(transcript.title).toBe("Setup chat");
    expect(transcript.turns).toHaveLength(2);
    expect(transcript.turns[1].markdown).not.toContain("abcdefghijklmnop");
    // the canonical ChatGPT URL is what was fetched
    expect(fetchMock.mock.calls[0]![0]).toBe(`https://chatgpt.com/share/${ID}`);
  });

  it("never contacts a host that isn't a supported provider", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    expect((await POST(post({ url: `https://evil.example/share/${ID}` }))).status).toBe(502);
    expect((await POST(post({ url: "http://169.254.169.254/latest/meta-data" }))).status).toBe(502);
    expect((await POST(post({ url: 42 }))).status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("refuses a redirect to another host", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(null, { status: 302, headers: { location: "https://evil.example/x" } })));
    const res = await POST(post({ url: `https://chatgpt.com/share/${ID}` }));
    expect(res.status).toBe(502);
  });

  it("follows a redirect that stays on a supported host", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response(null, { status: 301, headers: { location: `https://chat.openai.com/share/${ID}` } }))
      .mockResolvedValueOnce(html(page));
    vi.stubGlobal("fetch", fetchMock);
    expect((await POST(post({ url: `https://chatgpt.com/share/${ID}` }))).status).toBe(200);
  });

  it("explains a share that doesn't exist", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(html(sharePage(null))));
    const res = await POST(post({ url: `https://chatgpt.com/share/${ID}` }));
    expect(res.status).toBe(404);
    expect((await res.json()).code).toBe("not_found");
  });

  it("is absent when the build has AI off", async () => {
    vi.stubEnv("NEXT_PUBLIC_AI_FEATURE", "off");
    expect((await POST(post({ url: `https://chatgpt.com/share/${ID}` }))).status).toBe(404);
  });
});
