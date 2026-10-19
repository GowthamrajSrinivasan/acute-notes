import { beforeAll, describe, expect, it } from "vitest";
import { loadMarkdownParser, parseMarkdownWith } from "@/ai/content/parser";
import type { ParsedContent } from "@/ai/content/types";
import { headingRenames, nextPathIds, rekey } from "./topicIds";

let parse: (md: string) => ParsedContent;
beforeAll(async () => {
  const fromMarkdown = await loadMarkdownParser();
  parse = (md) => parseMarkdownWith(fromMarkdown, md);
});

const renames = (a: string, b: string) => headingRenames(parse(a), a, parse(b), b);
const ids = (previousIds: Record<string, string> | undefined, a: string, b: string) => nextPathIds(previousIds, parse(a), a, parse(b), b);

const DOC = "# Launch\n\n## Risks\n\nThe gateway may time out under heavy load during the launch window.\n\n## Owners\n\nPayments team.\n";

describe("rekey", () => {
  const map = { "Launch › Team": "Launch › Owners", C: "Lang" };

  it("replaces the longest listed path prefix at a key boundary", () => {
    expect(rekey("Launch › Team", map)).toBe("Launch › Owners");
    expect(rekey("Launch › Team#text0", map)).toBe("Launch › Owners#text0");
    expect(rekey("Launch › Team › Detail#list0", map)).toBe("Launch › Owners › Detail#list0");
    expect(rekey("Launch › Team #2", map)).toBe("Launch › Owners #2");
    expect(rekey("Launch › Team ·1", map)).toBe("Launch › Owners ·1");
    expect(rekey("Launch › Team § n1", map)).toBe("Launch › Owners § n1");
    expect(rekey("Launch › Team#ascii:tree:root", map)).toBe("Launch › Owners#ascii:tree:root");
  });

  it("never matches inside a heading's own text", () => {
    expect(rekey("Launch › Teamwork#text0", map)).toBe("Launch › Teamwork#text0");
    expect(rekey("C# basics#text0", map)).toBe("C# basics#text0");
    expect(rekey("C#text0", map)).toBe("Lang#text0");
  });

  it("leaves keys alone without a map", () => {
    expect(rekey("Launch › Team#text0", undefined)).toBe("Launch › Team#text0");
  });
});

describe("headingRenames", () => {
  it("an identical body under a new heading is a rename", () => {
    expect(renames(DOC, DOC.replace("## Owners", "## Team"))).toEqual({ "Launch › Team": "Launch › Owners" });
  });

  it("a body with most of its significant words is still the same section", () => {
    const next = DOC.replace("## Risks", "## Known risks").replace("heavy load", "heavy traffic");
    expect(renames(DOC, next)).toEqual({ "Launch › Known risks": "Launch › Risks" });
  });

  it("a different body is a different section", () => {
    expect(renames(DOC, DOC.replace("## Owners\n\nPayments team.", "## Rollout\n\nOne region first."))).toEqual({});
  });

  it("a short body must be identical (too few words to compare)", () => {
    expect(renames(DOC, DOC.replace("## Owners\n\nPayments team.", "## Team\n\nPayments squad."))).toEqual({});
  });

  it("only sections under the same parent are compared", () => {
    const a = "# A\n\n## X\n\nshared body words here today\n\n# B\n\n## Y\n\nother text entirely different\n";
    const b = "# A\n\n## Y2\n\nother text entirely different\n\n# B\n\n## X2\n\nshared body words here today\n";
    expect(renames(a, b)).toEqual({});
  });

  it("a renamed parent carries its subsections; a subsection renamed too is matched under it", () => {
    const a = "# Plan\n\n## Storage\n\nUse Firestore for documents and assets.\n\n### Backups\n\nNightly exports to a bucket.\n";
    const b = "# Plan\n\n## Data layer\n\nUse Firestore for documents and assets.\n\n### Snapshots\n\nNightly exports to a bucket.\n";
    expect(renames(a, b)).toEqual({ "Plan › Data layer": "Plan › Storage", "Plan › Data layer › Snapshots": "Plan › Storage › Backups" });
  });

  it("repeated headings are never matched", () => {
    const a = "## Notes\n\nalpha beta gamma delta\n\n## Notes\n\nepsilon zeta eta theta\n";
    const b = "## Notes\n\nalpha beta gamma delta\n\n## Other\n\nepsilon zeta eta theta\n";
    expect(renames(a, b)).toEqual({});
  });

  it("matching is one-to-one, best first", () => {
    const a = "## One\n\nred green blue yellow purple\n\n## Two\n\nred green blue yellow orange\n";
    const b = "## Uno\n\nred green blue yellow purple\n";
    expect(renames(a, b)).toEqual({ Uno: "One" });
  });
});

describe("nextPathIds", () => {
  it("is undefined when nothing was renamed", () => {
    expect(ids(undefined, DOC, DOC.replace("Payments team.", "Payments and Risk teams."))).toBeUndefined();
  });

  it("lists a renamed section and its subsections under their ids", () => {
    const a = "# Plan\n\n## Storage\n\nUse Firestore for documents and assets.\n\n### Backups\n\nNightly exports to a bucket.\n";
    const b = a.replace("## Storage", "## Data layer");
    expect(ids(undefined, a, b)).toEqual({ "Plan › Data layer": "Plan › Storage", "Plan › Data layer › Backups": "Plan › Storage › Backups" });
  });

  it("carries an earlier rename forward, and composes a second rename onto the first id", () => {
    const v2 = DOC.replace("## Owners", "## Team");
    const first = ids(undefined, DOC, v2);
    expect(ids(first, v2, v2.replace("Payments team.", "Payments squad."))).toEqual({ "Launch › Team": "Launch › Owners" });
    expect(ids(first, v2, v2.replace("## Team", "## People"))).toEqual({ "Launch › People": "Launch › Owners" });
  });
});
