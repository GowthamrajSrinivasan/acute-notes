import { NextRequest } from "next/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { GET } from "./route";

const TARGET = "/api/embed/check?url=" + encodeURIComponent("http://169.254.169.254/latest/meta-data/");

function req(headers: Record<string, string>): NextRequest {
  return new NextRequest(`http://localhost:3000${TARGET}`, { headers });
}

describe("/api/embed/check is local-only (defence in depth behind src/proxy.ts)", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it.each([
    ["ngrok Host", { host: "abc.ngrok-free.app" }],
    ["x-forwarded-for", { host: "localhost:3000", "x-forwarded-for": "203.0.113.7" }],
    ["x-forwarded-host", { host: "localhost:3000", "x-forwarded-host": "abc.ngrok-free.app" }],
    ["forwarded", { host: "localhost:3000", forwarded: "for=203.0.113.7" }],
    ["LAN Host", { host: "192.168.31.30:3000" }],
  ])("%s: 404 and no server-side fetch", async (_label, headers) => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    const res = await GET(req(headers));
    expect(res.status).toBe(404);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("a local request still runs the check", async () => {
    const fetchSpy = vi.fn(async () => new Response("", { headers: { "x-frame-options": "DENY" } }));
    vi.stubGlobal("fetch", fetchSpy);
    const res = await GET(req({ host: "localhost:3000", "x-forwarded-for": "127.0.0.1" }));
    expect(res.status).toBe(200);
    expect(fetchSpy).toHaveBeenCalledOnce();
    expect(((await res.json()) as { xFrameOptions: string }).xFrameOptions).toBe("DENY");
  });

  it("ACUTE_HTTP_EXPOSURE=public keeps the hosted app's check working", async () => {
    vi.stubEnv("ACUTE_HTTP_EXPOSURE", "public");
    const fetchSpy = vi.fn(async () => new Response(""));
    vi.stubGlobal("fetch", fetchSpy);
    const res = await GET(req({ host: "acute-notes.example" }));
    expect(res.status).toBe(200);
    expect(fetchSpy).toHaveBeenCalledOnce();
  });
});
