import { describe, expect, it } from "vitest";
import { cleanupAIText } from "./cleanup";

const on = { timestamps: true, citations: true };

describe("cleanupAIText — timestamps", () => {
  it("removes bracketed, linked and parenthesised timestamps", () => {
    expect(cleanupAIText("It works [02:33].", on)).toBe("It works.");
    expect(cleanupAIText("It works [[02:33](https://www.youtube.com/watch?v=abc&t=153)].", on)).toBe("It works.");
    expect(cleanupAIText("Costs rise (1:02:33), then fall [02:06 - 02:12] again.", on)).toBe("Costs rise, then fall again.");
    expect(cleanupAIText("Two points [02:06, 02:12].", on)).toBe("Two points.");
  });

  it("keeps plain times in prose", () => {
    expect(cleanupAIText("The call is at 12:30 sharp.", on)).toBe("The call is at 12:30 sharp.");
  });

  it("respects the option", () => {
    expect(cleanupAIText("A [02:33].", { timestamps: false, citations: true })).toBe("A [02:33].");
  });
});

describe("cleanupAIText — citations", () => {
  it("removes numeric marks and runs", () => {
    expect(cleanupAIText("Grew 5% in 2024.[1][2] Then fell [3, 4].", on)).toBe("Grew 5% in 2024. Then fell.");
    expect(cleanupAIText("See this [1-3] and this[^2].", on)).toBe("See this and this.");
  });

  it("removes Gemini, ChatGPT and linked citations", () => {
    expect(cleanupAIText("Fact [cite: 1, 2] and [cite_start]more[cite_end].", on)).toBe("Fact and more.");
    expect(cleanupAIText("Fact 【4†source】.", on)).toBe("Fact.");
    expect(cleanupAIText("Fact [1](https://example.com/a). Next [[2]](https://example.com/b).", on)).toBe("Fact. Next.");
  });

  it("removes reference-list lines", () => {
    expect(cleanupAIText("Body.\n\n[1]: https://example.com/a\n[2]: https://example.com/b\n", on)).toBe("Body.\n\n");
  });

  it("keeps code and indexes", () => {
    expect(cleanupAIText("Use `items[1]` here.\n\n```js\nconst a = b[1];\n```\n", on)).toBe("Use `items[1]` here.\n\n```js\nconst a = b[1];\n```\n");
    expect(cleanupAIText("The array items[1] is second.", on)).toBe("The array items[1] is second.");
  });

  it("leaves content alone when nothing matches", () => {
    const text = "# Title\n\n- one\n- two (see below)\n";
    expect(cleanupAIText(text, on)).toBe(text);
  });
});
