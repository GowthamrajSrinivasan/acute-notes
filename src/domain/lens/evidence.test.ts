import { describe, expect, it } from "vitest";
import { formatRepoRef } from "@/domain/sourceRef";
import { codeEvidence, evidenceByRole, lensEvidence } from "./evidence";

const canvas = { canvasId: "c1", label: "Ops · updateStatus" };

describe("lensEvidence", () => {
  it("always includes the canvas element itself", () => {
    expect(lensEvidence({ id: "n1" }, canvas)).toEqual([{ source: "canvas", label: "Ops · updateStatus", ref: { canvasId: "c1", elementId: "n1" }, origin: "user" }]);
  });

  it("reads user-entered sources with their role, as the user's", () => {
    const el = { id: "n1", customData: { acuteNode: { sources: [{ path: "a.ts", lines: [3, 3], commit: "abc1234", role: "test" }] } } };
    expect(lensEvidence(el, canvas)[0]).toEqual({ source: "code", label: "a.ts:3", path: "a.ts", lines: [3, 3], commit: "abc1234", role: "test", origin: "user" });
  });

  it("parses agent repo refs, marks their origin, and lists a duplicate of a user source once", () => {
    const el = {
      id: "n1",
      customData: {
        acuteNode: { sources: [{ path: "a.ts", lines: [1, 9] }] },
        acuteMeta: { ai: { createdBy: "mcp", sourceRefs: [formatRepoRef("a.ts", [1, 9], "abc1234"), formatRepoRef("b.ts", [5, 8], "def5678"), { provider: "notion", externalId: "page-1", url: "https://example.com/p" }] } },
      },
    };
    const ev = lensEvidence(el, canvas);
    expect(ev.map((e) => [e.source, e.label, e.origin])).toEqual([
      ["code", "a.ts:1-9", "user"],
      ["code", "b.ts:5-8", "mcp"],
      ["document", "notion · page-1", "mcp"],
      ["canvas", "Ops · updateStatus", "mcp"],
    ]);
    expect(ev[2]?.url).toBe("https://example.com/p");
  });

  it("drops malformed sources and roles", () => {
    const el = { id: "n1", customData: { acuteNode: { sources: [{ path: "" }, { path: "ok.ts", lines: [9, 2], role: "bogus" }] } } };
    expect(codeEvidence(lensEvidence(el, canvas))).toEqual([{ source: "code", label: "ok.ts", path: "ok.ts", origin: "user" }]);
  });
});

describe("evidenceByRole", () => {
  it("groups code by role in a fixed order, unroled code as implementation", () => {
    const el = { id: "n1", customData: { acuteNode: { sources: [{ path: "t.test.ts", role: "test" }, { path: "a.ts" }, { path: "README.md", role: "doc" }] } } };
    expect(evidenceByRole(lensEvidence(el, canvas)).map((g) => [g.role, g.items.map((i) => i.path)])).toEqual([
      ["implementation", ["a.ts"]],
      ["test", ["t.test.ts"]],
      ["doc", ["README.md"]],
    ]);
  });
});
