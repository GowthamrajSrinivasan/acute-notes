/**
 * Study mode (`.ai/docs/openui-integration-plan.md` Phase 3, "learning cards and quizzes"): turns notes the user already
 * has into Flashcard / QuizCard OpenUI Lang, deterministically and with no model call. Pure — no React, no randomness:
 * the same notes always give the same cards (choice order is seeded from the note id).
 *
 * Every string literal goes through `JSON.stringify`, which round-trips through the OpenUI Lang parser (double-quoted,
 * backslash-escaped strings).
 */

export interface StudyNote {
  id: string;
  title: string;
  body: string;
  cites: string[];
  /**
   * The first reason of an open review on the card it comes from (`Note.needsReview`). A study card made from such a
   * note shows the same "Needs review" mark (study-mode plan §7, issue A); the mark is drawn by the host, outside the
   * card, so the Flashcard / QuizCard props don't change.
   */
  needsReview?: string;
}

/** A note as Study takes it: review state carried through, never dropped (study-mode plan §0 gap). */
export function studyNoteOf(note: { id: string; title: string; body: string; cites: readonly string[]; needsReview?: string }): StudyNote {
  return { id: note.id, title: note.title, body: note.body, cites: [...note.cites], ...(note.needsReview ? { needsReview: note.needsReview } : {}) };
}

const lit = (s: string) => JSON.stringify(s);

/** One Flashcard: the note's title as the prompt, its body as the answer, its first citation as the unit. */
export function flashcardLang(note: StudyNote): string {
  const args = [lit(note.title), lit(note.body || note.title)];
  if (note.cites[0]) args.push(lit(note.cites[0]));
  return `root = Flashcard(${args.join(", ")})`;
}

/** cyrb53-style 32-bit string hash; stable across runs and platforms. */
function hash(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** A small deterministic PRNG (mulberry32) seeded from `seed`. */
function rng(seed: number): () => number {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffle<T>(items: T[], seed: string): T[] {
  const out = [...items];
  const next = rng(hash(seed));
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(next() * (i + 1));
    [out[i], out[j]] = [out[j]!, out[i]!];
  }
  return out;
}

/** Truncates a body to a readable question stem. */
function stem(body: string, max = 220): string {
  const flat = body.replace(/\s+/g, " ").trim();
  return flat.length <= max ? flat : `${flat.slice(0, max - 1).trimEnd()}…`;
}

/**
 * A QuizCard for `notes[index]`: "Which idea does this describe?" with the note's body as the stem, its title as the
 * correct choice and up to 3 other notes' titles as distractors (distinct titles only). Null when there are fewer than
 * 2 notes with distinct titles, the index is out of range, or the note has no body (a title-only card would quote its
 * own answer as the stem).
 */
export function quizLang(notes: readonly StudyNote[], index: number): string | null {
  const note = notes[index];
  if (!note || !note.body.trim()) return null;
  const seen = new Set([note.title.trim().toLowerCase()]);
  const others: string[] = [];
  for (const other of shuffle(notes.filter((n) => n.id !== note.id), `${note.id}:distractors`)) {
    const key = other.title.trim().toLowerCase();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    others.push(other.title);
    if (others.length === 3) break;
  }
  if (!others.length) return null;
  const choices = shuffle([note.title, ...others], `${note.id}:choices`);
  const answer = choices.indexOf(note.title);
  const question = `Which idea does this describe? “${stem(note.body)}”`;
  const args = [lit(question), `[${choices.map(lit).join(", ")}]`, String(answer), lit(`${note.title}: ${stem(note.body, 400)}`)];
  if (note.cites[0]) args.push(lit(note.cites[0]));
  return `root = QuizCard(${args.join(", ")})`;
}
