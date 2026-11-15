import { createParser } from "@openuidev/react-lang";
import { describe, expect, it } from "vitest";
import { acuteCardLibrary } from "./library";
import { flashcardLang, quizLang, studyNoteOf, type StudyNote } from "./study";

const parse = (lang: string) => createParser(acuteCardLibrary.toJSONSchema()).parse(lang);

const NOTES: StudyNote[] = [
  { id: "n1", title: "Idempotency keys prevent duplicate charges", body: 'A retry with the same key returns the original result — "exactly once" to the client.', cites: ["u4", "u7"] },
  { id: "n2", title: "Keys expire after a window", body: "After 24 hours a retry is a new payment.\nPlan retries inside it.", cites: ["u7"] },
  { id: "n3", title: "Store the response, not just the key", body: "The server replays the stored response body and status.", cites: [] },
  { id: "n4", title: "Scope keys per merchant", body: "Two merchants may pick the same key.", cites: ["u9"] },
  { id: "n5", title: "Reject a reused key with a different body", body: "A mismatch is a client bug, not a retry.", cites: ["u11"] },
];

describe("studyNoteOf (study-mode plan §7, issue A)", () => {
  it("carries an open review through to the study note, and leaves it off when there is none", () => {
    expect(studyNoteOf({ id: "n1", title: "T", body: "B", cites: ["u1"], needsReview: "drops the 300 seconds" })).toEqual({ id: "n1", title: "T", body: "B", cites: ["u1"], needsReview: "drops the 300 seconds" });
    expect(studyNoteOf({ id: "n2", title: "T", body: "B", cites: [] })).toEqual({ id: "n2", title: "T", body: "B", cites: [] });
  });

  it("doesn't change the card Lang: the mark is the host's, outside the card", () => {
    const plain = NOTES[0]!;
    const flagged = studyNoteOf({ ...plain, needsReview: "x" });
    expect(flashcardLang(flagged)).toBe(flashcardLang(plain));
    expect(quizLang([flagged, ...NOTES.slice(1)], 0)).toBe(quizLang(NOTES, 0));
  });
});

describe("flashcardLang", () => {
  it("parses cleanly with title as front, body as back and the first cite as unit — quotes and newlines intact", () => {
    for (const note of NOTES) {
      const r = parse(flashcardLang(note)!);
      expect(r.meta.errors).toEqual([]);
      expect(r.root?.typeName).toBe("Flashcard");
      expect(r.root?.props.front).toBe(note.title);
      expect(r.root?.props.back).toBe(note.body);
      expect(r.root?.props.unit).toBe(note.cites[0]);
    }
  });

  it("skips a title-only note (its front and back would both be the title), as the quiz does", () => {
    for (const body of ["", "  \n "]) {
      const note = studyNoteOf({ id: "t", title: "Limits", body, cites: ["u1"] });
      expect(flashcardLang(note)).toBeNull();
      expect(quizLang([note, ...NOTES], 0)).toBeNull();
    }
  });
});

describe("quizLang", () => {
  it("parses cleanly; the answer index points at the note's own title; choices are distinct", () => {
    NOTES.forEach((note, i) => {
      const lang = quizLang(NOTES, i)!;
      const r = parse(lang);
      expect(r.meta.errors).toEqual([]);
      expect(r.root?.typeName).toBe("QuizCard");
      const choices = r.root!.props.choices as string[];
      expect(choices.length).toBe(4);
      expect(new Set(choices).size).toBe(choices.length);
      expect(choices[r.root!.props.answer as number]).toBe(note.title);
      expect(r.root?.props.unit).toBe(note.cites[0]);
    });
  });

  it("is deterministic: same notes, same quiz", () => {
    expect(NOTES.map((_, i) => quizLang(NOTES, i))).toEqual(NOTES.map((_, i) => quizLang([...NOTES], i)));
  });

  it("doesn't always put the answer in the same slot", () => {
    const slots = new Set(NOTES.map((_, i) => parse(quizLang(NOTES, i)!).root!.props.answer));
    expect(slots.size).toBeGreaterThan(1);
  });

  it("uses fewer distractors when there are few notes, and none at all → null", () => {
    const two = quizLang(NOTES.slice(0, 2), 0)!;
    expect(parse(two).root!.props.choices).toHaveLength(2);
    expect(quizLang(NOTES.slice(0, 1), 0)).toBeNull();
    expect(quizLang(NOTES, 99)).toBeNull();
    // A duplicate title is not a distractor.
    expect(quizLang([NOTES[0]!, { ...NOTES[1]!, title: NOTES[0]!.title }], 0)).toBeNull();
  });

  it("skips a title-only note: its stem would give the answer away", () => {
    expect(quizLang([{ id: "a", title: "Where things stand", body: "  ", cites: [] }, { id: "b", title: "Other", body: "x", cites: [] }], 0)).toBeNull();
  });
});
