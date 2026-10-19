import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { AIError } from "@/ai/errors";
import { hostDecide } from "@/ai/host/decisions/hostDecide";
import { POST } from "./route";

vi.mock("@/ai/host/decisions/hostDecide", () => ({ hostDecide: vi.fn() }));

const body = {
  vendor: "jev",
  model: "typesafe/jev-1.13",
  apiKey: "sk-or-secret-key-123456",
  request: { state: { ticket: "t" }, questions: { is_bug: { type: "boolean", instructions: "Is it a defect?" } } },
};
const post = (json: unknown) => new NextRequest("http://localhost/api/ai/decide", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(json) });

beforeEach(() => vi.mocked(hostDecide).mockReset());

describe("POST /api/ai/decide", () => {
  it("returns the host's answers for a valid request, passing the caller's key through", async () => {
    vi.mocked(hostDecide).mockResolvedValueOnce({ answers: { is_bug: { type: "boolean", probability: 0.9 } }, usage: { provider: "openrouter", model: "m" } });
    const res = await POST(post(body));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ answers: { is_bug: { probability: 0.9 } } });
    expect(vi.mocked(hostDecide).mock.calls[0]![0]).toMatchObject({ vendor: "jev", model: "typesafe/jev-1.13", apiKey: "sk-or-secret-key-123456" });
  });

  it("rejects a request with no key (there is no ambient key to use) and one that isn't the expected shape, without calling the vendor", async () => {
    const noKey = await POST(post({ ...body, apiKey: undefined }));
    expect(noKey.status).toBe(401);
    expect((await noKey.json()).kind).toBe("auth");
    expect((await POST(post({ ...body, model: "" }))).status).toBe(400);
    expect((await POST(post({ ...body, request: { state: "x", questions: {} } }))).status).toBe(400);
    expect(hostDecide).not.toHaveBeenCalled();
  });

  it("turns a vendor failure into the AI error response with its fixed text, never the key", async () => {
    vi.mocked(hostDecide).mockRejectedValueOnce(new AIError("rate_limited", "The decision model is rate limited."));
    const res = await POST(post(body));
    expect(res.status).toBe(429);
    const text = JSON.stringify(await res.json());
    expect(text).toContain("rate_limited");
    expect(text).not.toContain("sk-or-secret");
  });
});
