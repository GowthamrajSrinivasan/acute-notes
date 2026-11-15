import { describe, expect, it } from "vitest";
import { callTokens } from "./candidates";
import { JUDGE_CALL_CEILING, planCalls } from "./judge";
import { REQUEST_OVERHEAD, REQUEST_OVERHEAD_VERSION, reservationWithOverhead, smallestCallFits } from "./requestOverhead";

const onePair = () => callTokens(planCalls([{ key: "k", a: { sentence: "The Larchfield depot stores its spare tyres in Building C." }, b: { sentence: "The Larchfield depot stores its spare tyres in Building F." } }], 1).calls[0]!.input);

describe("request overhead in reservations (§12.32, version 1, not wired)", () => {
  it("records the measured overheads", () => {
    expect(REQUEST_OVERHEAD_VERSION).toBe(1);
    expect(REQUEST_OVERHEAD.copilot_sdk_byok.inputTokens).toBe(2_311);
    expect(REQUEST_OVERHEAD.direct_http.inputTokens).toBeGreaterThanOrEqual(39);
  });

  it("the live SDK call would have been fully reserved: 1,424 reserved + overhead ≥ 2,201 used", () => {
    expect(onePair()).toBe(1_424);
    expect(reservationWithOverhead(onePair(), "copilot_sdk_byok")).toBeGreaterThanOrEqual(2_201);
  });

  it("FINDING: under the unchanged 2,800-token per-call ceiling, not even a one-pair check fits the Copilot SDK path; the direct path fits", () => {
    expect(JUDGE_CALL_CEILING).toBe(2_800);
    expect(smallestCallFits("copilot_sdk_byok", JUDGE_CALL_CEILING, onePair())).toBe(false);
    expect(smallestCallFits("direct_http", JUDGE_CALL_CEILING, onePair())).toBe(true);
  });
});
