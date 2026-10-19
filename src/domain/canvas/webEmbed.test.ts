import { describe, expect, it } from "vitest";
import { allowsFraming, getImportedHtml, isWebLink, withImportedHtml } from "./webEmbed";

const APP = "http://localhost:3000";
const ARTIFACT = "https://claude.ai/artifact/abc";

describe("isWebLink", () => {
  it("accepts http(s) only", () => {
    expect(isWebLink("https://example.com")).toBe(true);
    expect(isWebLink("http://example.com/x")).toBe(true);
    expect(isWebLink("acute://block/1")).toBe(false);
    expect(isWebLink("javascript:alert(1)")).toBe(false);
    expect(isWebLink("not a url")).toBe(false);
    expect(isWebLink(null)).toBe(false);
  });
});

describe("allowsFraming", () => {
  const h = (xFrameOptions: string | null, contentSecurityPolicy: string | null = null) => ({ xFrameOptions, contentSecurityPolicy });

  it("allows pages without framing headers", () => {
    expect(allowsFraming(h(null), APP, ARTIFACT)).toBe(true);
  });

  it("honours X-Frame-Options", () => {
    expect(allowsFraming(h("DENY"), APP, ARTIFACT)).toBe(false);
    expect(allowsFraming(h("SAMEORIGIN"), APP, ARTIFACT)).toBe(false);
    expect(allowsFraming(h("SAMEORIGIN"), APP, `${APP}/page`)).toBe(true);
  });

  it("prefers CSP frame-ancestors over X-Frame-Options", () => {
    expect(allowsFraming(h("DENY", "default-src 'self'; frame-ancestors *"), APP, ARTIFACT)).toBe(true);
    expect(allowsFraming(h(null, "frame-ancestors 'none'"), APP, ARTIFACT)).toBe(false);
    expect(allowsFraming(h(null, "frame-ancestors 'self'"), APP, ARTIFACT)).toBe(false);
    expect(allowsFraming(h(null, "frame-ancestors https://*.example.com"), "https://app.example.com", ARTIFACT)).toBe(true);
    expect(allowsFraming(h(null, "frame-ancestors localhost:3000"), APP, ARTIFACT)).toBe(true);
    expect(allowsFraming(h(null, "frame-ancestors localhost:4000"), APP, ARTIFACT)).toBe(false);
    expect(allowsFraming(h(null, "frame-ancestors http:"), APP, ARTIFACT)).toBe(true);
  });

  it("ignores CSP without frame-ancestors", () => {
    expect(allowsFraming(h("SAMEORIGIN", "default-src 'none'; frame-src 'self'"), APP, ARTIFACT)).toBe(false);
    expect(allowsFraming(h(null, "default-src 'none'"), APP, ARTIFACT)).toBe(true);
  });
});

describe("imported HTML", () => {
  it("round-trips through customData and can be removed", () => {
    const data = withImportedHtml({ other: 1 }, { html: "<p>hi</p>", name: "a.html" });
    expect(getImportedHtml({ customData: data })).toEqual({ html: "<p>hi</p>", name: "a.html" });
    const cleared = withImportedHtml(data, null);
    expect(cleared).toEqual({ other: 1 });
    expect(getImportedHtml({ customData: cleared })).toBeNull();
  });
});
