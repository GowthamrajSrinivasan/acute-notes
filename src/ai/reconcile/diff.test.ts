import { describe, expect, it } from "vitest";
import { parseContent } from "@/ai/content/parser";
import { planLocally } from "@/ai/content/localPlanner";
import { lineDiff } from "./diff";
import { canUpdateSourceFrom, editedMarkdown, spliceSource } from "./sourceEdit";

describe("lineDiff", () => {
  it("marks kept, removed and added lines in order", () => {
    expect(lineDiff("a\nb\nc", "a\nB\nc\nd")).toEqual([
      { op: "same", text: "a" },
      { op: "del", text: "b" },
      { op: "add", text: "B" },
      { op: "same", text: "c" },
      { op: "add", text: "d" },
    ]);
    expect(lineDiff("same", "same")).toEqual([{ op: "same", text: "same" }]);
  });
});

describe("update source from an edit", () => {
  const TEXT = "# Launch\n\n- [ ] Ship the flag\n- [ ] Notify support\n\n## Risks\n\nThe gateway may time out.\n";

  it("splices the edited block back into exactly its span, leaving the rest of the source untouched", async () => {
    const plan = planLocally(await parseContent(TEXT), TEXT).plan!;
    const risks = plan.nodes.find((n) => n.type === "text")!;
    expect(canUpdateSourceFrom(risks, "local")).toBe(true);
    // In a section (F42) the block has no title heading of its own: the frame's title shows "Risks".
    expect(risks.title).toBeUndefined();
    const edited = [{ type: "paragraph" as const, content: "The gateway times out under load." }];
    const next = spliceSource(TEXT, risks.sourceSpan!, editedMarkdown(risks, edited));
    expect(next).toBe("# Launch\n\n- [ ] Ship the flag\n- [ ] Notify support\n\n## Risks\n\nThe gateway times out under load.\n");
  });

  it("is only offered where an edit maps onto a known span: local-tier text/todo/table/code nodes", async () => {
    const plan = planLocally(await parseContent(TEXT), TEXT).plan!;
    const heading = plan.nodes.find((n) => n.type === "heading")!;
    const todo = plan.nodes.find((n) => n.type === "todo")!;
    expect(canUpdateSourceFrom(todo, "local")).toBe(true);
    expect(canUpdateSourceFrom(heading, "local")).toBe(false);
    expect(canUpdateSourceFrom(todo, "ai")).toBe(false);
    expect(canUpdateSourceFrom(undefined, "local")).toBe(false);
  });
});
