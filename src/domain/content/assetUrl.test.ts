import { describe, expect, it } from "vitest";
import { looksLikeHeic } from "@/components/blocks/imageAssets";
import { sanitizeContent } from "@/portability/sanitize";
import type { RichContent } from "@/domain/types";
import { assetIdOf, assetUrl, collectAssetIds } from "./assetUrl";
import { contentToMarkdown } from "./markdown";
import { isEmptyContent, toPlainText } from "./richContent";

const image = (url: string, extra: Record<string, string> = {}) => ({ type: "image" as const, props: { url, ...extra } });

describe("image assets in content", () => {
  it("round-trips asset URLs", () => {
    expect(assetIdOf(assetUrl("abc"))).toBe("abc");
    expect(assetIdOf("https://x.y/a.png")).toBeNull();
    expect(assetIdOf("acute-asset://")).toBeNull();
  });

  it("collects stored images, nested ones included, and skips web images", () => {
    const content: RichContent = [
      image(assetUrl("a")),
      { type: "bulletListItem", content: "x", children: [image(assetUrl("b"))] },
      image("https://x.y/c.png"),
    ];
    expect([...collectAssetIds(content)]).toEqual(["a", "b"]);
  });

  it("exports images as Markdown", () => {
    expect(contentToMarkdown([image("https://x.y/a b.png", { caption: "A [chart]" })])).toBe(String.raw`![A \[chart\]](https://x.y/a%20b.png)` + "\n");
    expect(contentToMarkdown([image(assetUrl("a"), { name: "shot.png" })])).toBe("![shot.png](acute-asset://a)\n");
    expect(contentToMarkdown([image("")])).toBe("");
  });

  it("counts an image as content and its caption as text", () => {
    expect(isEmptyContent([image(assetUrl("a"))])).toBe(false);
    expect(toPlainText([image(assetUrl("a"), { caption: "Q3 revenue" })])).toBe("Q3 revenue");
  });

  it("keeps only web and stored image URLs on import", () => {
    const [bad, good, stored] = sanitizeContent([image("javascript:alert(1)"), image("https://x.y/a.png"), image(assetUrl("a"))]);
    expect(bad!.props!.url).toBe("");
    expect(good!.props!.url).toBe("https://x.y/a.png");
    expect(stored!.props!.url).toBe("acute-asset://a");
  });

  it("recognises HEIC bytes", () => {
    const bytes = (brand: string) => new Uint8Array([0, 0, 0, 24, ...[...`ftyp${brand}`].map((c) => c.charCodeAt(0))]);
    expect(looksLikeHeic(bytes("heic"))).toBe(true);
    expect(looksLikeHeic(bytes("isom"))).toBe(false);
    expect(looksLikeHeic(new Uint8Array([0x89, 0x50, 0x4e, 0x47]))).toBe(false);
  });
});
