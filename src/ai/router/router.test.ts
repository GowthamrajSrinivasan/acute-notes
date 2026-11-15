/**
 * Stage 2a–2c (intelligent-update-engine-plan): the embedding tier, card descriptors and the Node Router, over a real
 * `WorkspaceIndex` built from a scene — offline, deterministic, no AI. The plan's router tests: direct match,
 * non-obvious match, ambiguous → asks, "contains the claim" vs "related topic"; and the two confidences kept apart.
 */
import { describe, expect, it } from "vitest";
import type { SceneElement } from "@/domain/canvas/adapter";
import type { DocumentRecord } from "@/domain/types";
import { arrow, block, doc, el, lookup, para } from "@/search/testFixtures";
import { WorkspaceIndex } from "@/search/workspaceIndex";
import { DescriptorCache, keywordsOf, sectionsOf, summaryOf } from "./descriptors";
import { cosine, localEmbedder, VectorTier } from "./embedding";
import { CLARIFY_MARGIN, routeContent, RouterModeUnavailableError, type RouteInput } from "./router";
import { RoutingSignals } from "./signals";

const frame = (id: string, name: string, takeaway?: string) => el({ id, type: "frame", name, customData: takeaway ? { acuteOverview: { title: name, takeaway } } : {} } as Partial<SceneElement> & Pick<SceneElement, "id" | "type">);

interface Card {
  id: string;
  text: string;
  frame?: string;
}

/** A canvas of sections and cards, indexed. */
function world(cards: readonly Card[], frames: readonly SceneElement[] = [], extra: readonly SceneElement[] = []) {
  const docs: DocumentRecord[] = cards.map((c) => doc(`d_${c.id}`, para(c.text)));
  const scene: SceneElement[] = [...frames, ...cards.map((c) => block(c.id, `d_${c.id}`, c.frame ? { frameId: c.frame } : {})), ...extra];
  const index = new WorkspaceIndex("ws");
  index.syncScene("cv", scene, lookup(docs));
  const tier = new VectorTier(index);
  const route = (text: string, more: Partial<RouteInput> = {}) => routeContent({ text, canvasId: "cv", tier, scene, ...more });
  return { index, tier, scene, docs, route };
}

const GATEWAY: Card[] = [
  { id: "retries", text: "Retries happen five times with exponential backoff.", frame: "f_limits" },
  { id: "timeouts", text: "Timeouts last ten seconds per call.", frame: "f_limits" },
  { id: "owners", text: "The payments team owns the gateway service.", frame: "f_owners" },
  { id: "tokens", text: "Each server gets its own scoped access token.", frame: "f_security" },
  { id: "keys", text: "Signing keys rotate monthly.", frame: "f_security" },
];
const SECTIONS = [frame("f_limits", "Limits", "How hard the gateway tries before giving up."), frame("f_owners", "Owners"), frame("f_security", "Security")];

describe("2a — the embedding tier", () => {
  it("related texts score higher than unrelated ones; word forms meet through stems and trigrams", () => {
    const e = localEmbedder.embed;
    const retry = e("Retries happen five times.");
    expect(cosine(retry, e("The client retried the failed call."))).toBeGreaterThan(cosine(retry, e("The payments team owns the service.")));
    expect(cosine(e("Signing keys rotate monthly."), e("Key rotation happens every month."))).toBeGreaterThan(0.2);
    expect(cosine(retry, retry)).toBeCloseTo(1, 5);
  });

  it("is a SearchIndex: queries pass through to the index unchanged", () => {
    const { index, tier } = world(GATEWAY, SECTIONS);
    expect(tier.query({ text: "retries", mode: "any" })).toEqual(index.query({ text: "retries", mode: "any" }));
    expect(tier.size).toBe(index.size);
  });

  it("stays incremental: only a changed card is embedded again, and a removed one is dropped", () => {
    const { index, tier, scene, docs } = world(GATEWAY, SECTIONS);
    expect(tier.refresh()).toBe(GATEWAY.length);
    expect(tier.refresh()).toBe(0);
    const edited = docs.map((d) => (d.id === "d_owners" ? { ...d, snapshot: para("The platform team owns the gateway service."), updatedAt: 5 } : d));
    index.syncScene("cv", scene, lookup(edited));
    index.syncDocuments(edited);
    expect(tier.refresh()).toBe(1);
    index.syncScene("cv", scene.filter((s) => s.id !== "keys"), lookup(edited));
    tier.refresh();
    expect(tier.vectorOf("keys")).toBeUndefined();
  });
});

describe("2b — card descriptors", () => {
  it("a title, a one-line summary, distinctive keywords and the section with its own summary reused", () => {
    const { tier, scene } = world(GATEWAY, SECTIONS);
    const { frames, frameOf } = sectionsOf(scene);
    const d = new DescriptorCache().describe(tier.get("retries")!, frames.get(frameOf.get("retries")!), (t) => tier.frequency(t), tier.size);
    expect(d.summary).toBe("Retries happen five times with exponential backoff.");
    expect(d.keywords).toEqual(expect.arrayContaining(["retries", "exponential"]));
    expect(d.section).toEqual({ id: "f_limits", name: "Limits", takeaway: "How hard the gateway tries before giving up." });
  });

  it("is computed again only when the card or its section changes", () => {
    const { tier, scene } = world(GATEWAY, SECTIONS);
    const { frames } = sectionsOf(scene);
    const cache = new DescriptorCache();
    const f = (t: string) => tier.frequency(t);
    cache.describe(tier.get("retries")!, frames.get("f_limits"), f, tier.size);
    cache.describe(tier.get("retries")!, frames.get("f_limits"), f, tier.size);
    expect(cache.computed).toBe(1);
    cache.describe(tier.get("retries")!, { id: "f_limits", name: "Limits (renamed)" }, f, tier.size);
    expect(cache.computed).toBe(2);
  });

  it("summaries are cut to one line; keywords favour words rare in the workspace", () => {
    expect(summaryOf(`${"Long ".repeat(60)}sentence. Second.`).length).toBeLessThanOrEqual(160);
    expect(keywordsOf("the gateway gateway retries", (t) => (t === "gateway" ? 100 : 1), 100)[0]).toBe("retries");
  });
});

describe("2c — the Node Router", () => {
  it("direct match: the card that holds the claim, as an update, with the two confidences kept apart", () => {
    const r = world(GATEWAY, SECTIONS).route("Retries happen three times.");
    expect(r.decision).toBe("route");
    const top = r.candidates[0]!;
    expect(top).toMatchObject({ id: "retries", action: "update", claim: { intent: "SUPERSEDES", escalate: false } });
    expect(top.routing).toBeGreaterThan(0.2);
    expect(top.update).toBeGreaterThan(0.5);
    expect(top.routing).not.toBe(top.update); // two questions, two numbers
    expect(top.evidence.join(" | ")).toMatch(/holds the claim “Retries happen five times/);
    expect(top.evidence.join(" | ")).toMatch(/best-matching section “Limits”/);
  });

  it("non-obvious match: different word forms, no shared word, still the right card", () => {
    // "rotated" is no prefix of "rotate" and no other word is shared: keyword search finds nothing here.
    const r = world(GATEWAY, SECTIONS).route("Credentials are rotated every thirty days.");
    expect(r.candidates[0]!.id).toBe("keys");
    expect(r.candidates[0]!.scores.lexical).toBe(0);
    expect(r.candidates[0]!.scores.semantic).toBeGreaterThan(0);
  });

  it("related topic vs contains the claim: a new point about retries goes beside the retries card, as a new card", () => {
    const r = world(GATEWAY, SECTIONS).route("Jitter spreads retries out so callers don't retry together.");
    expect(r.candidates[0]).toMatchObject({ id: "retries", action: "insert_near" });
    expect(r.candidates[0]!.claim).toBeUndefined();
  });

  it("a claim the card already makes: nothing to do", () => {
    const r = world(GATEWAY, SECTIONS).route("Retries happen five times with exponential backoff.");
    expect(r.candidates[0]).toMatchObject({ id: "retries", action: "none", update: 1 });
  });

  it("a contradiction: the place is clear, the edit is not — high routing, low update, escalated", () => {
    const r = world(GATEWAY, SECTIONS).route("Retries never happen with exponential backoff.");
    const top = r.candidates[0]!;
    expect(top).toMatchObject({ id: "retries", action: "update", claim: { intent: "CONTRADICTS", escalate: true } });
    expect(top.update).toBeLessThan(0.3);
    expect(top.routing).toBeGreaterThan(top.update);
  });

  it("ambiguous: two sections fit about equally — NEEDS_CLARIFICATION", () => {
    const { route } = world(
      [
        { id: "a", text: "The cache stores user sessions.", frame: "f_a" },
        { id: "b", text: "The cache stores access tokens.", frame: "f_b" },
      ],
      [frame("f_a", "Sessions"), frame("f_b", "Tokens")],
    );
    const r = route("The cache stores data for an hour.");
    expect(r.decision).toBe("NEEDS_CLARIFICATION");
    expect(Math.abs(r.candidates[0]!.routing - r.candidates[1]!.routing)).toBeLessThan(CLARIFY_MARGIN);
  });

  it("nothing close: NEW", () => {
    expect(world(GATEWAY, SECTIONS).route("The quarterly budget review is in March.").decision).toBe("NEW");
  });

  it("graph: a card linked to a strong match joins the candidates, with the link as evidence", () => {
    const { route } = world(
      [...GATEWAY, { id: "runbook", text: "Page the on-call engineer and open an incident ticket." }],
      SECTIONS,
      [arrow("ar1", "retries", "runbook", "relates_to")],
    );
    const runbook = route("Retries happen three times.").candidates.find((c) => c.id === "runbook");
    expect(runbook).toBeDefined();
    expect(runbook!.scores.graph).toBeGreaterThan(0);
    expect(runbook!.evidence.join(" | ")).toMatch(/linked to/);
  });

  it("a past choice for similar content boosts that destination, as evidence", () => {
    const signals = new RoutingSignals();
    signals.record("Owners must approve gateway changes.", ["owners"]);
    const { route } = world(GATEWAY, SECTIONS);
    const without = route("Owners approve gateway changes before release.").candidates.find((c) => c.id === "owners")!;
    const withSignal = route("Owners approve gateway changes before release.", { signals }).candidates.find((c) => c.id === "owners")!;
    expect(withSignal.routing).toBeGreaterThan(without.routing);
    expect(withSignal.evidence).toContain("you placed similar content here before");
    expect(RoutingSignals.fromJSON(JSON.parse(JSON.stringify(signals.toJSON()))).size).toBe(1);
  });

  it("only objects on the canvas are destinations: an off-canvas document (an older version kept for undo) never is", () => {
    const { index, route } = world(GATEWAY, SECTIONS);
    index.syncDocuments([doc("d_old_retries", para("Retries happen five times with exponential backoff."), { canvasId: "cv" })]);
    const r = route("Retries happen three times.");
    expect(r.candidates.map((c) => c.id)).not.toContain("d_old_retries");
    expect(r.decision).toBe("route");
  });

  it("only unanchored content is routed here: source reconciliation is the update itself, impact discovery runs on its change set", () => {
    const { route } = world(GATEWAY, SECTIONS);
    expect(() => route("x", { mode: "source_reconciliation" })).toThrow(RouterModeUnavailableError);
    expect(() => route("x", { mode: "impact_discovery" })).toThrow(/discoverImpact/);
  });
});
