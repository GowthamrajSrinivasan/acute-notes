import { describe, expect, it } from "vitest";
import { normalizeMathArrows } from "./mathArrows";

describe("normalizeMathArrows", () => {
  it("turns LaTeX arrows between code spans into →", () => {
    expect(normalizeMathArrows("`Classify` $\\rightarrow$ `Retrieve` $\\rightarrow$ `Act`")).toBe("`Classify` → `Retrieve` → `Act`");
  });

  it("repairs arrows whose backslash-letter JSON turned into a control character", () => {
    expect(normalizeMathArrows("`A` $\rightarrow$ `B` $\to$ `C`")).toBe("`A` → `B` → `C`");
    expect(normalizeMathArrows("a $\times$ b $\neq$ c")).toBe("a × b ≠ c");
  });

  it("handles \\( \\), $$ and bare commands", () => {
    expect(normalizeMathArrows("a \\(\\Rightarrow\\) b $$\\leftrightarrow$$ c \\to d")).toBe("a ⇒ b ↔ c → d");
  });

  it("leaves prices and unknown math alone", () => {
    const text = "It costs $5 and $10, or $x^2$.";
    expect(normalizeMathArrows(text)).toBe(text);
  });
});
