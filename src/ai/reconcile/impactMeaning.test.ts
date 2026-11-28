/**
 * #14 (intelligent-update-engine-plan §19.6): impact discovery reads meaning when the local model is running. A stand-in
 * embedder whose vectors are the topics a sentence mentions makes "about the same thing" exact, so these tests check the
 * rules, not the model (`impactMeaning.model.test.ts` checks the model's thresholds).
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ChangeSet } from "@/ai/changes/changeSet";
import { fingerprintContent } from "@/ai/content/fingerprint";
import { ingestContent, type IngestPorts } from "@/ai/ingest/ingest";
import type { ClaimThresholds, EmbeddingProvider } from "@/ai/router/embeddingProvider";
import type { SceneElement } from "@/domain/canvas/adapter";
import { withLock } from "@/domain/canvas/lock";
import type { DocumentRecord, RichContent } from "@/domain/types";
import type { ContentSourceRepository } from "@/persistence/repositories/types";
import { accepted, context, firstRun, parse, response, runtimeWith, type Accepted } from "@/testUtils/reconcileHarness";
import { discoverImpact, type ImpactInput } from "./impact";
import { claimVerdict, discoverImpactByMeaning, judgeClaims } from "./impactMeaning";
import { updateFromNewContent } from "./update";
import { DEFAULT_UPDATE_POLICY } from "./updatePolicy";

const LIMITS_TEXT = "Retries happen five times. Timeouts last ten seconds.";
const DOC = `# Service\n\n## Limits\n\n${LIMITS_TEXT}\n\n## Owners\n\nPayments team.\n`;
const LIMITS = "Service › Limits#text0";
const FIVE_TO_THREE = DOC.replace("five times", "three times");
const { runtime } = runtimeWith(() => response("never"));

const para = (content: string, id = "blk"): RichContent => [{ id, type: "paragraph", props: {}, content }];

class Scene {
  readonly elements: SceneElement[] = [];
  readonly docs = new Map<string, DocumentRecord>();
  card(id: string, text: string, opts: { ai?: Record<string, unknown>; locked?: boolean } = {}): this {
    const documentId = `doc_${id}`;
    this.docs.set(documentId, { id: documentId, workspaceId: "ws", kind: "block", title: "", snapshot: para(text), createdAt: 1, updatedAt: 1, ...(opts.ai ? { metadata: { ai: opts.ai } } : {}) } as DocumentRecord);
    const customData = { acute: { kind: "rich-block", blockType: "text", documentId } };
    this.elements.push({ id, type: "embeddable", x: 0, y: this.elements.length * 120, width: 300, height: 100, isDeleted: false, customData: opts.locked ? withLock(customData, true) : customData } as unknown as SceneElement);
    return this;
  }
  getDocument = (id: string) => this.docs.get(id) ?? null;
}

async function setup(): Promise<Accepted> {
  const a = accepted(await firstRun(DOC, runtime));
  const limits = a.existing.find((o) => o.stableNodeKey === LIMITS)!;
  expect(fingerprintContent(para(LIMITS_TEXT))).toBe(limits.baseline);
  limits.rich = { content: para(LIMITS_TEXT) };
  return a;
}
const idOf = (a: Accepted, key: string) => a.existing.find((o) => o.stableNodeKey === key)!.objectId;
const sourceAI = (a: Accepted, key: string) => ({ createdBy: "ai", contentSourceId: a.source.id, contentSourceVersion: 1, stableNodeKey: key, contentFingerprint: a.existing.find((o) => o.stableNodeKey === key)!.baseline });
const update = (a: Accepted, text: string) => updateFromNewContent({ ...a, text, operationId: "op_2", title: "Update from new content", context }, runtime, { parseMarkdown: parse });

/** The canvas of every test: the source's card, plus cards elsewhere that word overlap would all treat alike. */
function scene(a: Accepted, extra: (s: Scene) => Scene = (s) => s): Scene {
  return extra(
    new Scene()
      .card(idOf(a, LIMITS), LIMITS_TEXT, { ai: sourceAI(a, LIMITS) })
      .card("u_same", "Our worker retries five times before giving up.") // the same claim: offered
      .card("u_deploys", "Deploys happen five times.") // shares the words, about something else: word overlap offers it
      .card("u_mixed", "Timeouts and retries happen five times.") // half about it: unsure, so word overlap's offer stands
      .card("u_paraphrase", "A failed job gets five attempts.") // the claim in other words: word overlap misses it
      .card("u_unrelated", "The office has a kitchen."),
  );
}

const TOPICS: Record<string, readonly string[]> = { retry: ["retries", "retry", "retried", "attempts"], timeout: ["timeouts"], deploy: ["deploys"] };
const THRESHOLDS: ClaimThresholds = { same: 0.8, other: 0.5 };

/** Vectors over topics (+ "anything else"), so two texts are as similar as the topics they share. */
function topicEmbedder(claim: ClaimThresholds | null = THRESHOLDS, embed?: EmbeddingProvider["embed"]): EmbeddingProvider & { calls: string[][] } {
  const names = Object.keys(TOPICS);
  const calls: string[][] = [];
  return {
    id: "test-topics",
    dims: names.length + 1,
    kind: "local",
    thresholds: { related: 0.3, ...(claim ? { claim } : {}) },
    calls,
    ready: async () => ({ state: "ready" }),
    embed:
      embed ??
      (async (texts) => {
        calls.push([...texts]);
        return texts.map((t) => {
          const words = t.toLowerCase().match(/\p{L}+/gu) ?? [];
          const v = new Float32Array(names.length + 1);
          names.forEach((n, i) => (v[i] = words.filter((w) => TOPICS[n]!.includes(w)).length));
          if (v.every((x) => x === 0)) v[names.length] = 1;
          const norm = Math.hypot(...v);
          return { embedder: "test-topics", dense: v.map((x) => x / norm) };
        });
      }),
  };
}

const input = (a: Accepted, set: ChangeSet, s: Scene): ImpactInput => ({ set, sourceId: a.source.id, elements: s.elements, getDocument: s.getDocument });
const reasons = (related: readonly { target: string; reason: string }[]) => Object.fromEntries(related.map((r) => [r.target, r.reason]));

afterEach(() => vi.restoreAllMocks());

describe("#14 — impact discovery by meaning", () => {
  it("word overlap alone offers the cards that merely share the changed words", async () => {
    const a = await setup();
    const r = await update(a, FIVE_TO_THREE);
    const lexical = discoverImpact(input(a, r.changeSet!, scene(a)));
    expect(lexical.conflicts.map((c) => c.target).sort()).toEqual(["u_deploys", "u_mixed", "u_same"]);
    expect(lexical.related).toEqual([]);
  });

  it("with meaning: something else is dropped, the rest stay offers, and a card saying it in other words is listed", async () => {
    const a = await setup();
    const r = await update(a, FIVE_TO_THREE);
    const embedder = topicEmbedder();
    const impact = await discoverImpactByMeaning(input(a, r.changeSet!, scene(a)), embedder);

    expect(impact.conflicts.map((c) => c.target).sort()).toEqual(["u_mixed", "u_same"]);
    expect(impact.conflicts.find((c) => c.target === "u_same")!.impact!.proposed).toBe("Our worker retries three times before giving up.");
    expect(reasons(impact.related)).toEqual({ u_paraphrase: "seems to say “Retries happen five times.” in other words — not edited; check it" });
    // One request, each text once.
    expect(embedder.calls).toHaveLength(1);
    expect(new Set(embedder.calls[0]).size).toBe(embedder.calls[0]!.length);
  });

  it("a card that already says the new value is not pointed out", async () => {
    const a = await setup();
    const r = await update(a, FIVE_TO_THREE);
    const s = scene(a, (x) => x.card("u_current", "Failed jobs get three attempts."));
    const impact = await discoverImpactByMeaning(input(a, r.changeSet!, s), topicEmbedder());
    expect(impact.related.map((x) => x.target)).not.toContain("u_current");
  });

  it("a locked card counts as locked only when it says the same claim", async () => {
    const a = await setup();
    const r = await update(a, FIVE_TO_THREE);
    const s = (text: string) => new Scene().card(idOf(a, LIMITS), LIMITS_TEXT, { ai: sourceAI(a, LIMITS) }).card("u_locked", text, { locked: true });
    expect(discoverImpact(input(a, r.changeSet!, s("Deploys happen five times."))).locked).toBe(1);
    expect((await discoverImpactByMeaning(input(a, r.changeSet!, s("Deploys happen five times.")), topicEmbedder())).locked).toBe(0);
    expect((await discoverImpactByMeaning(input(a, r.changeSet!, s("Our worker retries five times.")), topicEmbedder())).locked).toBe(1);
  });

  it("no sentences read beyond the scan's when the cap is 0: the other-words card isn't found", async () => {
    const a = await setup();
    const r = await update(a, FIVE_TO_THREE);
    const impact = await discoverImpactByMeaning(input(a, r.changeSet!, scene(a)), topicEmbedder(), { maxSentences: 0 });
    expect(impact.related).toEqual([]);
  });

  it("falls back to word overlap: an embedder not calibrated for it, a failure, or the time budget running out", async () => {
    const a = await setup();
    const r = await update(a, FIVE_TO_THREE);
    const lexical = discoverImpact(input(a, r.changeSet!, scene(a)));

    const uncalibrated = topicEmbedder(null);
    expect(await discoverImpactByMeaning(input(a, r.changeSet!, scene(a)), uncalibrated)).toEqual(lexical);
    expect(uncalibrated.calls).toEqual([]);

    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const failing = topicEmbedder(THRESHOLDS, async () => {
      throw new Error("route answered 503");
    });
    expect(await discoverImpactByMeaning(input(a, r.changeSet!, scene(a)), failing)).toEqual(lexical);
    expect(warn).toHaveBeenCalledTimes(1);

    const hanging = topicEmbedder(THRESHOLDS, () => new Promise(() => undefined));
    expect(await discoverImpactByMeaning(input(a, r.changeSet!, scene(a)), hanging, { budgetMs: 20 })).toEqual(lexical);
  });

  it("through the ingest service: the embedder it is given is used; without one, word overlap", async () => {
    const a = await setup();
    const ports = portsFor(a, scene(a));
    const offered = async (embedder: EmbeddingProvider | null) => {
      const r = await ingestContent({ mode: "update", sourceId: a.source.id, text: FIVE_TO_THREE }, ports, { parseMarkdown: parse, updatePolicy: DEFAULT_UPDATE_POLICY, impactEmbedder: async () => embedder });
      return (r.changeSet!.conflicts ?? []).filter((c) => c.impact).map((c) => c.target).sort();
    };
    expect(await offered(topicEmbedder())).toEqual(["u_mixed", "u_same"]);
    expect(await offered(null)).toEqual(["u_deploys", "u_mixed", "u_same"]);
    // The default (no switch on in tests): the hashed embedder isn't calibrated, so word overlap.
    const r = await ingestContent({ mode: "update", sourceId: a.source.id, text: FIVE_TO_THREE }, ports, { parseMarkdown: parse, updatePolicy: DEFAULT_UPDATE_POLICY });
    expect((r.changeSet!.conflicts ?? []).filter((c) => c.impact).map((c) => c.target).sort()).toEqual(["u_deploys", "u_mixed", "u_same"]);
  }, 60_000);

  it("a merge that revises a statement offers the same edit elsewhere, as an update does (it updates in place, §17.6)", async () => {
    const a = await setup();
    const ports = portsFor(a, scene(a));
    // New content about the same topic: it replaces "five times" where the notes say it, so it is a changed fact.
    const merged = (policy = DEFAULT_UPDATE_POLICY, embedder: EmbeddingProvider | null = null) =>
      ingestContent({ mode: "merge", sourceId: a.source.id, text: "# Service\n\n## Limits\n\nRetries happen three times.\n" }, ports, { parseMarkdown: parse, updatePolicy: policy, impactEmbedder: async () => embedder });
    const offered = (r: Awaited<ReturnType<typeof merged>>) => (r.changeSet!.conflicts ?? []).filter((c) => c.impact).map((c) => c.target).sort();

    const r = await merged();
    expect(offered(r)).toEqual(["u_deploys", "u_mixed", "u_same"]);
    expect(r.changeSet!.conflicts!.find((c) => c.target === "u_same")!.impact!.proposed).toBe("Our worker retries three times before giving up.");
    // By meaning when the model runs, as for an update.
    expect(offered(await merged(DEFAULT_UPDATE_POLICY, topicEmbedder()))).toEqual(["u_mixed", "u_same"]);
    // "Suggest updates elsewhere" off: only the source's own cards.
    expect(offered(await merged({ ...DEFAULT_UPDATE_POLICY, suggestElsewhere: false }))).toEqual([]);
  }, 60_000);

  it("a merge that only adds new statements changes no fact, so nothing elsewhere is offered", async () => {
    const a = await setup();
    const r = await ingestContent({ mode: "merge", sourceId: a.source.id, text: "# Service\n\n## Limits\n\nUploads are capped at ten megabytes.\n" }, portsFor(a, scene(a)), {
      parseMarkdown: parse,
      updatePolicy: DEFAULT_UPDATE_POLICY,
      impactEmbedder: async () => null,
    });
    expect((r.changeSet?.conflicts ?? []).filter((c) => c.impact)).toEqual([]);
    expect(r.changeSet?.related ?? []).toEqual([]);
  }, 60_000);
});

function portsFor(a: Accepted, s: Scene): IngestPorts {
  const repo: ContentSourceRepository = {
    get: async (id) => (id === a.source.id ? a.source : null),
    getVersion: async (id, version) => (id === a.source.id && version === a.previous.version ? a.previous : null),
    append: async () => undefined,
    listByCanvas: async () => [a.source],
    delete: async () => undefined,
  };
  return {
    runtime,
    contentSources: repo,
    renderContext: () => context,
    sourceObjects: () => ({ existing: a.existing, connections: [] }),
    scene: () => ({ elements: s.elements, getDocument: s.getDocument }),
  };
}

describe("#14 — same claim or not", () => {
  it("the verdict from the cosine", async () => {
    const t: ClaimThresholds = { same: 0.6, other: 0.55 };
    expect(claimVerdict(0.5, t)).toBe("other");
    expect(claimVerdict(0.57, t)).toBe("unsure");
    expect(claimVerdict(0.6, t)).toBe("same");
    const [same] = await judgeClaims(topicEmbedder(), THRESHOLDS, [["Retries happen five times.", "Retries happen five times!"]]);
    expect(same!.verdict).toBe("same");
  });
});
