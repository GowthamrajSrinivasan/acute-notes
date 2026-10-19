import { describe, expect, it } from "vitest";
import type { RichContent } from "@/domain/types";
import { canonicalContent, fingerprintContent, fingerprintShape } from "./fingerprint";

// As the renderer writes it (F30): string content, no ids, no props.
const written: RichContent = [
  { type: "heading", props: { level: 3 }, content: "Steps" },
  { type: "checkListItem", props: { checked: false }, content: "Ship the flag" },
  { type: "paragraph", content: "Owner: payments" },
];

// The same content after BlockNote has mounted it and mirrored its snapshot back:
// block ids, default props, inline arrays with empty styles, and a trailing empty paragraph.
const afterEditorRoundTrip: RichContent = [
  { id: "b1", type: "heading", props: { level: 3, textColor: "default", backgroundColor: "default", textAlignment: "left", isToggleable: false }, content: [{ type: "text", text: "Steps", styles: {} }], children: [] },
  { id: "b2", type: "checkListItem", props: { checked: false, textColor: "default", backgroundColor: "default", textAlignment: "left" }, content: [{ type: "text", text: "Ship the flag", styles: {} }], children: [] },
  { id: "b3", type: "paragraph", props: { textColor: "default", backgroundColor: "default", textAlignment: "left" }, content: [{ type: "text", text: "Owner: payments", styles: {} }], children: [] },
  { id: "b4", type: "paragraph", props: {}, content: [], children: [] },
];

describe("fingerprintContent", () => {
  it("is identical before and after the editor rewrites a snapshot (ids, default props, inline arrays, a trailing empty paragraph)", () => {
    expect(fingerprintContent(afterEditorRoundTrip)).toBe(fingerprintContent(written));
  });

  it("changes on any real edit: text, a checkbox, a heading level, a mark", () => {
    const base = fingerprintContent(written);
    const edit = (patch: (c: RichContent) => RichContent) => fingerprintContent(patch(structuredClone(written)));
    expect(edit((c) => ((c[2]!.content = "Owner: platform"), c))).not.toBe(base);
    expect(edit((c) => ((c[1]!.props = { checked: true }), c))).not.toBe(base);
    expect(edit((c) => ((c[0]!.props = { level: 2 }), c))).not.toBe(base);
    expect(edit((c) => ((c[2]!.content = [{ type: "text", text: "Owner: payments", styles: { bold: true } }]), c))).not.toBe(base);
  });

  it("counts a page's title as part of its content", () => {
    expect(fingerprintContent(written, "Runbook")).not.toBe(fingerprintContent(written, "Playbook"));
    expect(fingerprintContent(written, "Runbook")).toBe(fingerprintContent(afterEditorRoundTrip, " Runbook "));
  });

  it("is stable and cheap to compare (a short string)", () => {
    expect(fingerprintContent(written)).toBe(fingerprintContent(written));
    expect(fingerprintContent(written).length).toBeLessThan(16);
    expect(canonicalContent(written)).toBe("### Steps\n\n- [ ] Ship the flag\n\nOwner: payments");
  });
});

describe("fingerprintShape", () => {
  it("ignores how Excalidraw wrapped the label, but not the label's words or the shape's kind", () => {
    expect(fingerprintShape("ellipse", "Orders\nDB")).toBe(fingerprintShape("ellipse", "Orders DB"));
    expect(fingerprintShape("ellipse", "Orders DB")).not.toBe(fingerprintShape("ellipse", "Order DB"));
    expect(fingerprintShape("ellipse", "Orders DB")).not.toBe(fingerprintShape("rectangle", "Orders DB"));
  });
});
