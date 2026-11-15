import { describe, expect, it } from "vitest";
import { organisationFor } from "./fidelity";
import { sourceOrganisation } from "@/ai/reconcile/update";

describe("the organisation switch (organisation-layout plan §3.0, Q10)", () => {
  it("is v2 for distil and v1 for everything else", () => {
    expect(organisationFor("distil")).toBe("v2");
    expect(organisationFor("preserve")).toBe("v1");
    expect(organisationFor(undefined)).toBe("v1");
  });

  it("a source is v2 when any of its objects was made under distil", () => {
    expect(sourceOrganisation([])).toBe("v1");
    expect(sourceOrganisation([{ noteModel: "preserve" }, {}])).toBe("v1");
    expect(sourceOrganisation([{}, { noteModel: "distil" }])).toBe("v2");
  });
});
