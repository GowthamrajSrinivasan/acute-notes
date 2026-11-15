import { describe, expect, it } from "vitest";
import { presentationObligations, validateClauseRecordV31, type ClaimLink, type ClauseRecordV31 } from "./attachmentSchema";

// kn-02 u40: "but not on live election results" limits its own sentence (u40) and the section claim (u37).
const local: ClaimLink = { level: "local", units: ["u40"], claimQuote: "Larkspur uses it on article pages", evidence: "but not on live election results", justification: "Use is restricted to articles", binding: "claim" };
const section: ClaimLink = { level: "section", units: ["u37"], claimQuote: "Stale-while-revalidate turns expiry from a wait into a background task", evidence: "where a minute of staleness is acceptable, but not on live election results", justification: "The technique's applicability depends on staleness tolerance", binding: "set" };
const base: ClauseRecordV31 = {
  id: "k21",
  units: ["u40"],
  clause: "but not on live election results",
  verdict: "claim",
  links: [local, section],
  presentation: "one_carrier",
  confidence: "medium",
};

describe("schema v3.1 draft: bounded multiple claim links", () => {
  it("accepts one local and one section link with evidence", () => {
    expect(validateClauseRecordV31(base)).toEqual([]);
  });
  it("refuses a section link without positive evidence", () => {
    const r = { ...base, links: [local, { ...section, evidence: "" }] };
    expect(validateClauseRecordV31(r)).toContain("section link needs positive source evidence");
  });
  it("refuses three links and two links at the same level", () => {
    expect(validateClauseRecordV31({ ...base, links: [...base.links, local] })).toContain("1 or 2 links");
    const same = { ...base, links: [local, { ...section, level: "local" as const }] };
    expect(validateClauseRecordV31(same)).toContain("two links must be one local and one section");
  });
  it("keeps verdict tied to the strongest link and ambiguity explicit", () => {
    expect(validateClauseRecordV31({ ...base, verdict: "set" })).toContain("verdict must be the strongest link binding");
    const amb = { ...base, verdict: "ambiguous" as const, links: [{ ...local, binding: "ambiguous" as const }] };
    expect(validateClauseRecordV31(amb)).toContain("ambiguous keeps both readings and the deciding question");
  });
  it("counts one presentation obligation by default, so no duplicate warnings", () => {
    const both = { ...base, links: [local, { ...section, binding: "claim" as const }] };
    expect(presentationObligations(both)).toEqual([{ claimUnits: ["u40", "u37"] }]);
    expect(presentationObligations({ ...both, presentation: "per_link" })).toHaveLength(2);
    expect(validateClauseRecordV31({ ...base, presentation: "per_link" })).toContain(
      "per_link presentation only applies when both links are claim-bound",
    );
  });
});
