import { describe, expect, it } from "vitest";
import type { Idea, ReviewCode, SourceUnit } from "./contracts";
import { checkMeaning, stem } from "./meaning";

function unit(id: string, text: string): SourceUnit {
  return { id, kind: "sentence", text, hash: id, topic: "t1", span: { start: 0, end: text.length } };
}

function codes(card: string, source: string | string[], extra: Partial<Idea> = {}): ReviewCode[] {
  const units = (Array.isArray(source) ? source : [source]).map((t, i) => unit(`u${i + 1}`, t));
  return checkMeaning({ id: "n1", title: card, body: "", cites: units.map((u) => u.id), ...extra }, units).map((f) => f.code);
}

describe("stem", () => {
  it("folds common endings", () => {
    expect(new Set(["cache", "cached", "caches", "caching"].map(stem)).size).toBe(1);
    expect(new Set(["retry", "retries", "retried", "retrying"].map(stem)).size).toBe(1);
  });
});

describe("checkMeaning (§3.4)", () => {
  it("dropped qualifier: a hedge or limit the card loses", () => {
    expect(codes("Hybrid search improves retrieval.", "Hybrid search can improve retrieval.")).toEqual(["qualifier_dropped"]);
    expect(codes("Hybrid search may improve retrieval.", "Hybrid search can improve retrieval.")).toEqual([]);
    expect(codes("The client retries 3 times.", "The client retries up to 3 times.")).toEqual(["qualifier_dropped"]);
    expect(codes("The client retries at most three times.", "The client retries up to 3 times.")).toEqual([]);
  });

  it("dropped caveat on the same claim: caveat_dropped", () => {
    expect(codes("The columnar format is faster.", "The columnar format is faster but uses more disk space.")).toEqual(["caveat_dropped"]);
    expect(codes("The columnar format is faster at the price of extra disk space.", "The columnar format is faster but uses more disk space.")).toEqual([]);
  });

  it("dropped or changed condition, widening, unless → if", () => {
    const source = "Caching reduces latency when the cache contains a valid result.";
    expect(codes("Caching reduces latency if a valid result is cached.", source)).toEqual([]);
    expect(codes("Caching reduces latency whenever the cache is used.", source)).toEqual(["condition_changed"]);
    expect(codes("Caching reduces latency.", source)).toEqual(["condition_changed"]);
    expect(codes("Refunds are issued if the order has shipped.", "Refunds are issued unless the order has shipped.")).toContain("condition_changed");
  });

  it("dropped scope", () => {
    expect(codes("Read replicas are recommended.", "Read replicas are recommended for read-only workloads.")).toEqual(["condition_changed"]);
    expect(codes("Price alerts go to subscribers.", "Price alerts are sent to premium subscribers only.")).toEqual(["condition_changed"]);
    expect(codes("Only premium subscribers get price alerts.", "Price alerts are sent to premium subscribers only.")).toEqual([]);
  });

  it("changed cause or effect: swapped, opposite direction, or a cause the source doesn't state", () => {
    expect(codes("The queue backing up causes slow disk writes.", "Slow disk writes cause the queue to back up.")).toEqual(["cause_changed"]);
    expect(codes("The queue backs up because disk writes are slow.", "Slow disk writes cause the queue to back up.")).toEqual([]);
    expect(codes("Caching increases database load.", "Caching reduces database load.")).toEqual(["cause_changed"]);
    expect(codes("The redesign caused the rise in sign-ups.", "Sign-ups rose after the redesign.")).toEqual(["cause_changed"]);
  });

  it("added absolute", () => {
    expect(codes("Hybrid search always improves retrieval.", "Hybrid search improves retrieval on long queries.")).toContain("absolute_added");
    expect(codes("The importer never retries failed rows.", "The importer does not retry failed rows.")).toEqual([]);
  });

  it("negation flip, both ways", () => {
    expect(codes("The importer retries failed rows.", "The importer does not retry failed rows.")).toEqual(["negation_flip"]);
    expect(codes("Failed rows are not retried by the importer.", "The importer does not retry failed rows.")).toEqual([]);
    expect(codes("Webhooks are not signed.", "Webhooks are signed with the account key.")).toEqual(["negation_flip"]);
    expect(codes("The free tier allows no more than five projects.", "The free tier allows at most five projects.")).toEqual([]);
  });

  it("negation kept without a negator: a negative verb, or a cap for a negated excess", () => {
    expect(codes("Python 3.7 support was removed from the SDK.", "The SDK no longer supports Python 3.7.")).toEqual([]);
    expect(codes("The page stays loaded when the theme changes.", "Changing the theme does not reload the page.")).toEqual([]);
    expect(codes("The SDK supports Python 3.7.", "The SDK no longer supports Python 3.7.")).toEqual(["negation_flip"]);
    expect(codes("Changing the theme reloads the page.", "Changing the theme does not reload the page.")).toEqual(["negation_flip"]);
    // "cannot … more than N" = "at most N"; without the cap the negation is gone.
    expect(codes("A trial account can invite at most two teammates.", "Trial accounts cannot invite more than two teammates.")).toEqual([]);
    expect(codes("A trial account can invite two teammates.", "Trial accounts cannot invite more than two teammates.")).toContain("negation_flip");
    // A negative verb on the card never creates a negation the source lacks.
    expect(codes("Webhooks are signed; unsigned events are dropped.", "Webhooks are signed with the account key.")).not.toContain("negation_flip");
  });

  it("double negation: stated plainly is kept; one negation left is a flip", () => {
    const source = "The service never deletes data without a confirmation step.";
    expect(codes("Data is deleted only after a confirmation step.", source)).toEqual([]);
    expect(codes("The service deletes data without a confirmation step.", source)).toEqual(["negation_flip"]);
    const licence = "Without a valid licence key, the plugin will not start.";
    expect(codes("The plugin won't start unless a valid licence key is present.", licence)).toEqual([]);
    expect(codes("The plugin starts without a licence key.", licence)).toEqual(["negation_flip"]);
  });

  it("rubric rule 8: a requirement for N means at least N; a limit or an exact count is different", () => {
    const source = "At least two approvals are required before merging.";
    expect(codes("Two approvals are required before merging.", source)).toEqual([]);
    expect(codes("Merging needs two approvals.", source)).toEqual([]);
    expect(codes("Exactly two approvals are required before merging.", source)).toEqual(["qualifier_dropped"]);
    expect(codes("Two replicas are running.", "At least two replicas are running.")).toEqual(["qualifier_dropped"]);
    expect(codes("The client needs 3 retries.", "The client retries up to 3 times.")).toEqual(["qualifier_dropped"]);
  });

  it("an ability kept as an -able adjective", () => {
    expect(codes("Deleted pages are restorable by admins for 30 days.", "Admins can restore deleted pages for 30 days.")).toEqual([]);
    expect(codes("Admins restore deleted pages for 30 days.", "Admins can restore deleted pages for 30 days.")).toEqual(["qualifier_dropped"]);
  });

  it("a restricting caveat reworded as a restriction, without the contrast word", () => {
    const source = "The scheduler supports cron syntax, but time zones other than UTC are not supported yet.";
    expect(codes("Cron syntax works in the scheduler; only UTC is supported for now.", source)).toEqual([]);
    expect(codes("The scheduler supports cron syntax and UTC.", source)).toContain("caveat_dropped");
  });

  it("a restriction (only) the card restates without restricting", () => {
    const source = "The mobile app syncs photos over Wi-Fi only, to avoid using mobile data.";
    expect(codes("The mobile app syncs photos over Wi-Fi and mobile data.", source)).toEqual(["condition_changed"]);
    expect(codes("To save mobile data, photo sync happens only on Wi-Fi.", source)).toEqual([]);
    expect(codes("Photos sync exclusively over Wi-Fi.", "Photos sync over Wi-Fi only.")).toEqual([]);
    expect(codes("The tool lints and formats code.", "The tool not only lints but also formats code.")).toEqual([]);
    expect(codes("5% of requests fail.", "Only 5% of requests fail.")).toEqual([]);
    expect(codes("The report covers the last 90 days.", "The report only covers the last 90 days.")).toEqual([]);
  });

  it("a trade-off's cost inverted into its better side, or negated", () => {
    const source = "Nightly batch sync keeps the API fast, but dashboard numbers arrive later.";
    expect(codes("Nightly batch sync keeps the API fast and dashboard numbers current.", source)).toEqual(["caveat_dropped"]);
    expect(codes("Nightly batch sync keeps the API fast; dashboard numbers lag behind.", source)).toEqual([]);
    const batching = "Batching notifications reduces noise but delays urgent alerts.";
    expect(codes("Batching notifications reduces noise without delaying anything.", batching)).toEqual(["caveat_dropped"]);
    expect(codes("Batched notifications are less noisy, though urgent alerts arrive later.", batching)).toEqual([]);
    const managed = "The managed database saves operations work but costs more per month than self-hosting.";
    expect(codes("The managed database saves operations work and money compared with self-hosting.", managed)).toEqual(["caveat_dropped"]);
    expect(codes("Managed hosting costs more monthly than self-hosting, in exchange for less operations work.", managed)).toEqual([]);
    // A better word about the claim, not the cost, is no inversion.
    expect(codes("Reads get faster with caching, at the cost of more memory.", "Caching makes reads faster but uses more memory.")).toEqual([]);
    expect(codes("Serverless saves on idle costs; the trade-off is cold-start latency.", "Serverless functions cut idle costs, though cold starts add latency.")).toEqual([]);
  });

  it("unsupported number or identifier, including a changed unit", () => {
    expect(codes("Reranking gives a 3× boost.", "Reranking gives a boost on long documents.")).toContain("unsupported_number");
    expect(codes("Timeout is 200 s.", "The timeout is 200 ms.")).toEqual(["unsupported_number"]);
    expect(codes("The plan has 1000 calls.", "The plan has 1,000 calls.")).toEqual([]);
    expect(codes("Set retry_max in the config.", "Set the retry limit in the config.")).toContain("unsupported_number");
  });

  it("unsupported number compares quantities, not digits: words, units, percentiles, '4-bit'", () => {
    expect(codes("A batch can contain up to two thousand files.", "The upload limit is 2,000 files per batch.")).not.toContain("unsupported_number");
    expect(codes("The 99th-percentile latency remained below 0.25 seconds.", "Latency at p99 stayed under 250 ms.")).not.toContain("unsupported_number");
    expect(codes("A 4-bit quantized model takes less memory.", "Quantizing the model to 4 bits shrinks its memory footprint.")).not.toContain("unsupported_number");
    expect(codes("Median latency is 40 ms.", "The p50 latency is 40 ms.")).toEqual([]);
    expect(codes("Snapshots take 1500 MB.", "Snapshots take 1.5 GB.")).toEqual([]);
  });

  it("unsupported number still catches a different number, unit, percentile or a collapsed range", () => {
    expect(codes("A batch can contain up to two hundred files.", "The upload limit is 2,000 files per batch.")).toContain("unsupported_number");
    expect(codes("The 95th-percentile latency remained below 0.25 seconds.", "Latency at p99 stayed under 250 ms.")).toContain("unsupported_number");
    expect(codes("Latency at p99 stayed under 2.5 seconds.", "Latency at p99 stayed under 250 ms.")).toContain("unsupported_number");
    expect(codes("Snapshots take 15 GB.", "Snapshots take 1.5 GB.")).toContain("unsupported_number");
    expect(codes("An 8-bit quantized model takes less memory.", "Quantizing the model to 4 bits shrinks its memory footprint.")).toContain("unsupported_number");
    expect(codes("Each job uses 8 workers.", "Each job uses 4–8 workers.")).toContain("unsupported_number");
    expect(codes("Each job uses between four and eight workers.", "Each job uses 4–8 workers.")).not.toContain("unsupported_number");
  });

  it("citation sanity: a cited unit that shares nothing with the card", () => {
    expect(codes("Caching reduces latency.", ["Caching reduces latency.", "The office is closed on Fridays."])).toEqual(["citation_unrelated"]);
  });

  it("analysis cards skip the unsupported rules but keep the others", () => {
    const analysis = { origin: "analysis" as const };
    expect(codes("This always means a 3× boost; the office matters.", ["Reranking helps long documents.", "Totally unrelated words here."], analysis)).toEqual([]);
    expect(codes("Reranking helps long documents, so retrieval is better.", "Reranking helps long documents.", analysis)).toEqual([]);
    expect(codes("The importer retries failed rows.", "The importer does not retry failed rows.", analysis)).toEqual(["negation_flip"]);
  });

  it("skips cards placed by reference, and carries unit, card and evidence on flags", () => {
    expect(codes("Totally different.", "Caching reduces latency.", { byReference: true })).toEqual([]);
    const flags = checkMeaning({ id: "n7", title: "Caching increases load.", body: "", cites: ["u1"] }, [unit("u1", "Caching reduces load.")]);
    expect(flags).toEqual([{ code: "cause_changed", unit: "u1", card: "n7", detail: 'source says "reduces"; the card says "increases"', evidence: { source: "reduces", card: "increases" } }]);
    const card = checkMeaning({ id: "n8", title: "It always works.", body: "", cites: ["u1"] }, [unit("u1", "It works.")]);
    expect(card[0]).toMatchObject({ code: "absolute_added", card: "n8" });
    expect(card[0]!.unit).toBeUndefined();
  });

  it("reads the card's body as well as its title", () => {
    expect(codes("Retries", "Source", {})).toEqual(["citation_unrelated"]);
    const flags = checkMeaning({ id: "n1", title: "Importer", body: "- retries failed rows", cites: ["u1"] }, [unit("u1", "The importer does not retry failed rows.")]);
    expect(flags.map((f) => f.code)).toEqual(["negation_flip"]);
  });
});
