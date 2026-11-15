/** Opt-in (OVERHEAD_PROBE=1): bytes of the direct-path judge request for the guard smoke test's pair, to size the SDK overhead. */
import { describe, it } from "vitest";
import { judgeConsistencyTask, outputBudget, planCalls } from "./judge";

describe.skipIf(process.env.OVERHEAD_PROBE !== "1")("SDK request overhead probe", () => {
  it("prints the direct-path request size", () => {
    const a = "The Larchfield depot stores its spare tyres in Building C.";
    const b = "The Larchfield depot stores its spare tyres in Building F.";
    const input = planCalls([{ key: "k1", a: { sentence: a }, b: { sentence: b } }], 1).calls[0]!.input;
    const { systemPrompt, prompt } = judgeConsistencyTask.buildPrompt({ input });
    const direct = JSON.stringify({ model: "openai/gpt-oss-120b", temperature: 0, max_tokens: outputBudget(input), reasoning_effort: "low", messages: [{ role: "system", content: systemPrompt }, { role: "user", content: prompt }] });
    const sdk = 9844;
    console.log(JSON.stringify({ directBytes: Buffer.byteLength(direct), sdkBytes: sdk, overheadBytes: sdk - Buffer.byteLength(direct), overheadTokensConservative: Math.ceil((sdk - Buffer.byteLength(direct)) / 3) }));
  });
});
