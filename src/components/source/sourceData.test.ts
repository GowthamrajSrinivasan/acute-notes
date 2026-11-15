/**
 * The Source tab fed from storage (knowledge-notes-plan §5.1, WP2.1; U1, U6) and the per-version passage record
 * (`ai/content/sourceReview.ts`, the lanes log's Lane H request): what the run decided per passage, kept beside the
 * version, and the user's Include / Dismiss resolutions surviving a reload.
 */
import { describe, expect, it } from "vitest";
import { loadSourceReview, resolvePassage, saveSourceOutcomes, sourceReviewKey } from "@/ai/content/sourceReview";
import { splitUnits } from "@/ai/fidelity/sourceUnits";
import { matchVersions } from "@/ai/fidelity/sourceUnits";
import { unitOutcomesOf } from "@/ai/fidelity/knowledgeRun";
import { createMemoryServices } from "@/persistence/repositories/memory";
import type { ContentSource, ContentSourceVersion } from "@/domain/types";
import { loadSourcePanel, outlineOf, withResolutions } from "./sourceData";

const V1 = `# Caching

## Retries

Retries stop after 3 attempts. Thanks for reading.

## Limits

The cache keeps at most 500 entries.
`;
const V2 = V1.replace("3 attempts", "5 attempts");

async function stored() {
  const services = createMemoryServices();
  const units1 = await splitUnits(V1);
  const { units: units2, lineage } = await matchVersions({ ...units1, version: 1 }, { text: V2, version: 2 });
  const source: ContentSource = { id: "src", workspaceId: "w", canvasId: "c", origin: "paste", tier: "ai", template: "sectioned", latestVersion: 1, createdAt: 1, updatedAt: 1 };
  const v1: ContentSourceVersion = { sourceId: "src", version: 1, text: V1, plan: {}, units: units1, createdAt: 1 };
  await services.contentSources.append(source, v1);
  return { services, source, units1, units2, lineage };
}

describe("the per-version passage record (sourceReview)", () => {
  it("keeps the run's outcomes and the user's resolutions; Include represents a passage, Dismiss confirms its omission", async () => {
    const { meta } = createMemoryServices();
    await saveSourceOutcomes(meta, "src", 1, { outcome: { u1: "represented", u2: "needs_review", u3: "omitted" }, reasons: { u2: ["important point left out"], u3: ["left out as filler"] }, flags: [{ code: "critical_omitted", unit: "u2", detail: "important point left out" }] });
    await resolvePassage(meta, "src", 1, "u2", "included");
    await resolvePassage(meta, "src", 1, "u3", "dismissed");
    // A reload reads the same record back.
    const again = await loadSourceReview(meta, "src", 1);
    expect(again!.resolutions).toEqual({ u2: "included", u3: "dismissed" });
    expect(again!.outcome).toMatchObject({ u2: "represented", u3: "omitted" });
    expect(again!.flags).toHaveLength(1);
    // Saving the outcomes again (an undo then redo of the Accept) keeps the resolutions.
    await saveSourceOutcomes(meta, "src", 1, { outcome: { u2: "needs_review" }, reasons: {}, flags: [] });
    expect((await loadSourceReview(meta, "src", 1))!.resolutions).toEqual({ u2: "included", u3: "dismissed" });
  });

  it("reads a malformed record leniently", async () => {
    const { meta } = createMemoryServices();
    await meta.set(sourceReviewKey("src", 1), { outcome: { u1: "bogus", u2: "omitted" }, reasons: "no", flags: [1, { code: "pending", detail: "x" }], resolutions: { u2: "nope" } });
    expect(await loadSourceReview(meta, "src", 1)).toEqual({ outcome: { u2: "omitted" }, reasons: {}, flags: [{ code: "pending", detail: "x" }], resolutions: {} });
  });

  it("a run's outcomes: omission reasons in plain words, review details, and only the flags about passages no card cites", () => {
    const run = {
      accounting: { state: {}, critical: {}, sections: [], flags: [], outcome: { u1: "represented" as const, u2: "omitted" as const, u3: "needs_review" as const, u4: "needs_review" as const } },
      omitted: [{ unit: "u2", reason: "filler" as const }],
      flags: [
        { code: "critical_omitted" as const, unit: "u3", detail: "omitted as meta, but it carries a limitation" },
        { code: "condition_changed" as const, unit: "u4", card: "n1", detail: "source limits it" },
      ],
      cites: { n1: ["u1", "u4"] },
    };
    const o = unitOutcomesOf(run);
    expect(o.reasons).toEqual({ u2: ["left out as filler"], u3: ["omitted as meta, but it carries a limitation"], u4: ["source limits it"] });
    expect(o.flags.map((f) => f.unit)).toEqual(["u3"]);
  });
});

describe("the Source tab's data from storage (U1, U6)", () => {
  it("“Source not on this device” when the source or that version isn't stored here", async () => {
    const { services } = await stored();
    expect((await loadSourcePanel(services.contentSources, services.meta, "other", 1, [])).state).toEqual({ kind: "unavailable" });
    expect((await loadSourcePanel(services.contentSources, services.meta, "src", 7, [])).state).toEqual({ kind: "unavailable" });
  });

  it("opens the card's version with its units, outline, outcomes and resolutions; a newer version brings its lineage", async () => {
    const { services, source, units1, units2, lineage } = await stored();
    await saveSourceOutcomes(services.meta, "src", 1, { outcome: Object.fromEntries(units1.units.map((u) => [u.id, "represented" as const])), reasons: {}, flags: [] });
    await resolvePassage(services.meta, "src", 1, units1.units[1]!.id, "dismissed");
    let loaded = await loadSourcePanel(services.contentSources, services.meta, "src", 1, [units1.units[0]!.id]);
    expect(loaded.state.kind).toBe("ready");
    let data = loaded.state.kind === "ready" ? loaded.state.data : null;
    expect(data!.version).toBe(1);
    expect(data!.latestVersion).toBe(1);
    expect(data!.units.map((u) => u.id)).toEqual(units1.units.map((u) => u.id));
    expect(data!.sections.map((s) => [s.heading, s.level])).toEqual([
      ["Caching", 1],
      ["Retries", 2],
      ["Limits", 2],
    ]);
    // Topics as the units name them, so the outline's counts match.
    expect(new Set(data!.units.map((u) => u.topic)).size).toBeGreaterThan(0);
    expect(data!.units.every((u) => data!.sections.some((s) => s.topic === u.topic))).toBe(true);
    expect(data!.outcome[units1.units[1]!.id]).toBe("omitted");
    expect(data!.reasons[units1.units[1]!.id]).toEqual(["you confirmed leaving this out"]);
    expect(data!.onCanvas).toEqual([units1.units[0]!.id]);
    expect(data!.lineage).toBeUndefined();

    await services.contentSources.append({ ...source, latestVersion: 2 }, { sourceId: "src", version: 2, text: V2, plan: {}, units: units2, lineage, createdAt: 2 });
    loaded = await loadSourcePanel(services.contentSources, services.meta, "src", 1, []);
    data = loaded.state.kind === "ready" ? loaded.state.data : null;
    expect(data!.version).toBe(1);
    expect(data!.latestVersion).toBe(2);
    expect(data!.lineage).toMatchObject({ fromVersion: 1, toVersion: 2 });
  });

  it("an outline of a text without headings is empty; resolutions apply over the stored outcomes", async () => {
    expect(await outlineOf("Just one paragraph.")).toEqual([]);
    expect(withResolutions(null)).toEqual({ outcome: {}, reasons: {} });
    expect(withResolutions({ outcome: { u1: "needs_review" }, reasons: { u1: ["x"] }, flags: [], resolutions: { u1: "included" } })).toEqual({ outcome: { u1: "represented" }, reasons: {} });
  });
});

describe("the outline scan (§5.2 budget)", () => {
  it("gives what the parser gives for plain ATX headings, fenced code skipped", async () => {
    const { parseContent } = await import("@/ai/content/parser");
    const text = `${V1}\n\`\`\`\n# not a heading\n\`\`\`\n\n### Deep\n\nMore.\n\n## Back\n\nEnd.\n`;
    const { scanOutline } = await import("./sourceData");
    const scanned = scanOutline(text)!;
    expect(scanned).not.toBeNull();
    const parsed = await parseContent(text);
    const viaParser: { heading: string; level: number; start: number }[] = [];
    const visit = (s: (typeof parsed.sections)[number]) => {
      if (s.heading) viaParser.push({ heading: s.heading.text, level: s.heading.level, start: s.span.start });
      s.subsections.forEach(visit);
    };
    parsed.sections.forEach(visit);
    expect(scanned.map((s) => ({ heading: s.heading, level: s.level, start: s.span.start }))).toEqual(viaParser);
    expect(scanned.map((s) => s.topic)).toEqual(["Caching", "Caching › Retries", "Caching › Limits", "Caching › Limits › Deep", "Caching › Back"]);
  });

  it("leaves headings with inline markup, or setext headings, to the parser", async () => {
    const { scanOutline } = await import("./sourceData");
    expect(scanOutline("# A **bold** title\n\nText.")).toBeNull();
    expect(scanOutline("Title\n=====\n\nText.")).toBeNull();
    expect((await outlineOf("# A **bold** title\n\nText.")).map((s) => s.heading)).toEqual(["A bold title"]);
  });
});
