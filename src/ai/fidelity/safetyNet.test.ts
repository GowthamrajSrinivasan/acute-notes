import { describe, expect, it } from "vitest";
import { attachUncovered } from "./safetyNet";

const plan = (...nodes: unknown[]) => ({ version: 1, template: "sectioned", nodes, relationships: [] });
const text = (id: string, markdown: string, title?: string) => ({ id, type: "text", ...(title ? { title } : {}), content: { markdown } });

describe("attachUncovered — the content safety net", () => {
  it("adds nothing when the plan covers every unit, even reworded", async () => {
    const source = "The API retries failed requests three times with exponential backoff.";
    const { raw, coverage } = await attachUncovered(plan(text("n1", "Retries: three times, exponential backoff, for failed API requests")), source);
    expect((raw as { nodes: unknown[] }).nodes).toHaveLength(1);
    expect(coverage).toEqual({ total: 1, covered: 1, attached: 0, added: [], keyTerms: { total: 0, placedByAI: 0, missing: [], all: [] } });
  });

  it("attaches the sentences and list items the plan left out, verbatim and in source order", async () => {
    const source = "Caching reduces latency by storing data in memory. It can serve stale data unless entries are invalidated.\n\n- TTL expires entries after a set duration\n- Write-through updates the cache on every write\n";
    const { raw, coverage } = await attachUncovered(plan(text("n1", "Caching reduces latency: data stored in memory")), source);
    const added = (raw as { nodes: { id: string; title?: string; content: { markdown: string } }[] }).nodes.at(-1)!;
    expect(added).toMatchObject({ id: "src~text", title: "Also in the source" });
    expect(added.content.markdown).toBe(
      "It can serve stale data unless entries are invalidated.\n\n- TTL expires entries after a set duration\n- Write-through updates the cache on every write",
    );
    expect(coverage).toMatchObject({ total: 4, covered: 1, attached: 3 });
    expect(coverage.added).toEqual(["It can serve stale data unless entries are invalidated.", "TTL expires entries after a set duration", "Write-through updates the cache on every write"]);
  });

  it("puts a table's missing rows in the \"Source details\" page, as a table with the same columns (Wave B)", async () => {
    const source = "| Code | Tier | Purpose |\n|---|---|---|\n| A1 | Ask | Field-level via the aggregate, or these specific wells? |\n| A2 | Bound | Summed wells differ from the field total by more than the gap threshold |\n| A3 | Ask | The series barely overlap: proceed on the short window, or reframe? |\n";
    const condensed = { id: "t", type: "table", content: { columns: ["Code", "Purpose"], rows: [["A1", "Field-level via aggregate or specific wells"], ["A2", "Summed wells differ from field total"], ["A3", "Overlap check"]] } };
    const { raw, coverage } = await attachUncovered(plan(condensed), source);
    const added = (raw as { nodes: { id: string; type: string; content: { title: string; markdown: string } }[] }).nodes.filter((n) => n.id.startsWith("src~"));
    // One page, one click away: never a second table beside the AI's own.
    expect(added).toHaveLength(1);
    expect(added[0]).toMatchObject({ type: "page", content: { title: "Source details" } });
    expect(added[0]!.content.markdown).toBe(
      "| Code | Tier | Purpose |\n|---|---|---|\n| A2 | Bound | Summed wells differ from the field total by more than the gap threshold |\n| A3 | Ask | The series barely overlap: proceed on the short window, or reframe? |",
    );
    expect(coverage).toMatchObject({ total: 3, covered: 1, attached: 2 });
    expect(coverage.added[0]).toMatch(/^A2 · Bound · Summed wells/);
  });

  it("more than a couple of missing lines go in the page too, with code as a fenced block", async () => {
    const long = Array.from({ length: 6 }, (_, i) => `Point ${i + 1} explains another separate detail of the caching design in words.`).join(" ");
    const source = `${long}\n\n\`\`\`sh\nredis-cli flushall\n\`\`\`\n`;
    const { raw } = await attachUncovered(plan(text("n1", "Caching design")), source);
    const nodes = (raw as { nodes: { id: string; type: string; content: { markdown: string } }[] }).nodes;
    expect(nodes.map((n) => n.type)).toEqual(["text", "page"]);
    // One paragraph, as the source wrote it: never cut into a bullet per sentence.
    expect(nodes[1]!.content.markdown).toMatch(/^Point 1 explains .+ words\. Point 2 explains/);
    expect(nodes[1]!.content.markdown).toContain("```sh\nredis-cli flushall\n```");
  });

  it("keeps a list's lead-in only with the items it introduces, and the items' own Markdown", async () => {
    const source =
      "Before, a claim in a unit the checker had no rule for was rejected even when it was correct. That included degF and lbm/d.\n\n" +
      "Now the checks look the unit up in the dictionary:\n\n" +
      "- **A unit the checker didn't know** is recognised from the dictionary's unit list.\n" +
      "- **Temperature** is the one exception: °F and °C differ by an offset, so a factor can't convert them.\n";
    const covered = text("n1", "Before: a claim in a unit the checker had no rule for was rejected even when correct. That included degF and lbm/d. A unit the checker didn't know is recognised from the dictionary's unit list.");
    const { raw } = await attachUncovered(plan(covered), source);
    const added = (raw as { nodes: { content: { markdown: string } }[] }).nodes.at(-1)!;
    expect(added.content.markdown).toBe(
      "Now the checks look the unit up in the dictionary:\n\n- **Temperature** is the one exception: °F and °C differ by an offset, so a factor can't convert them.",
    );

    // Every item covered: the lead-in alone is never attached, dangling.
    const all = text("n1", `${covered.content.markdown} Temperature is the one exception: °F and °C differ by an offset, so a factor can't convert them.`);
    const { raw: none, coverage } = await attachUncovered(plan(all), source);
    expect((none as { nodes: unknown[] }).nodes).toHaveLength(1);
    expect(coverage).toMatchObject({ covered: coverage.total, attached: 0 });
  });

  it("keeps numbers and identifiers: a row that lost its thresholds is not covered", async () => {
    const source = "- Gap threshold: tolerances.aggregate_gap_pct (0.5), window tolerances.window_endpoint_days (1)\n";
    const { coverage } = await attachUncovered(plan(text("n1", "Gap threshold and window tolerances")), source);
    expect(coverage.attached).toBe(1);
    expect(coverage.keyTerms).toMatchObject({ total: 4, placedByAI: 0, missing: ["tolerances.aggregate_gap_pct", "0.5", "tolerances.window_endpoint_days", "1"] });
  });

  it("returns a reply that isn't plan-shaped as is", async () => {
    expect(await attachUncovered("not a plan", "Some text here.")).toMatchObject({ raw: "not a plan", coverage: { total: 0, covered: 0, attached: 0 } });
  });
});
