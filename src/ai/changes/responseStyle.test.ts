import { describe, expect, it } from "vitest";
import type { ChangeSet } from "./changeSet";
import { PendingChanges } from "./pendingChanges";
import { DEFAULT_RESPONSE_STYLE, withResponseStyle } from "./responseStyle";

const box = { x: 0, y: 0, width: 200, height: 100 };
const set = (changes: ChangeSet["changes"]): ChangeSet => ({ operationId: "op", title: "Test", metadata: { createdBy: "ai" }, changes });

describe("withResponseStyle", () => {
  it("gives card titles and frameless headings the title colours, and leaves body text alone", () => {
    const out = withResponseStyle(
      set([
        { kind: "create_block", key: "card", blockType: "text", box, content: [{ type: "heading", props: { level: 3 }, content: "Title" }, { type: "paragraph", content: "Body" }] },
        { kind: "create_block", key: "title", blockType: "text", box, frame: "none", fontSize: 36, content: [{ type: "paragraph", content: "Doc" }] },
        { kind: "create_block", key: "text", blockType: "text", box, frame: "none", content: [{ type: "paragraph", content: "Plain" }] },
        { kind: "create_block", key: "untitled", blockType: "text", box, content: [{ type: "paragraph", content: "No title" }] },
      ]),
      { ...DEFAULT_RESPONSE_STYLE, titleColor: "blue" },
    );
    const content = (key: string) => out.changes.find((c) => "key" in c && c.key === key && c.kind === "create_block") as { content: { props?: Record<string, unknown> }[] };
    expect(content("card").content[0]!.props).toEqual({ level: 3, backgroundColor: "orange", textColor: "blue" });
    expect(content("card").content[1]!.props).toBeUndefined();
    expect(content("title").content[0]!.props).toEqual({ backgroundColor: "orange", textColor: "blue" });
    expect(content("text").content[0]!.props).toBeUndefined();
    expect(content("untitled").content[0]!.props).toBeUndefined();
  });

  it("sets the title font on title text only, keeping fonts the producer chose", () => {
    const out = withResponseStyle(
      set([
        {
          kind: "create_block",
          key: "card",
          blockType: "text",
          box,
          content: [
            { type: "heading", props: { level: 3 }, content: [{ type: "text", text: "Own", styles: { fontFamily: "virgil" } }, { type: "text", text: " title", styles: { bold: true } }] },
            { type: "paragraph", content: "Body" },
          ],
        },
        { kind: "create_block", key: "doc", blockType: "text", box, frame: "none", fontSize: 36, content: [{ type: "paragraph", content: "Doc" }] },
      ]),
      { ...DEFAULT_RESPONSE_STYLE, titleFont: "lilita" },
    );
    const [card, doc] = out.changes as { content: { content: unknown }[] }[];
    expect(card!.content[0]!.content).toEqual([
      { type: "text", text: "Own", styles: { fontFamily: "virgil" } },
      { type: "text", text: " title", styles: { bold: true, fontFamily: "lilita" } },
    ]);
    expect(card!.content[1]!.content).toBe("Body");
    expect(doc!.content[0]!.content).toEqual([{ type: "text", text: "Doc", styles: { fontFamily: "lilita" } }]);
    // "default" leaves the item's own font.
    const plain = withResponseStyle(set([{ kind: "create_block", key: "c", blockType: "text", box, content: [{ type: "heading", props: { level: 3 }, content: "T" }] }]), DEFAULT_RESPONSE_STYLE);
    expect((plain.changes[0] as { content: { content: unknown }[] }).content[0]!.content).toBe("T");
  });

  it("keeps colours and connector styles the producer chose", () => {
    const out = withResponseStyle(
      set([
        { kind: "create_block", key: "card", blockType: "text", box, backgroundColor: "#ffc9c9", content: [{ type: "heading", props: { level: 3, backgroundColor: "blue" }, content: "T" }] },
        { kind: "connect", key: "c", from: { created: "card" }, to: { existing: "x" }, routing: "elbow" },
      ]),
      { ...DEFAULT_RESPONSE_STYLE, cardBackground: "#e7f5ff", connectors: "straight" },
    );
    expect(out.changes[0]).toMatchObject({ backgroundColor: "#ffc9c9", content: [{ props: { backgroundColor: "blue" } }] });
    expect(out.changes[1]).toMatchObject({ routing: "elbow" });
  });

  it("sets card fill and connector style from the settings, and no title colour when set to none", () => {
    const out = withResponseStyle(
      set([
        { kind: "create_block", key: "card", blockType: "text", box, content: [{ type: "heading", props: { level: 3 }, content: "T" }] },
        { kind: "connect", key: "c", from: { created: "card" }, to: { existing: "x" } },
      ]),
      { ...DEFAULT_RESPONSE_STYLE, titleBackground: "default", cardBackground: "#e7f5ff", connectors: "straight" },
    );
    expect(out.changes[0]).toMatchObject({ backgroundColor: "#e7f5ff", content: [{ props: { level: 3 } }] });
    expect((out.changes[0] as { content: { props: object }[] }).content[0]!.props).toEqual({ level: 3 });
    expect(out.changes[1]).toMatchObject({ routing: "straight" });
  });

  it("is applied to proposals, and survives re-validation", () => {
    const pending = new PendingChanges({ style: () => ({ ...DEFAULT_RESPONSE_STYLE, connectors: "straight" }) });
    const proposed = pending.propose("canvas", set([
      { kind: "create_block", key: "card", blockType: "text", box, content: [{ type: "heading", props: { level: 3 }, content: "T" }] },
      { kind: "connect", key: "c", from: { created: "card" }, to: { existing: "x" } },
    ]));
    expect(proposed.changes[0]).toMatchObject({ content: [{ props: { backgroundColor: "orange" } }] });
    expect(proposed.changes[1]).toMatchObject({ routing: "straight" });
    expect(new PendingChanges().propose("canvas", set([{ kind: "connect", key: "c", from: { existing: "a" }, to: { existing: "b" } }])).changes[0]).not.toHaveProperty("routing");
  });
});
