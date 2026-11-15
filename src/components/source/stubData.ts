/**
 * Stub `SourcePanelData` for building and testing the Source panel before the integrator wires storage (Lane D).
 * Shapes follow `contracts.ts`: units are sentences with spans into the text, sections span heading → section end,
 * outcomes and reasons per unit. Deterministic, so tests can rely on ids and counts.
 */
import type { Lineage, SourcePanelData, SourceUnit, UnitId, UnitOutcome } from "@/ai/fidelity/contracts";
import { cyrb53 } from "@/ai/content/fingerprint";

interface StubSection {
  heading: string;
  level?: number;
  paragraphs: { text: string; outcome?: UnitOutcome; reasons?: string[] }[][];
}

/** Builds text, sections and units from sections of paragraphs of sentences. */
export function buildStub(sections: StubSection[], options: { sourceId?: string; version?: number; latestVersion?: number; lead?: string } = {}): SourcePanelData {
  let text = "";
  const units: SourceUnit[] = [];
  const outcome: Record<UnitId, UnitOutcome> = {};
  const reasons: Record<UnitId, string[]> = {};
  const out: SourcePanelData["sections"] = [];
  let n = 1;
  const addSentences = (sentences: StubSection["paragraphs"][number], topic: string) => {
    sentences.forEach((s, i) => {
      if (i) text += " ";
      const id = `u${n++}`;
      const start = text.length;
      text += s.text;
      const prev = units[units.length - 1];
      units.push({ id, kind: "sentence", text: s.text, hash: cyrb53(s.text.toLowerCase()), topic, span: { start, end: text.length }, ...(prev ? { prev: prev.id } : {}) });
      if (prev) prev.next = id;
      outcome[id] = s.outcome ?? "represented";
      if (s.reasons?.length) reasons[id] = s.reasons;
    });
    text += "\n\n";
  };
  if (options.lead) addSentences([{ text: options.lead }], "");
  sections.forEach((section, k) => {
    const level = section.level ?? 2;
    const topic = `t${k + 1}`;
    const start = text.length;
    text += `${"#".repeat(level)} ${section.heading}\n\n`;
    for (const p of section.paragraphs) addSentences(p, topic);
    out.push({ topic, heading: section.heading, level, span: { start, end: text.length } });
  });
  // Parser spans run to the end of the last subsection: widen parents over their children.
  for (let i = 0; i < out.length; i += 1) {
    for (let j = i + 1; j < out.length && out[j]!.level > out[i]!.level; j += 1) out[i]!.span.end = out[j]!.span.end;
  }
  return {
    sourceId: options.sourceId ?? "src-stub",
    version: options.version ?? 1,
    latestVersion: options.latestVersion ?? options.version ?? 1,
    text,
    sections: out,
    units,
    outcome,
    reasons,
  };
}

/** A short design note: every outcome, a nested section, a lead-in and a newer version with lineage. */
export function stubSourcePanelData(): SourcePanelData {
  const data = buildStub(
    [
      {
        heading: "Caching",
        paragraphs: [
          [
            { text: "The service caches search results for 10 minutes." },
            { text: "Results are served from the cache only when the cache contains a valid result.", outcome: "needs_review", reasons: ['condition changed: source says "when the cache contains a valid result"'] },
            { text: "As discussed last week.", outcome: "omitted", reasons: ["filler"] },
          ],
          [{ text: "Cache keys include the tenant id and the normalised query." }],
        ],
      },
      {
        heading: "Invalidation",
        level: 3,
        paragraphs: [[{ text: "A write to the index clears the tenant's cache." }, { text: "Clearing is asynchronous and can lag by up to 2 seconds." }]],
      },
      {
        heading: "Limits",
        paragraphs: [
          [
            { text: "The cache must not exceed 2 GB per node.", outcome: "needs_review", reasons: ["critical caveat omitted"] },
            { text: "The cache holds at most 2 GB per node.", outcome: "omitted", reasons: ["duplicate of u8"] },
          ],
        ],
      },
      { heading: "Open questions", paragraphs: [[{ text: "Should cold starts warm the cache?" }]] },
    ],
    { version: 1, latestVersion: 2, lead: "Notes from the search design review." },
  );
  // Every Represented unit, plus u3 (cited, but its card changed a condition: Needs review, yet on the canvas).
  data.onCanvas = ["u1", "u2", "u3", "u5", "u6", "u7", "u10"];
  data.lineage = {
    fromVersion: 1,
    toVersion: 2,
    entries: [
      { state: "changed", from: "u2", to: "u2" },
      { state: "removed", from: "u4" },
      { state: "unchanged", from: "u7", to: "u7", moved: true },
      { state: "ambiguous", to: "u12", candidates: ["u9", "u8"] },
      { state: "added", to: "u13" },
      ...["u1", "u3", "u5", "u6", "u8", "u10"].map((id) => ({ state: "unchanged" as const, from: id, to: id })),
    ],
  } satisfies Lineage;
  return data;
}

const WORDS = "the service cache index tenant query result write node limit request response retry budget latency queue worker shard replica region client token policy".split(" ");

/** Deterministic pseudo-random sentence `i` (no Math.random, so ids and spans are stable). */
function sentence(i: number): string {
  const len = 8 + ((i * 7) % 11);
  const words: string[] = [];
  for (let w = 0; w < len; w += 1) words.push(WORDS[(i * 31 + w * 17 + ((i * w) % 5)) % WORDS.length]!);
  const s = words.join(" ");
  return `${s[0]!.toUpperCase()}${s.slice(1)} ${i}.`;
}

/**
 * A long source of at least `chars` characters (default 200k, the plan's maximum): sections of paragraphs, every 7th
 * unit omitted, every 13th needs review, some subsections.
 */
export function stubLongSourceData(chars = 200_000): SourcePanelData {
  const sections: StubSection[] = [];
  let size = 0;
  let i = 0;
  for (let k = 1; size < chars; k += 1) {
    const heading = `Section ${k}`;
    const paragraphs: StubSection["paragraphs"] = [];
    for (let p = 0; p < 4 && size < chars; p += 1) {
      const para: StubSection["paragraphs"][number] = [];
      for (let s = 0; s < 6; s += 1) {
        i += 1;
        const text = sentence(i);
        const omitted = i % 7 === 0;
        const review = !omitted && i % 13 === 0;
        para.push(omitted ? { text, outcome: "omitted", reasons: ["filler"] } : review ? { text, outcome: "needs_review", reasons: ["qualifier dropped"] } : { text });
        size += text.length + 1;
      }
      paragraphs.push(para);
      size += 1; // the blank line after the paragraph, less the space its last sentence doesn't get
    }
    const level = k % 5 === 0 ? 3 : 2;
    sections.push({ heading, level, paragraphs });
    size += level + heading.length + 3;
  }
  return buildStub(sections, { sourceId: "src-long", version: 1, latestVersion: 1 });
}

/** A selection of `count` units spread across the source (first, middle, last …). */
export function spreadSelection(data: SourcePanelData, count = 3): UnitId[] {
  const n = data.units.length;
  if (!n) return [];
  const ids: UnitId[] = [];
  for (let k = 0; k < count; k += 1) ids.push(data.units[Math.min(n - 1, Math.round((k * (n - 1)) / Math.max(1, count - 1)))]!.id);
  return [...new Set(ids)];
}

/** The same data recorded before unit ids: no units, no outcomes (the panel highlights by span). */
export function withoutUnits(data: SourcePanelData): SourcePanelData {
  return { ...data, units: [], outcome: {}, reasons: {}, onCanvas: undefined, lineage: undefined };
}
