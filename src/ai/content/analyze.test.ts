import { describe, expect, it } from "vitest";
import { analyzeContent } from "./analyze";
import { ContentTooLargeError, MAX_CONTENT_CHARS } from "./parser";

// Node has no Web Worker: these exercise the in-thread path the worker also runs.
describe("analyzeContent", () => {
  it("returns the parse tree and the local plan together", async () => {
    const r = await analyzeContent("# Launch\n\n- [ ] Ship\n");
    expect(r.parsed.blocks.map((b) => b.type)).toEqual(["heading", "list"]);
    expect(r.local).toMatchObject({ sufficient: true, plan: { template: "action_plan" } });
  });

  it("honours plain-text format", async () => {
    const r = await analyzeContent("# not a heading", { format: "plain" });
    expect(r.parsed.format).toBe("plain");
    expect(r.parsed.blocks[0]!.type).toBe("paragraph");
  });

  it("is cancellable before and during analysis", async () => {
    const before = new AbortController();
    before.abort();
    await expect(analyzeContent("# A", { signal: before.signal })).rejects.toMatchObject({ name: "AbortError" });
    const during = new AbortController();
    const run = analyzeContent("# A\n\n" + "text ".repeat(5000), { signal: during.signal });
    during.abort();
    await expect(run).rejects.toMatchObject({ name: "AbortError" });
  });

  it("refuses oversized content up front", async () => {
    await expect(analyzeContent("x".repeat(MAX_CONTENT_CHARS + 1))).rejects.toBeInstanceOf(ContentTooLargeError);
  });
});
