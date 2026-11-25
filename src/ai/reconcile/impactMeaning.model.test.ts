/**
 * #14 (intelligent-update-engine-plan §19.6): MiniLM-L6's same-claim thresholds (`LOCAL_MODELS["minilm-l6"].thresholds.claim`)
 * on hand-written sentence pairs. Runs only when the weights are cached (`node_modules/.cache/acute-embedding-models`,
 * as the embed route's test); offline, no download, nothing spent. Vectors go through the route's one-byte quantisation,
 * as the browser gets them.
 *
 * Each pair: a claim, a card's sentence, and whether it states the same claim. Both kinds share the changed value and other
 * words, so word overlap can't tell them apart. DEV and TEST shaped the rule (TEST was run once on an earlier rule, then the
 * rule changed after the in-app check, §19.6); HELD was written before the final rule's single run, and its result is
 * pinned below as measured.
 */
import { existsSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { dequantize, quantize, type EmbeddingProvider } from "@/ai/router/embeddingProvider";
import { LocalModelProvider } from "@/ai/router/localModelEmbedding";
import { judgeClaims, type ClaimVerdict } from "./impactMeaning";

const CACHE = path.join(process.cwd(), "node_modules", ".cache", "acute-embedding-models");
const cached = existsSync(path.join(CACHE, "Xenova", "all-MiniLM-L6-v2"));

type Pair = readonly [claim: string, sentence: string, same: boolean];

const DEV: readonly Pair[] = [
  ["Retries happen five times before the job fails.", "Our worker retries five times on failure.", true],
  ["Retries happen five times before the job fails.", "The job is retried five times before it is marked failed.", true],
  ["Retries happen five times before the job fails.", "Failed jobs get five retries.", true],
  ["The API rate limit is 100 requests per minute.", "Clients may send 100 requests per minute.", true],
  ["The API rate limit is 100 requests per minute.", "Rate limiting caps each key at 100 requests a minute.", true],
  ["Sessions expire after 30 minutes of inactivity.", "An idle session is closed after 30 minutes.", true],
  ["Sessions expire after 30 minutes of inactivity.", "Sessions time out after 30 minutes without activity.", true],
  ["The team meets every Tuesday at 10am.", "Our weekly team meeting is on Tuesday at 10am.", true],
  ["Backups are kept for 14 days.", "We retain backup snapshots for 14 days.", true],
  ["The free plan includes 3 projects.", "Free accounts can create 3 projects.", true],
  ["The cache holds 512 entries.", "Our cache is limited to 512 entries.", true],
  ["Water boils at 100 degrees at sea level.", "At sea level, water boils at 100 degrees.", true],
  ["Timeouts happen five times a day.", "Our worker retries five times on failure.", false],
  ["Retries happen five times before the job fails.", "Deploys happen five times a week.", false],
  ["The API rate limit is 100 requests per minute.", "The dashboard shows 100 requests per page.", false],
  ["Sessions expire after 30 minutes of inactivity.", "Reports are emailed after 30 minutes of processing.", false],
  ["The team meets every Tuesday at 10am.", "Releases ship every Tuesday at 10am.", false],
  ["Backups are kept for 14 days.", "Logs are kept for 14 days.", false],
  ["The free plan includes 3 projects.", "The pro plan includes 3 seats.", false],
  ["The cache holds 512 entries.", "The queue holds 512 entries.", false],
  ["Water boils at 100 degrees at sea level.", "The oven heats to 100 degrees at most.", false],
  ["Retries happen five times before the job fails.", "Timeouts happen five times before the job fails.", false],
];

const TEST: readonly Pair[] = [
  ["The build takes 12 minutes on CI.", "CI builds finish in about 12 minutes.", true],
  ["Invoices are due within 30 days.", "Customers have 30 days to pay an invoice.", true],
  ["The battery lasts 10 hours.", "On a full charge the battery runs for 10 hours.", true],
  ["Passwords must be at least 8 characters.", "A password needs 8 or more characters.", true],
  ["The office opens at 9am on weekdays.", "On weekdays we open the office at 9am.", true],
  ["The model was trained on 2 million images.", "Training used a dataset of 2 million images.", true],
  ["Refunds are processed within 5 business days.", "It takes 5 business days to process a refund.", true],
  ["The conference is held in Berlin.", "Berlin hosts the conference this year.", true],
  ["Each worker uses 4 GB of memory.", "A single worker needs 4 GB of RAM.", true],
  ["The bridge is 300 metres long.", "The bridge spans 300 metres.", true],
  ["The build takes 12 minutes on CI.", "The deploy takes 12 minutes on staging.", false],
  ["Invoices are due within 30 days.", "Returns are accepted within 30 days.", false],
  ["The battery lasts 10 hours.", "The flight lasts 10 hours.", false],
  ["Passwords must be at least 8 characters.", "Usernames must be at least 8 characters.", false],
  ["The office opens at 9am on weekdays.", "The gym closes at 9am on weekdays.", false],
  ["The model was trained on 2 million images.", "The website gets 2 million visits.", false],
  ["Refunds are processed within 5 business days.", "Orders ship within 5 business days.", false],
  ["The conference is held in Berlin.", "Our headquarters is in Berlin.", false],
  ["Each worker uses 4 GB of memory.", "Each worker writes 4 GB of logs a day.", false],
  ["The bridge is 300 metres long.", "The tower is 300 metres tall.", false],
];

const HELD: readonly Pair[] = [
  ["The trial lasts 14 days.", "New users get a 14-day trial period.", true],
  ["Builds run on Node 20.", "Our CI pipeline uses Node 20 for every build.", true],
  ["The API returns 50 items per page.", "Each page of results holds 50 items.", true],
  ["Support replies within 24 hours.", "Customers hear back from support in under 24 hours.", true],
  ["Uploads are limited to 10 MB.", "Files larger than 10 MB can't be uploaded.", true],
  ["The meeting starts at 3pm.", "We begin the meeting at 3pm.", true],
  ["Logs are kept for 90 days.", "We delete log files after 90 days.", true],
  ["The team has six engineers.", "Six engineers work on the team.", true],
  ["Tokens expire after 15 minutes.", "An access token is valid for 15 minutes.", true],
  ["The server runs on port 8080.", "Port 8080 is where the server listens.", true],
  ["The trial lasts 14 days.", "The refund window lasts 14 days.", false],
  ["Builds run on Node 20.", "Builds run on 20 machines.", false],
  ["The API returns 50 items per page.", "The admin page lists 50 users.", false],
  ["Support replies within 24 hours.", "Invoices are sent within 24 hours.", false],
  ["Uploads are limited to 10 MB.", "Emails are limited to 10 recipients.", false],
  ["The meeting starts at 3pm.", "The office closes at 3pm on Fridays.", false],
  ["Logs are kept for 90 days.", "Passwords must be changed every 90 days.", false],
  ["The team has six engineers.", "The building has six floors.", false],
  ["Tokens expire after 15 minutes.", "Coffee breaks last 15 minutes.", false],
  ["The server runs on port 8080.", "The proxy runs on port 8080.", false],
];

/** HELD's one run (2026-11-24): every true restatement kept; 7 of 10 different claims dropped, 3 left as word overlap had them. */
const HELD_RESULT = { same: { same: 10, unsure: 0, other: 0 }, different: { same: 2, unsure: 1, other: 7 } };

/** The cached model, its vectors quantised to one byte per dimension and back, as the embed route serves them. */
function asServed(model: LocalModelProvider): EmbeddingProvider {
  return {
    id: model.id,
    dims: model.dims,
    kind: model.kind,
    thresholds: model.thresholds,
    ready: () => model.ready(),
    embed: async (texts) => (await model.embed(texts)).map((v) => dequantize(quantize(v))),
  };
}

/** Per kind of pair, how many got each verdict. "other" drops a word-overlap offer; "same" lists a sentence word overlap missed. */
async function verdicts(pairs: readonly Pair[]) {
  const model = new LocalModelProvider("minilm-l6", { cacheDir: CACHE });
  expect((await model.ready()).state).toBe("ready");
  const provider = asServed(model);
  const judged = await judgeClaims(provider, provider.thresholds.claim!, pairs.map(([claim, sentence]) => [sentence, claim] as const));
  const count = (same: boolean, v: ClaimVerdict) => pairs.filter((p, i) => p[2] === same && judged[i]!.verdict === v).length;
  return {
    same: { same: count(true, "same"), unsure: count(true, "unsure"), other: count(true, "other") },
    different: { same: count(false, "same"), unsure: count(false, "unsure"), other: count(false, "other") },
  };
}

describe.skipIf(!cached)("#14 — MiniLM-L6 same-claim thresholds (cached weights)", () => {
  for (const [name, pairs] of [["dev", DEV], ["test", TEST]] as const) {
    it(`${name}: no true restatement is dropped`, async () => {
      const r = await verdicts(pairs);
      console.info(`[#14 ${name}]`, JSON.stringify(r));
      expect(r.same.other).toBe(0);
    }, 120_000);
  }

  it("held (written before the rule's one run): as measured", async () => {
    const r = await verdicts(HELD);
    console.info("[#14 held]", JSON.stringify(r));
    expect(r).toEqual(HELD_RESULT);
  }, 120_000);
});
