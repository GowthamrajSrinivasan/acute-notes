import { describe, expect, it } from "vitest";
import { cutUnstatedBenefits, withoutUnstatedBenefits } from "./unstated";

const source =
  "Before, a claim in a unit the checker had no rule for was rejected even when it was correct. Now the checks look the unit up in the dictionary. " +
  "The checks now compare what an answer says with the labels on the curve it cites.";

describe("withoutUnstatedBenefits", () => {
  it("cuts a trailing benefit the content never states (live runs: 'user experience', 'accuracy', 'handling')", () => {
    expect(withoutUnstatedBenefits("Improved unit checks reduce false rejections, improving user experience.", source)).toBe("Improved unit checks reduce false rejections.");
    expect(withoutUnstatedBenefits("Check 1-pre v3 now compares answer text with curve labels, improving accuracy.", source)).toBe(
      "Check 1-pre v3 now compares answer text with curve labels.",
    );
    expect(withoutUnstatedBenefits("Improved checks for units and wording reduce errors and increase accuracy.", source)).toBe("Improved checks for units and wording reduce errors.");
    expect(withoutUnstatedBenefits("The checker now uses a dictionary to verify units, improving handling of unknown units.", source)).toBe(
      "The checker now uses a dictionary to verify units.",
    );
  });

  it("cuts a short trailing purpose none of whose words the content uses (live run, 2026-10-08)", () => {
    expect(withoutUnstatedBenefits("Checks for units and wording have been updated for accuracy and flexibility.", source)).toBe("Checks for units and wording have been updated.");
    expect(withoutUnstatedBenefits("The checks for units and wording have been updated to be more accurate and flexible.", source)).toBe(
      "The checks for units and wording have been updated.",
    );
    // A purpose in the content's own words stays.
    expect(withoutUnstatedBenefits("The checks now look the unit up for each claim in the dictionary.", source)).toBe("The checks now look the unit up for each claim in the dictionary.");
  });

  it("keeps a benefit the content does state, and leaves sentences without one alone", () => {
    expect(withoutUnstatedBenefits("Units are looked up in the dictionary, reducing rejected claims.", source)).toBe("Units are looked up in the dictionary, reducing rejected claims.");
    expect(withoutUnstatedBenefits("This change ensures that claims are verified.", source)).toBe("This change ensures that claims are verified.");
  });
});

describe("cutUnstatedBenefits", () => {
  it("applies to the takeaway and analysis nodes only, never the content's own text", () => {
    const raw = {
      nodes: [
        { id: "n1", type: "text", content: { markdown: "Labels are compared, improving accuracy." } },
        { id: "a1", type: "text", origin: "analysis", content: { markdown: "Labels are compared, improving accuracy." } },
      ],
      metadata: { takeaway: "Curve labels checked, enhancing reliability." },
    };
    expect(cutUnstatedBenefits(raw, source)).toEqual({
      nodes: [
        { id: "n1", type: "text", content: { markdown: "Labels are compared, improving accuracy." } },
        { id: "a1", type: "text", origin: "analysis", content: { markdown: "Labels are compared." } },
      ],
      metadata: { takeaway: "Curve labels checked." },
    });
  });
});
