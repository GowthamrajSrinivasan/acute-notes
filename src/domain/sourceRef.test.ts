import { describe, expect, it } from "vitest";
import { formatRepoRef, parseLineRange, parseRepoRef } from "./sourceRef";

describe("repo source references", () => {
  it("round-trips a path with and without a line range", () => {
    expect(formatRepoRef("src/payment.service.ts", [143, 158], "abc123")).toEqual({ provider: "repo", externalId: "src/payment.service.ts#L143-158@abc123" });
    expect(parseRepoRef(formatRepoRef("src/payment.service.ts", [143, 158], "abc123"))).toEqual({ path: "src/payment.service.ts", lines: [143, 158], commit: "abc123" });
    expect(parseRepoRef(formatRepoRef("README.md", undefined, "HEAD"))).toEqual({ path: "README.md", commit: "HEAD" });
  });

  it("rejects refs that aren't well-formed repo refs", () => {
    expect(parseRepoRef({ provider: "github", externalId: "a.ts@abc" })).toBeUndefined();
    expect(parseRepoRef({ provider: "repo" })).toBeUndefined();
    expect(parseRepoRef({ provider: "repo", externalId: "a.ts" })).toBeUndefined();
    expect(parseRepoRef({ provider: "repo", externalId: "@abc" })).toBeUndefined();
  });

  it("keeps the path but drops an impossible line range", () => {
    expect(parseRepoRef({ provider: "repo", externalId: "a.ts#L9-3@abc" })).toEqual({ path: "a.ts", commit: "abc" });
    expect(parseRepoRef({ provider: "repo", externalId: "a.ts#L0-3@abc" })).toEqual({ path: "a.ts", commit: "abc" });
  });
});

describe("parseLineRange", () => {
  it("reads one line or a range, and rejects the rest", () => {
    expect(parseLineRange("")).toBeUndefined();
    expect(parseLineRange(" 143 ")).toEqual([143, 143]);
    expect(parseLineRange("143-158")).toEqual([143, 158]);
    expect(parseLineRange("143 – 158")).toEqual([143, 158]);
    expect(parseLineRange("158-143")).toBeNull();
    expect(parseLineRange("0")).toBeNull();
    expect(parseLineRange("L5")).toBeNull();
  });
});
