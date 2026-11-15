/**
 * §12.19 regression coverage for the failures the first unseen evaluation found (u06, u08, u19, u23, u26, u30, u35; and
 * u29, u33, changed by the same fixes). REGRESSION evidence only — the fixes were written against these pairs, so they
 * are never reported as unseen results.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { priorityOf, routeOf } from "./candidates";
import { combine } from "./judge";
import { frequencyOf, judgePair, markersOf } from "./rules";

const DIR = join(fileURLToPath(new URL(".", import.meta.url)), "../../../evaluation/update-engine/consistency");
const pairs = (JSON.parse(readFileSync(join(DIR, "regressions-unseen1.json"), "utf8")) as { pairs: { id: string; a: string; b: string; expectedRoute: string }[] }).pairs;
const byId = (id: string) => pairs.find((p) => p.id === id)!;
const j = (id: string) => judgePair(byId(id).a, byId(id).b);

describe("§12.19 — regressions from the first unseen set", () => {
  it.each(pairs.map((p) => [p.id, p.expectedRoute]))("%s routes as %s", (id, route) => expect(routeOf(j(id))).toBe(route));

  it("u06: two different limits are a near-miss (limit), never a rule conflict; a value over a stated maximum still is one", () => {
    expect(j("u06").nearMiss?.kind).toBe("limit");
    expect(judgePair("The warehouse can hold at most 2,500 pallets.", "The warehouse currently holds 4,000 pallets.").verdict).toBe("conflict");
    expect(routeOf(judgePair("A ticket can be reopened up to three times.", "This ticket was reopened twice."))).toBe("excluded");
  });

  it("u08: 'valid until <date>' is the value, not a time scope; 'Until March, …' still is one", () => {
    expect([...markersOf(byId("u08").b)]).toEqual([]);
    expect(j("u08")).toMatchObject({ nearMiss: { kind: "date" } });
    expect(j("u08").contextDiffers).toBeUndefined();
    expect([...markersOf("Until March, retries happened five times.")]).toContain("time:until");
  });

  it("u19: required vs optional is a modality near-miss; prohibited vs permitted too; a different action is not", () => {
    expect(j("u19").nearMiss?.kind).toBe("modality");
    expect(routeOf(judgePair("Exporting reports is prohibited for guests.", "Guests are permitted to export reports."))).toBe("near_miss");
    expect(routeOf(j("u29"))).toBe("excluded");
  });

  it("u23: calendar-aware frequencies — six months = twice a year; a real difference still differs", () => {
    expect(frequencyOf(byId("u23").a)!.perYear).toBeCloseTo(frequencyOf(byId("u23").b)!.perYear, 6);
    expect(routeOf(judgePair("Payroll is processed every two weeks.", "Payroll runs once a month."))).toBe("near_miss");
  });

  it("u26 / u30: a swapped value is exclusive only when a statement says so; the AI's 'contradicts' is likely only then", () => {
    expect(j("u26").exclusive).toBeUndefined();
    expect(combine(j("u26"), { answer: "contradicts" }).shown).toBe("possible");
    expect(j("u30").exclusive).toBe(true);
    expect([...markersOf(byId("u30").b)]).toEqual([]); // "US dollars" is a currency, not a region
    expect(combine(j("u30"), { answer: "contradicts" }).shown).toBe("likely");
    expect(markersOf("For US customers, data is stored in Virginia.").has("region:us")).toBe(true);
  });

  it("u35: changes without a baseline or period are possible, never a definite conflict; two levels still conflict", () => {
    expect(j("u35")).toMatchObject({ verdict: "possible" });
    expect(j("u35").reason).toContain("baseline");
    expect(judgePair("The request timeout is 30 seconds.", "Requests time out after 10 seconds.").verdict).toBe("conflict");
  });

  it("u33: grew / shrank is an antonym, a rule conflict", () => {
    expect(j("u33").verdict).toBe("conflict");
  });

  it("ranking: evidence of incompatibility and the same claim first; a coexisting swap below; context last", () => {
    const p = (id: string) => priorityOf(j(id));
    expect(p("u19")).toBeGreaterThan(p("u26")); // conflicting modality > a swap that may coexist
    expect(p("u30")).toBeGreaterThan(p("u26")); // an exclusive swap > a coexisting one
    expect(p("u08")).toBeGreaterThan(p("u35")); // a date clash > a change without a baseline
    expect(priorityOf(judgePair("In staging, backups run every day.", "Backups run every week."))).toBe(1);
  });
});
