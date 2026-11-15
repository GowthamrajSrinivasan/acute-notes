import { describe, expect, it } from "vitest";
import { canonicalQuantity, normalizeQuantities, quantitiesOf, sameQuantity, supportsQuantity } from "./quantities";

/** The one quantity in a text, canonical. */
function one(text: string): string {
  const qs = quantitiesOf(text);
  expect(qs, text).toHaveLength(1);
  return canonicalQuantity(qs[0]!);
}

const eq = (a: string, b: string) => {
  const [qa] = quantitiesOf(a);
  const [qb] = quantitiesOf(b);
  expect(qa && qb && sameQuantity(qa, qb), `${a} = ${b}`).toBe(true);
};
const ne = (a: string, b: string) => {
  const [qa] = quantitiesOf(a);
  const [qb] = quantitiesOf(b);
  expect(Boolean(qa && qb && sameQuantity(qa, qb)), `${a} ≠ ${b}`).toBe(false);
};

describe("quantitiesOf: numbers", () => {
  it("reads digits with thousands separators and decimals", () => {
    expect(one("2,000 files")).toBe("2000");
    expect(one("1,250,000 rows")).toBe("1250000");
    expect(one("a ratio of 0.25")).toBe("0.25");
    expect(one("1.5 million users")).toBe("1500000");
  });

  it("reads numbers in words: compounds, scales, a dozen; not 'one' or 'a' alone", () => {
    expect(one("two thousand files")).toBe("2000");
    expect(one("twelve retries")).toBe("12");
    expect(one("twenty-five nodes")).toBe("25");
    expect(one("one hundred and twenty requests")).toBe("120");
    expect(one("two thousand three hundred rows")).toBe("2300");
    expect(one("a dozen shards")).toBe("12");
    expect(one("a thousand calls")).toBe("1000");
    expect(quantitiesOf("one of the nodes")).toEqual([]);
    expect(quantitiesOf("a node")).toEqual([]);
  });

  it("reads ratios: N×, N times, twice, fourfold, 4-fold; 'double' only on an amount", () => {
    eq("fourfold", "4x");
    eq("a 4-fold speed-up", "4× faster");
    eq("twice as fast", "2 times as fast");
    eq("double the throughput", "2x the throughput");
    expect(quantitiesOf("use double quotes")).toEqual([]);
    expect(quantitiesOf("double-check it")).toEqual([]);
    ne("threefold", "4x");
  });

  it("reads 'half' as 50% only as a proportion", () => {
    eq("half of the requests", "50% of the requests");
    eq("cut costs by half", "cut costs by 50 percent");
    expect(quantitiesOf("half an hour later")).toEqual([]);
    expect(quantitiesOf("the first half")).toEqual([]);
  });
});

describe("quantitiesOf: units within a dimension", () => {
  it("time: ms, s, sec, seconds, min, minutes, h, hours, days", () => {
    eq("250 ms", "0.25 seconds");
    eq("250 milliseconds", "0.25 s");
    eq("90 sec", "1.5 min");
    eq("120 minutes", "2 hours");
    eq("48 h", "2 days");
    eq("a 5-minute window", "300 seconds");
    ne("200 ms", "200 s");
    ne("2 hours", "2 days");
    expect(one("250 ms")).toBe("250 ms");
  });

  it("size: decimal KB/MB/GB/TB, binary KiB/MiB/GiB; bits apart", () => {
    eq("1.5 GB", "1500 MB");
    eq("1 KB", "1000 bytes");
    eq("1 KiB", "1024 B");
    eq("2 GiB", "2048 MiB");
    eq("4 bits", "4-bit");
    ne("1.5 GB", "15 GB");
    ne("1 KB", "1 KiB");
    ne("1 GB", "1 GiB");
    ne("8 bits", "1 byte");
  });

  it("percent: %, percent, per cent", () => {
    eq("5%", "5 percent");
    eq("5 per cent", "5 %");
    ne("5%", "0.5%");
  });

  it("never compares across dimensions", () => {
    ne("5%", "5 ms");
    ne("4 bits", "4 bytes");
    ne("3x", "3 s");
  });
});

describe("quantitiesOf: percentiles", () => {
  it("p99 = 99th percentile = 99th-percentile; median = p50", () => {
    eq("p99", "99th percentile");
    eq("P99", "the 99th-percentile latency");
    eq("p99.9", "99.9th percentile");
    eq("median latency", "p50 latency");
    ne("p99", "p95");
    ne("p99", "99 ms");
    ne("p99", "99");
  });

  it("leaves priorities and ordinals alone", () => {
    expect(quantitiesOf("a P1 incident")).toEqual([]);
    expect(quantitiesOf("the 3rd attempt")).toEqual([]);
  });
});

describe("quantitiesOf: ranges", () => {
  it("4-8, 4–8, between 4 and 8, four to eight are one range", () => {
    eq("4-8 nodes", "between 4 and 8 nodes");
    eq("4–8 nodes", "four to eight nodes");
    eq("4 to 8 ms", "4-8ms");
    eq("500 ms to 2 s", "0.5-2 seconds");
    expect(one("between 4 and 8")).toBe("4-8");
  });

  it("a range is not one of its ends, and a different range differs", () => {
    ne("4–8", "8");
    ne("4–8", "4");
    ne("between 4 and 8", "between 4 and 9");
    ne("4-8 ms", "4-8 s");
  });

  it("'from A to B' is a change, two values; a descending pair is no range", () => {
    expect(quantitiesOf("raised from 100 to 200").map(canonicalQuantity)).toEqual(["100", "200"]);
    expect(quantitiesOf("8-4").map(canonicalQuantity)).toEqual([]);
  });
});

describe("quantitiesOf: identifiers stay exact", () => {
  it("never reads versions, ids, paths, dates or times", () => {
    for (const text of ["v2.5", "HK-3", "#25", "/var/log/2024", "release 1.2.3", "on 2024-01-05", "at 10:30", "wl5_INJ", "S3 bucket", "1920x1080", "the 1990s"]) expect(quantitiesOf(text), text).toEqual([]);
  });

  it("normalizeQuantities rewrites only the quantities", () => {
    expect(normalizeQuantities("Upload up to two thousand files in v2.5 within 0.25 seconds at the 99th-percentile.")).toBe("Upload up to 2000 files in v2.5 within 250 ms at the p99.");
    expect(normalizeQuantities("A 4-bit model in /var/log/2024")).toBe("A 4 bit model in /var/log/2024");
  });
});

describe("supportsQuantity", () => {
  const s = (src: string, card: string) => supportsQuantity(quantitiesOf(src)[0]!, quantitiesOf(card)[0]!);
  it("the same quantity, or a unitless number against the same number as written", () => {
    expect(s("250 ms", "0.25 s")).toBe(true);
    expect(s("200 ms", "200")).toBe(true);
    expect(s("200", "200 ms")).toBe(true);
    expect(s("200 ms", "200 s")).toBe(false);
    expect(s("4-8", "8")).toBe(false);
    expect(s("8", "4-8")).toBe(false);
    expect(s("between 4 and 8", "4 to 8")).toBe(true);
  });
});
