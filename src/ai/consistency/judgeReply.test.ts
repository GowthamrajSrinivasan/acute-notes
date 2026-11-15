/**
 * Plan §12.23, fixes A–C, replayed offline on the unseen3 recording's own replies (`unseen3/runs/2026-11-14-unseen3/`).
 * No model call. The recording and its scores stay as they were: this file checks their hashes first, so a replay can
 * never be mistaken for, or overwrite, the historical measurement (63 % final, 51 % strict recall).
 */
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { judgeConsistencyTask } from "./judge";
import { endsInsideJson, readJudgeReply } from "./judgeReply";

const ROOT = join(fileURLToPath(new URL(".", import.meta.url)), "../../..");
const SET = join(ROOT, "evaluation/update-engine/consistency/unseen3");
const RUN = join(SET, "runs/2026-11-14-unseen3");
const sha = (p: string) => createHash("sha256").update(readFileSync(p)).digest("hex");

interface RecordedCall {
  n: number;
  keys: string[];
  status: "ok" | "truncated" | "unreadable";
  raw: string;
}
const calls = () => Object.values(JSON.parse(readFileSync(join(RUN, "calls.json"), "utf8")) as Record<string, RecordedCall>);
const judgments = () => JSON.parse(readFileSync(join(RUN, "judgments.json"), "utf8")) as Record<string, { answer: string; why?: string; suggestion?: string; call: number }>;

describe("§12.23 — the historical recording is untouched", () => {
  it("calls, judgments, report and routing keep the hashes they were recorded with", () => {
    expect({
      calls: sha(join(RUN, "calls.json")),
      judgments: sha(join(RUN, "judgments.json")),
      report: sha(join(RUN, "report.md")),
      routing: sha(join(RUN, "routing.json")),
    }).toEqual({
      calls: "39e9837c15d57fd342bf1075600113c7e8ccc2cb834496f65352f93af6380697",
      judgments: "37e9e70c7dc6593d3dc521675c4f204b18c8e1a41b982456d6c4214abacd51e7",
      report: "fe550796361bc9e2ee56520cba2db9e36ce379ab044156c487785ae15a314347",
      routing: "e56f8693af77837cd93c36c84f7d0646686a743419d40effd7ca6f8151fa491b",
    });
  });

  it("the frozen parser it ran is preserved, with the line that rejected `null`", () => {
    const frozen = readFileSync(join(SET, "frozen-code/src/ai/consistency/judge.ts.txt"), "utf8");
    expect(frozen).toContain("suggestion: z.string().max(300).optional()");
  });
});

describe("§12.23 fix A — the response contract: null reads as absent, nothing else is loosened", () => {
  it("replays the rejected call (call 5): the recording marked it unreadable; it now gives 10 validated answers", () => {
    const c = calls().find((x) => x.status === "unreadable")!;
    expect(c.raw).toContain('"suggestion": null');
    expect(c.keys.some((k) => k in judgments())).toBe(false); // historically: no answer recorded for any of its pairs
    const r = readJudgeReply(c.raw, c.keys);
    expect(r.status).toBe("ok");
    expect([...r.pairs.values()].every((p) => p.state === "classified")).toBe(true);
    // A null suggestion is simply absent; a real one is kept.
    const outcomes = [...r.pairs.values()].filter((p) => p.state === "classified");
    expect(outcomes.some((p) => !("suggestion" in p))).toBe(true);
    // The whole-reply schema now accepts it too.
    expect(judgeConsistencyTask.outputSchema.safeParse(JSON.parse(c.raw)).success).toBe(true);
  });

  it("still rejects what is genuinely malformed: a wrong type, an over-long line, an unknown answer, a missing ref", () => {
    const schema = judgeConsistencyTask.outputSchema;
    expect(schema.safeParse({ results: [{ ref: "p1", answer: "compatible", why: null, suggestion: null }] }).success).toBe(true);
    expect(schema.safeParse({ results: [{ ref: "p1", answer: "compatible", why: 42 }] }).success).toBe(false);
    expect(schema.safeParse({ results: [{ ref: "p1", answer: "compatible", why: "x".repeat(401) }] }).success).toBe(false);
    expect(schema.safeParse({ results: [{ ref: "p1", answer: "maybe" }] }).success).toBe(false);
    expect(schema.safeParse({ results: [{ answer: "compatible" }] }).success).toBe(false);
  });
});

describe("§12.23 fix B — a cut-off reply is explicit, never fabricated", () => {
  it("replays the truncated call (call 3): every pair fails as truncated — none classified, none compatible", () => {
    const c = calls().find((x) => x.status === "truncated")!;
    for (const finishReason of ["length", undefined]) {
      const r = readJudgeReply(c.raw, c.keys, { finishReason });
      expect(r.status).toBe("truncated");
      expect(r.pairs.size).toBe(10);
      for (const p of r.pairs.values()) expect(p).toMatchObject({ state: "failed", reason: "truncated" });
    }
    expect(endsInsideJson(c.raw)).toBe(true);
  });

  it("a complete reply the provider says was cut off still counts as truncated (its completeness can't be trusted)", () => {
    const raw = JSON.stringify({ results: [{ ref: "p1", answer: "compatible" }] });
    expect(readJudgeReply(raw, ["k1"], { finishReason: "length" }).status).toBe("truncated");
    expect(readJudgeReply(raw, ["k1"], { finishReason: "stop" }).status).toBe("ok");
  });
});

describe("§12.23 fix C — per-pair outcomes", () => {
  it("replays the six good calls: exactly the recorded judgments, pair for pair (no regression)", () => {
    const recorded = judgments();
    let n = 0;
    for (const c of calls().filter((x) => x.status === "ok")) {
      const r = readJudgeReply(c.raw, c.keys, { finishReason: "stop" });
      expect(r.status, `call ${c.n}`).toBe("ok");
      for (const [key, p] of r.pairs) {
        n++;
        expect(p.state).toBe("classified");
        if (p.state === "classified") expect({ answer: p.answer, why: p.why }).toEqual({ answer: recorded[key]!.answer, why: recorded[key]!.why });
      }
    }
    expect(n).toBe(60);
  });

  it("one bad item fails only its own pair; missing and doubled answers fail theirs; unknown refs are counted", () => {
    const raw = JSON.stringify({
      results: [
        { ref: "p1", answer: "contradicts", why: "x", suggestion: "check" },
        { ref: "p2", answer: "nonsense" },
        { ref: "p4", answer: "compatible" },
        { ref: "p4", answer: "contradicts" },
        { ref: "p9", answer: "compatible" },
      ],
    });
    const r = readJudgeReply(raw, ["a", "b", "c", "d"]);
    expect(r.status).toBe("partial");
    expect(r.pairs.get("a")).toEqual({ state: "classified", answer: "contradicts", why: "x", suggestion: "check" });
    expect(r.pairs.get("b")).toMatchObject({ state: "failed", reason: "invalid_answer" });
    expect(r.pairs.get("c")).toMatchObject({ state: "failed", reason: "missing_answer" });
    expect(r.pairs.get("d")).toMatchObject({ state: "failed", reason: "duplicate_answer" });
    expect(r.unknownRefs).toBe(1);
  });

  it("an unreadable reply fails every pair; nothing is guessed", () => {
    for (const raw of ["I think they all agree.", '{"answer":"compatible"}', ""]) {
      const r = readJudgeReply(raw, ["a", "b"]);
      expect(r.status).toBe("unreadable");
      for (const p of r.pairs.values()) expect(p).toMatchObject({ state: "failed", reason: "unreadable" });
    }
  });
});
