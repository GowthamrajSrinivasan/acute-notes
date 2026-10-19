import { describe, expect, it } from "vitest";
import { isStructuredHtml } from "./paste";

describe("isStructuredHtml", () => {
  it("treats rendered documents as structured", () => {
    expect(isStructuredHtml("<h2>Checks 0–7</h2><table><tr><td>0</td></tr></table>")).toBe(true);
    expect(isStructuredHtml("<p>logic: <code>checks.ts</code></p>")).toBe(true);
    expect(isStructuredHtml('<p>see <a href="https://x.y">docs</a></p>')).toBe(true);
    expect(isStructuredHtml("<ul><li>one</li></ul>")).toBe(true);
  });

  it("leaves raw-source copies to the Markdown parser", () => {
    expect(isStructuredHtml("")).toBe(false);
    expect(isStructuredHtml("<div><span># Title</span></div><div><span>- item</span></div>")).toBe(false);
    expect(isStructuredHtml("<pre><code># Title\n\n**bold**</code></pre>")).toBe(false);
    expect(isStructuredHtml("<p>get_timeseries and submit_answer</p>")).toBe(false);
    expect(isStructuredHtml('<abbr title="x">abbr</abbr><body><img src="a.png"></body>')).toBe(false);
  });
});
