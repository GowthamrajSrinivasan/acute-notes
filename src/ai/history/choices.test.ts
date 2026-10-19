import { describe, expect, it } from "vitest";
import { findChoices, formatChoice, IN_NOTES, resolveChoice, withoutChoices } from "./choices";

const OPEN = `> [!choice] Database for v1
> - Firestore for documents and assets. _(in your notes)_
> - Postgres via Supabase. _(from “Merged content”, 2026-10-09)_`;

const NOTES = `## Storage

We use Firestore for documents and assets. Attachments stay as blobs.

${OPEN}
`;

describe("findChoices", () => {
  it("reads a callout: title, options, which one the notes say, where it is", () => {
    const [c] = findChoices(NOTES);
    expect(c).toMatchObject({
      id: "database-for-v1",
      title: "Database for v1",
      resolved: false,
      options: [
        { statement: "Firestore for documents and assets.", from: IN_NOTES, inNotes: true, state: "open" },
        { statement: "Postgres via Supabase.", from: "from “Merged content”, 2026-10-09", inNotes: false, state: "open" },
      ],
    });
    expect(NOTES.slice(c!.span.start, c!.span.end)).toBe(OPEN);
  });

  it("gives two choices with the same title different ids", () => {
    expect(findChoices(`${OPEN}\n\n${OPEN}`).map((c) => c.id)).toEqual(["database-for-v1", "database-for-v1-2"]);
  });

  it("is not fooled by an ordinary quote", () => {
    expect(findChoices("> Just a quote\n> - with a list\n")).toEqual([]);
  });
});

describe("formatChoice / round trip", () => {
  it("formats what it reads", () => {
    const [c] = findChoices(NOTES);
    expect(formatChoice(c!)).toBe(OPEN);
  });
});

describe("withoutChoices", () => {
  it("is the text a model sees: the callouts gone, nothing else", () => {
    expect(withoutChoices(NOTES)).toBe("## Storage\n\nWe use Firestore for documents and assets. Attachments stay as blobs.\n\n");
    expect(withoutChoices("No choices here.\n")).toBe("No choices here.\n");
  });
});

describe("resolveChoice", () => {
  it("choosing the option the notes say records it and leaves the notes' text alone", () => {
    const out = resolveChoice(NOTES, "database-for-v1", 0);
    expect(out).toContain("> [!choice] Database for v1 — chosen\n> - **Firestore for documents and assets.** _(in your notes)_\n> - ~~Postgres via Supabase.~~ _(from “Merged content”, 2026-10-09)_");
    expect(withoutChoices(out)).toBe(withoutChoices(NOTES));
    expect(findChoices(out)[0]).toMatchObject({ resolved: true, options: [{ state: "chosen" }, { state: "not_chosen" }] });
  });

  it("choosing another option replaces the notes' statement with it, outside the callout", () => {
    const out = resolveChoice(NOTES, "database-for-v1", 1);
    expect(withoutChoices(out)).toContain("We use Postgres via Supabase. Attachments stay as blobs.");
    // The callout still names both, the chosen one first.
    expect(out).toContain("> - **Postgres via Supabase.** _(from “Merged content”, 2026-10-09)_\n> - ~~Firestore for documents and assets.~~ _(in your notes)_");
  });

  it("an unknown choice or option changes nothing", () => {
    expect(resolveChoice(NOTES, "nope", 0)).toBe(NOTES);
    expect(resolveChoice(NOTES, "database-for-v1", 5)).toBe(NOTES);
  });
});
