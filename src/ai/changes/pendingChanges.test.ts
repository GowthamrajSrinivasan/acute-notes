import { describe, expect, it } from "vitest";
import type { ChangeSet } from "./changeSet";
import { APP_SESSION, PendingChanges, PendingReviewError, sessionSlot, slotOf } from "./pendingChanges";

const block = (key: string) => ({ kind: "create_block", key, blockType: "text", content: [{ type: "paragraph", content: key }], box: { x: 0, y: 0, width: 100, height: 50 } });
const move = (target: string) => ({ kind: "move", target, to: { x: 1, y: 1 } });
const set = (operationId: string, session: string | undefined, changes: unknown[], title = operationId) => ({
  operationId,
  title,
  metadata: { createdBy: "mcp" },
  ...(session ? { session } : {}),
  changes,
});

describe("PendingChanges: one set per producer session per canvas (D40)", () => {
  it("two sessions stage on one canvas side by side, each reviewed on its own", () => {
    const pending = new PendingChanges();
    pending.propose("cv", set("op_a", "mcp_a", [block("a"), move("x")], "Claude Code: Add block"));
    pending.propose("cv", set("op_b", "mcp_b", [block("b"), move("y")], "Codex: Move"));
    expect(pending.list("cv").map((s) => s.operationId)).toEqual(["op_a", "op_b"]);
    // The latest proposal is selected; the other waits.
    expect(pending.get("cv")?.operationId).toBe("op_b");
    pending.select("cv", "op_a");
    expect(pending.get("cv")?.operationId).toBe("op_a");
    // Accepting (or rejecting) one leaves the other, which becomes the selected one.
    pending.settle("cv", "op_a");
    expect(pending.list("cv").map((s) => s.operationId)).toEqual(["op_b"]);
    expect(pending.get("cv")?.operationId).toBe("op_b");
    expect(pending.inSlot("cv", sessionSlot("mcp_b"))?.operationId).toBe("op_b");
    expect(pending.inSlot("cv", sessionSlot("mcp_a"))).toBeNull();
  });

  it("a set that changes an object another session's set changes is refused, naming that set", () => {
    const pending = new PendingChanges();
    pending.propose("cv", set("op_a", "mcp_a", [move("shared")], "Claude Code: Move object"));
    let error: unknown;
    try {
      pending.propose("cv", set("op_b", "mcp_b", [move("shared")]));
    } catch (err) {
      error = err;
    }
    expect(error).toBeInstanceOf(PendingReviewError);
    expect((error as PendingReviewError).blocking?.operationId).toBe("op_a");
    expect((error as Error).message).toContain("“Claude Code: Move object”");
    expect(pending.list("cv")).toHaveLength(1);
  });

  it("a new proposal in the same session replaces the waiting one, which is reported as expired (D46)", () => {
    const expired: [string, ChangeSet][] = [];
    const pending = new PendingChanges({ onExpired: (canvasId, s) => expired.push([canvasId, s]) });
    pending.propose("cv", set("op_1", undefined, [block("a")]));
    pending.propose("cv", set("op_2", undefined, [block("b")]));
    expect(pending.list("cv").map((s) => s.operationId)).toEqual(["op_2"]);
    expect(expired.map(([c, s]) => [c, s.operationId])).toEqual([["cv", "op_1"]]);
    // In-app sets have no session field: they share the in-app slot.
    expect(slotOf(pending.get("cv")!)).toBe(sessionSlot(APP_SESSION));
    // Settling the replaced one is a no-op; settling isn't expiry.
    pending.settle("cv", "op_1");
    pending.settle("cv", "op_2");
    expect(pending.get("cv")).toBeNull();
    expect(expired).toHaveLength(1);
  });

  it("canvases are independent", () => {
    const pending = new PendingChanges();
    pending.propose("cv_1", set("op_1", "mcp_a", [move("shared")]));
    expect(() => pending.propose("cv_2", set("op_2", "mcp_b", [move("shared")]))).not.toThrow();
  });
});
