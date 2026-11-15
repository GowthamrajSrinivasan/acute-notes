/**
 * The claim-level patch contract (intelligent-update-engine-plan Stage 1b): edits inside a block, applied atomically
 * and only when every condition holds. Gate scenarios 1–4 at the engine level; the planner and the end-to-end
 * update cover them again from above (`reconcile/claimPlanner.test.ts`).
 */
import { describe, expect, it } from "vitest";
import type { ContentBlock, RichContent } from "@/domain/types";
import { applyClaimEdits, describeClaimEdit, resolvePatch, type ClaimEdit } from "./claimPatch";

const t = (text: string, styles: Record<string, unknown> = {}) => ({ type: "text" as const, text, styles });
const block = (content: ContentBlock["content"], extra: Partial<ContentBlock> = {}): ContentBlock => ({ id: "b1", type: "paragraph", props: { textColor: "blue" }, content, ...extra });
const edit = (match: ClaimEdit["match"], replacement: string, blockIndex = 0): ClaimEdit => ({ blockIndex, match, replacement });
const ok = (r: ReturnType<typeof applyClaimEdits>): RichContent => {
  if (!r.ok) throw new Error(`rejected: ${r.reason} — ${r.detail}`);
  return r.content;
};

describe("applyClaimEdits — gate 1: a single claim", () => {
  it("replaces one fact; the rest of the paragraph, its id and props are untouched", () => {
    const content = [block("Retries happen five times. The gateway may time out.")];
    const out = ok(applyClaimEdits(content, [edit({ exactText: "five" }, "three")]));
    expect(out).toEqual([{ ...content[0], content: "Retries happen three times. The gateway may time out." }]);
  });

  it("leaves blocks without edits as the same objects", () => {
    const other = block("Untouched.", { id: "b0" });
    const out = ok(applyClaimEdits([other, block("Retries happen five times.")], [edit({ exactText: "five" }, "three", 1)]));
    expect(out[0]).toBe(other);
  });
});

describe("applyClaimEdits — gate 2: several claims, atomically", () => {
  const content = [block("Retries happen five times. Timeouts last ten seconds.")];

  it("applies every edit against the original text", () => {
    const out = ok(applyClaimEdits(content, [edit({ exactText: "ten" }, "thirty"), edit({ exactText: "five" }, "three")]));
    expect(out[0]!.content).toBe("Retries happen three times. Timeouts last thirty seconds.");
  });

  it("applies none when any one fails", () => {
    const r = applyClaimEdits(content, [edit({ exactText: "five" }, "three"), edit({ exactText: "eleven" }, "twelve")]);
    expect(r).toMatchObject({ ok: false, reason: "not_found" });
  });

  it("rejects overlapping edits", () => {
    const r = applyClaimEdits(content, [edit({ exactText: "five times" }, "thrice"), edit({ exactText: "five" }, "three")]);
    expect(r).toMatchObject({ ok: false, reason: "overlap" });
  });

  it("edits in two blocks of one card are one patch", () => {
    const two = [block("Retries happen five times.", { id: "a" }), block("Timeouts last ten seconds.", { id: "b" })];
    const out = ok(applyClaimEdits(two, [edit({ exactText: "five" }, "three", 0), edit({ exactText: "ten" }, "thirty", 1)]));
    expect(out.map((b) => b.content)).toEqual(["Retries happen three times.", "Timeouts last thirty seconds."]);
  });
});

describe("applyClaimEdits — gate 3: rich formatting survives", () => {
  const rich = [
    block([
      t("Retries happen "),
      t("five", { bold: true }),
      t(" times, see "),
      { type: "link" as const, href: "https://x.test/retries", content: [t("the "), t("retry policy", { italic: true })] },
      t(". The gateway "),
      t("may", { textColor: "red" }),
      t(" time out."),
    ]),
  ];

  it("the replacement takes the edited run's marks; every other run, link and colour is kept", () => {
    const out = ok(applyClaimEdits(rich, [edit({ exactText: "five" }, "three")]));
    const was = rich[0]!.content as unknown[];
    expect(out[0]!.content).toEqual([was[0], t("three", { bold: true }), was[2], was[3], was[4], was[5], was[6]]);
    expect(out[0]!.id).toBe("b1");
    expect(out[0]!.props).toEqual({ textColor: "blue" });
  });

  it("edits text inside a link and keeps the link", () => {
    const out = ok(applyClaimEdits(rich, [edit({ exactText: "retry policy" }, "backoff policy")]));
    expect((out[0]!.content as unknown[])[3]).toEqual({ type: "link", href: "https://x.test/retries", content: [t("the "), t("backoff policy", { italic: true })] });
  });

  it("an edit across a link's edge is rejected", () => {
    expect(applyClaimEdits(rich, [edit({ exactText: "see the" }, "per the")])).toMatchObject({ ok: false, reason: "crosses_link" });
  });

  it("an edit that would delete a whole link is rejected", () => {
    expect(applyClaimEdits(rich, [edit({ exactText: "the retry policy" }, "")])).toMatchObject({ ok: false, reason: "crosses_link" });
  });

  it("an edit across two styled runs takes the first run's style", () => {
    const out = ok(applyClaimEdits(rich, [edit({ exactText: "happen five" }, "run")]));
    expect((out[0]!.content as unknown[]).slice(0, 2)).toEqual([t("Retries run"), t(" times, see ")]);
  });
});

describe("applyClaimEdits — matching (rules 2, 4, 5)", () => {
  const content = [block("The cache holds five keys. The queue holds five jobs.")];

  it("an exact text found twice is ambiguous", () => {
    expect(applyClaimEdits(content, [edit({ exactText: "five" }, "six")])).toMatchObject({ ok: false, reason: "ambiguous" });
  });

  it("an anchor with context picks the one place", () => {
    const out = ok(applyClaimEdits(content, [edit({ anchor: { before: "queue holds ", text: "five", after: " jobs" } }, "six")]));
    expect(out[0]!.content).toBe("The cache holds five keys. The queue holds six jobs.");
  });

  it("a range applies where its text is, and is stale when the text moved", () => {
    const at = "The cache holds ".length;
    expect(ok(applyClaimEdits(content, [edit({ range: { start: at, end: at + 4 }, text: "five" }, "nine")]))[0]!.content).toBe("The cache holds nine keys. The queue holds five jobs.");
    expect(applyClaimEdits(content, [edit({ range: { start: at + 1, end: at + 5 }, text: "five" }, "nine")])).toMatchObject({ ok: false, reason: "stale" });
  });

  it("an edit that runs across two sentences would take another claim with it: rejected", () => {
    expect(applyClaimEdits(content, [edit({ exactText: "keys. The queue" }, "keys and the queue")])).toMatchObject({ ok: false, reason: "crosses_claim" });
  });

  it("tables and code are not edited in place (Stage 1d)", () => {
    const code = [{ type: "codeBlock" as const, content: "retries = 5" }];
    expect(applyClaimEdits(code, [edit({ exactText: "5" }, "3")])).toMatchObject({ ok: false, reason: "unsupported" });
  });

  it("a block id that no longer matches is stale; a block without an id (never mounted) is matched by index", () => {
    const one = [block("Retries happen five times.")];
    expect(applyClaimEdits(one, [{ ...edit({ exactText: "five" }, "three"), blockId: "other" }])).toMatchObject({ ok: false, reason: "stale" });
    const noId = [{ type: "paragraph" as const, content: "Retries happen five times." }];
    expect(ok(applyClaimEdits(noId, [{ ...edit({ exactText: "five" }, "three"), blockId: "b1" }]))[0]!.content).toBe("Retries happen three times.");
  });
});

describe("applyClaimEdits: removing one whole sentence (rule 4's exception)", () => {
  const content = [block("Retries happen five times. Backoff doubles each time. Timeouts last ten seconds.")];
  const text = content[0]!.content as string;
  const at = (start: number, end: number) => ({ range: { start, end }, text: text.slice(start, end) });
  const b = "Retries happen five times. ".length;
  const backoff = "Backoff doubles each time. ".length;

  it("removes exactly one sentence with the space after it (or, for the last, before it)", () => {
    expect(ok(applyClaimEdits(content, [edit(at(b, b + backoff), "")]))[0]!.content).toBe("Retries happen five times. Timeouts last ten seconds.");
    expect(ok(applyClaimEdits(content, [edit(at(text.indexOf(" Timeouts"), text.length), "")]))[0]!.content).toBe("Retries happen five times. Backoff doubles each time.");
  });

  it("never more or less than one sentence, and only as a removal", () => {
    expect(applyClaimEdits(content, [edit(at(b - 7, b + backoff), "")])).toMatchObject({ ok: false, reason: "crosses_claim" });
    expect(applyClaimEdits(content, [edit(at(b, b + backoff + "Timeouts".length), "")])).toMatchObject({ ok: false, reason: "crosses_claim" });
    expect(applyClaimEdits(content, [edit(at(b, b + backoff), "Other. ")])).toMatchObject({ ok: false, reason: "crosses_claim" });
  });
});

describe("resolvePatch — gate 4: concurrent modification", () => {
  const content = [block("Retries happen five times.")];
  const patch = { expectedFingerprint: "c_planned", edits: [edit({ exactText: "five" }, "three")] };

  it("applies against the content it was planned for", () => {
    expect(resolvePatch(patch, { content, fingerprint: "c_planned" })).toMatchObject({ ok: true });
  });

  it("rejects content changed since planning, even when the edit would still match", () => {
    expect(resolvePatch(patch, { content, fingerprint: "c_edited" })).toMatchObject({ ok: false, reason: "stale" });
  });

  it("rejects content that isn't loaded", () => {
    expect(resolvePatch(patch, null)).toMatchObject({ ok: false, reason: "stale" });
  });
});

describe("describeClaimEdit", () => {
  it("shows the before and after", () => {
    expect(describeClaimEdit(edit({ exactText: "five" }, "three"))).toBe("“five” → “three”");
    expect(describeClaimEdit({ ...edit({ exactText: "five" }, "three"), intent: "SUPERSEDES" })).toBe("replaces “five” → “three”");
    expect(describeClaimEdit(edit({ anchor: { before: "a ", text: "slow", after: "" } }, ""))).toBe("removes “slow”");
  });

  it("an edit that keeps its words and adds to them shows only what it adds; a word that merely grows doesn't count", () => {
    expect(describeClaimEdit(edit({ exactText: "seconds." }, "seconds. Backoff doubles each time."))).toBe("adds “Backoff doubles each time.”");
    expect(describeClaimEdit(edit({ exactText: "Retries" }, "Each call is logged. Retries"))).toBe("adds “Each call is logged.”");
    expect(describeClaimEdit(edit({ exactText: "five" }, "fivefold"))).toBe("“five” → “fivefold”");
  });
});
