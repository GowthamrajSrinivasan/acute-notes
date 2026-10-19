/**
 * A synthetic stand-in for the real three-chat layout D merge, built only from saved data (no chat text, no network, no model): the 34
 * topics (headings and sizes) of the first chat's notes (`layoutDPlacement.json`) and Jev's saved answers for the 116 parts to assign
 * (`.ai/docs/decision-spike/data/jev-layoutd-answers-2026-10-10.json`: heading, size, topic, confidence). Each section's body is
 * deterministic filler of the recorded length, made of distinct words so that nothing is a repeat of anything else.
 */
import { readFileSync } from "node:fs";
import placement from "./layoutDPlacement.json";

export interface RecordedPart {
  key: string;
  leaf: string;
  chars: number;
  topic: string;
  confidence: number;
}
export const recorded: RecordedPart[] = JSON.parse(readFileSync(".ai/docs/decision-spike/data/jev-layoutd-answers-2026-10-10.json", "utf8"));

/** Distinct filler of about `chars` characters (a seed keeps every section's words its own). */
export function filler(seed: string, chars: number): string {
  let h = 2166136261;
  for (const c of seed) h = Math.imul(h ^ c.charCodeAt(0), 16777619) >>> 0;
  const out: string[] = [];
  let n = 0;
  while (out.join(" ").length < chars) {
    h = Math.imul(h ^ (h >>> 13), 1274126177) >>> 0;
    out.push(`w${h.toString(36)}x${n++ % 7 === 6 ? "." : ""}`);
  }
  return out.join(" ").slice(0, chars).replace(/\s+\S*$/, ".");
}

/** A section as the chat has it; one with a subsection (the largest, "My honest score": a matrix under its own #### heading) keeps it. */
export function sectionText(p: RecordedPart): string {
  const body = Math.max(12, p.chars - p.leaf.length - 6);
  if (p.chars < 3000) return `### ${p.leaf}

${filler(`new:${p.key}`, body)}`;
  return `### ${p.leaf}

${filler(`new:${p.key}`, 1200)}

#### Competitive feature matrix

${filler(`m:${p.key}`, body - 1240)}`;
}

const ROOT = "AI App Builder Ecosystem (2026-10-08)";
const labelOf = (key: string) => key.split(" › ").at(-1)!;

/** A root's own text as a chat has it: the user's opening question as a quote, then the opening answer. */
export const ownText = (own: RecordedPart): string => `> ${filler(`q:${own.key}`, 120)}

${filler(own.key, Math.max(20, own.chars - 160))}`;

/** The first chat as the notes: `# title`, then each topic as a `###` section (layout D: the assistant's headings one level down). */
export function notesText(): string {
  const [first, ...rest] = placement.topics;
  return [
    `# ${ROOT}\n\nSource: https://example.test/chat-1\n\n${filler(first!.key, first!.chars - 80)}`,
    ...rest.map((t) => `### ${labelOf(t.key)}\n\n${filler(t.key, t.chars - labelOf(t.key).length - 6)}`),
  ].join("\n\n") + "\n";
}

/**
 * The three chats as one text (what the import hands the merge): chat 1 again (its sections are repeats of the notes, except those the
 * saved answers say carry something new), then the two branches with their sections as recorded.
 */
export function incomingText(): string {
  const byRoot = new Map<string, RecordedPart[]>();
  for (const r of recorded) {
    const root = r.key.split(" › ")[0]!;
    byRoot.set(root, [...(byRoot.get(root) ?? []), r]);
  }
  const chats = [ROOT, ...[...byRoot.keys()].filter((k) => k !== ROOT)];
  return chats
    .map((root) => {
      const parts = byRoot.get(root) ?? [];
      const own = parts.find((p) => !p.key.includes(" › "));
      const head = `# ${root}\n\nSource: https://example.test/${encodeURIComponent(root)}\n\n${own ? ownText(own) : ""}`.trimEnd();
      const sections = parts
        .filter((p) => p.key.includes(" › "))
        .map((p) => sectionText(p));
      // Chat 1's sections that the answers do not list are the notes' own (repeats, skipped before any call).
      const repeats =
        root === ROOT
          ? placement.topics.slice(1).filter((t) => !parts.some((p) => p.key === t.key)).map((t) => `### ${labelOf(t.key)}\n\n${filler(t.key, t.chars - labelOf(t.key).length - 6)}`)
          : [];
      return [head, ...sections, ...repeats].join("\n\n");
    })
    .join("\n\n---\n\n") + "\n";
}
