import { describe, expect, it } from "vitest";
import type { Idea, ProtectedItem, SourceUnit } from "./contracts";
import { actionParts, checkExactness, namedTermsOf, normalizeForCompare, protectedItemsOf } from "./exactness";

function unit(id: string, text: string, kind: SourceUnit["kind"] = "sentence", topic = "t1"): SourceUnit {
  return { id, kind, text, hash: id, topic, span: { start: 0, end: text.length } };
}

function idea(id: string, cites: string[], title: string, body = "", extra: Partial<Idea> = {}): Idea {
  return { id, title, body, cites, ...extra };
}

const itemsOf = (u: SourceUnit) => protectedItemsOf([u]).map((i) => `${i.tier}:${i.kind}:${i.value}`);

describe("normalizeForCompare (§3.3)", () => {
  it("treats thousands separators, unit spellings and small number words as the same", () => {
    expect(normalizeForCompare("1,000")).toBe(normalizeForCompare("1000"));
    expect(normalizeForCompare("1,250,000 rows")).toBe("1250000 rows");
    expect(normalizeForCompare("200 milliseconds")).toBe(normalizeForCompare("200ms"));
    expect(normalizeForCompare("5 percent")).toBe(normalizeForCompare("5%"));
    expect(normalizeForCompare("three retries")).toBe(normalizeForCompare("3 retries"));
  });

  it("compares quantities by value and dimension: number words, unit conversion, percentiles, ranges", () => {
    const eq = (a: string, b: string) => expect(normalizeForCompare(a), `${a} = ${b}`).toBe(normalizeForCompare(b));
    const ne = (a: string, b: string) => expect(normalizeForCompare(a), `${a} ≠ ${b}`).not.toBe(normalizeForCompare(b));
    eq("2,000 files", "two thousand files");
    eq("250 ms", "0.25 seconds");
    eq("the p99 latency", "the 99th-percentile latency");
    eq("4 bits", "4-bit");
    eq("4–8 nodes", "between 4 and 8 nodes");
    eq("a fourfold gain", "a 4x gain");
    ne("1.5 GB", "15 GB");
    ne("200 ms", "200 s");
    ne("4–8 nodes", "8 nodes");
    ne("2,000 files", "two hundred files");
  });

  it("never reads identifiers, versions or paths as quantities", () => {
    expect(normalizeForCompare("Upgrade to v2.5 for HK-3, logs in /var/log/2024.", { keepCase: true })).toBe("Upgrade to v2.5 for HK-3 logs in /var/log/2024");
    expect(normalizeForCompare("Release 1.2.3 on 2024-01-05 at 10:30")).toBe("release 1.2.3 on 2024-01-05 at 10:30");
  });

  it("drops curly quotes, dashes, markdown markers, trailing punctuation and extra whitespace", () => {
    expect(normalizeForCompare("“Ship it” — now.")).toBe(normalizeForCompare('"Ship it" - now'));
    expect(normalizeForCompare("**Bold**   and `code`!")).toBe("bold and code");
    expect(normalizeForCompare("it’s")).toBe("it's");
  });

  it("lower-cases words but never identifiers or paths", () => {
    expect(normalizeForCompare("The Cache")).toBe("the cache");
    expect(normalizeForCompare("Set maxRetries in config/App.yaml", { keepCase: false })).toBe("set maxRetries in config/App.yaml");
    expect(normalizeForCompare("The Cache", { keepCase: true })).toBe("The Cache");
    // 1.5 keeps its decimal point; only trailing punctuation goes.
    expect(normalizeForCompare("Use 1.5.")).toBe("use 1.5");
  });
});

describe("protectedItemsOf (§3.3)", () => {
  it("finds numbers with units, versions, paths and identifiers", () => {
    const items = itemsOf(unit("u1", "Upgrade to v2.4 and set tolerances.aggregate_gap_pct to 0.5 in config/limits.yaml; the timeout is 200 ms."));
    expect(items).toEqual(
      expect.arrayContaining(["exact:version:v2.4", "exact:identifier:tolerances.aggregate_gap_pct", "exact:number:0.5", "exact:path:config/limits.yaml", "exact:number:200 ms"]),
    );
  });

  it("keeps 1,000 as one number, as written", () => {
    expect(itemsOf(unit("u1", "The plan includes 1,000 calls."))).toContain("exact:number:1,000");
  });

  it("protects a quantity whole: with its unit, as a range, as a percentile; never versions or ids as numbers", () => {
    expect(itemsOf(unit("u1", "Latency at p99 stayed under 0.25 seconds."))).toEqual(["exact:number:p99", "exact:number:0.25 seconds"]);
    expect(itemsOf(unit("u1", "Run between 4 and 8 workers."))).toEqual(["exact:number:between 4 and 8"]);
    expect(itemsOf(unit("u1", "Run 4–8 workers."))).toEqual(["exact:number:4-8"]);
    const ids = itemsOf(unit("u1", "Logs in /var/log/2024 since v2.5."));
    expect(ids).toEqual(expect.arrayContaining(["exact:version:v2.5", "exact:path:var/log/2024"]));
    expect(ids.filter((i) => i.startsWith("exact:number"))).toEqual([]);
  });

  it("finds direct quotes (straight or curly) and block quotes, not short scare quotes", () => {
    expect(itemsOf(unit("u1", "She said “we ship on the first of May” at the meeting."))).toContain("exact:quote:we ship on the first of May");
    expect(itemsOf(unit("u1", 'The "fast" path is default.'))).not.toContain("exact:quote:fast");
    expect(itemsOf(unit("u1", "Simplicity is a prerequisite for reliability.", "quote"))).toContain("exact:quote:Simplicity is a prerequisite for reliability.");
  });

  it("finds item ids in list items (via itemIds) and in prose", () => {
    const units = [unit("u1", "D1: use Postgres", "list_item"), unit("u2", "D2: keep the queue", "list_item"), unit("u3", "As HK-3 and #25 say, ship it.")];
    const items = protectedItemsOf(units).filter((i) => i.kind === "item_id");
    expect(items.map((i) => `${i.unit}:${i.value}`)).toEqual(["u1:D1", "u2:D2", "u3:HK-3", "u3:#25"]);
  });

  it("finds action items: checklist items, owners, due dates, TODO / Action:", () => {
    const kinds = (text: string, kind: SourceUnit["kind"] = "sentence") => protectedItemsOf([unit("u1", text, kind)]).map((i) => i.kind);
    expect(kinds("Alice to send the migration plan by Friday.")).toContain("action_item");
    expect(kinds("@bob will review the PR by 2026-11-02.")).toContain("action_item");
    expect(kinds("TODO: update the runbook")).toContain("action_item");
    expect(kinds("Action: Dana to file the ticket")).toContain("action_item");
    expect(kinds("[ ] write the migration", "list_item")).toContain("action_item");
    expect(kinds("The release went out on Monday.")).not.toContain("action_item");
    expect(kinds("Upgrade Node to version 20 next.")).not.toContain("action_item");
  });

  it("takes owner, due date and verb from an action item", () => {
    expect(actionParts("Alice to send the migration plan by Friday.")).toEqual({ owner: "Alice", due: "Friday", verb: "send" });
    expect(actionParts("@bob will review the PR by 2026-11-02")).toEqual({ owner: "@bob", due: "2026-11-02", verb: "review" });
    expect(actionParts("TODO: update the runbook")).toEqual({ verb: "update" });
  });

  it("protects code and table rows whole", () => {
    expect(itemsOf(unit("u1", "npm run build", "code"))).toEqual(["exact:code:npm run build"]);
    expect(itemsOf(unit("u1", "p95 | 210 ms", "table_row"))).toContain("exact:table:p95 | 210 ms");
  });

  it("finds named terms (warn tier): back-ticked, and capitalised words not starting the sentence", () => {
    expect(namedTermsOf("We moved the queue from RabbitMQ to Google Cloud Tasks with `pg_cron`.")).toEqual(["pg_cron", "RabbitMQ", "Google Cloud Tasks"]);
    expect(namedTermsOf("The cache is warm.")).toEqual([]);
    expect(namedTermsOf("PostgreSQL stores the events.")).toEqual(["PostgreSQL"]);
  });
});

describe("checkExactness (§3.3)", () => {
  const units = [
    unit("u1", "The plan includes 1,000 API calls per day and the timeout is 200 milliseconds."),
    unit("u2", "She wrote “never deploy on a Friday” in the handbook."),
    unit("u3", "Alice to send the migration plan by Friday."),
    unit("u4", "SELECT * FROM users;", "code"),
    unit("u5", "Events are stored in PostgreSQL."),
  ];
  const items = protectedItemsOf(units);

  it("passes when protected details survive, after normalisation (1,000 vs 1000, curly quotes, unit spellings)", () => {
    const ideas = [
      idea("n1", ["u1"], "1000 API calls a day", "Timeout: 200ms"),
      idea("n2", ["u2"], "Handbook rule", 'The handbook says "never deploy on a Friday".'),
      idea("n3", ["u3"], "Alice sends the migration plan", "Due Friday."),
      idea("n4", ["u4"], "Query", "", { byReference: true }),
      idea("n5", ["u5"], "Events live in PostgreSQL"),
    ];
    expect(checkExactness(items, ideas)).toEqual({ missing: [], flags: [] });
  });

  it("returns missing exact items: a changed number, a reworded quote, an action item without its date", () => {
    const ideas = [
      idea("n1", ["u1"], "100 API calls a day", "Timeout: 200 ms"),
      idea("n2", ["u2"], "Handbook rule", "Avoid Friday deploys."),
      idea("n3", ["u3"], "Alice sends the migration plan"),
      idea("n4", ["u4"], "Query users", "SELECT everything from users"),
    ];
    const { missing } = checkExactness(items, ideas);
    expect(missing.map((m: ProtectedItem) => `${m.unit}:${m.kind}`)).toEqual(["u1:number", "u2:quote", "u3:action_item", "u4:code"]);
  });

  it("keeps a quantity restated in other words or units; a changed value, unit or collapsed range is missing", () => {
    const qs = [unit("q1", "The upload limit is 2,000 files per batch."), unit("q2", "Latency at p99 stayed under 250 ms."), unit("q3", "Each job uses 4–8 workers and 1.5 GB of memory.")];
    const qItems = protectedItemsOf(qs);
    const kept = [idea("a", ["q1"], "Up to two thousand files per batch"), idea("b", ["q2"], "99th-percentile latency below 0.25 seconds"), idea("c", ["q3"], "Jobs use between 4 and 8 workers and 1500 MB")];
    expect(checkExactness(qItems, kept).missing).toEqual([]);
    const changed = [idea("a", ["q1"], "Up to two hundred files per batch"), idea("b", ["q2"], "p95 latency below 250 seconds"), idea("c", ["q3"], "Jobs use 8 workers and 15 GB")];
    expect(checkExactness(qItems, changed).missing.map((m) => m.value)).toEqual(["2,000", "p99", "250 ms", "4-8", "1.5 GB"]);
  });

  it("is satisfied by any citing card; skips items whose unit no card cites", () => {
    const ideas = [idea("n1", ["u1"], "1,000 API calls per day"), idea("n2", ["u1"], "Timeout is 200 ms")];
    expect(checkExactness(items, ideas).missing).toEqual([]);
  });

  it("flags a changed or missing named term on each citing card, never as missing", () => {
    const { missing, flags } = checkExactness(items, [idea("n5", ["u5"], "Events are stored in Postgres")]);
    expect(missing).toEqual([]);
    expect(flags).toEqual([expect.objectContaining({ code: "named_term_changed", unit: "u5", card: "n5", detail: 'source says "PostgreSQL"; the card says "Postgres"' })]);
  });
});
