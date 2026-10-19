import { describe, expect, it } from "vitest";
import { cleanRepoLinks, vscodeUrl, webUrl } from "./repoLinks";

describe("repo links", () => {
  it("normalises a Windows folder and drops a non-web URL", () => {
    expect(cleanRepoLinks({ root: " C:\\src\\shop\\ ", web: "javascript:alert(1)" })).toEqual({ root: "C:/src/shop" });
    expect(cleanRepoLinks({ web: "https://github.com/acme/shop/" })).toEqual({ web: "https://github.com/acme/shop" });
  });

  it("builds a VS Code link only with a root", () => {
    expect(vscodeUrl({}, "a.ts", 3)).toBeUndefined();
    expect(vscodeUrl({ root: "C:/src/shop" }, "src/pay ment.ts", 143)).toBe("vscode://file/C:/src/shop/src/pay%20ment.ts:143");
    expect(vscodeUrl({ root: "/home/me/shop" }, "/a.ts")).toBe("vscode://file/home/me/shop/a.ts");
  });

  it("builds a web link at the commit (else HEAD) with the line range", () => {
    expect(webUrl({}, "a.ts")).toBeUndefined();
    expect(webUrl({ web: "https://github.com/acme/shop" }, "src/a.ts", [143, 158], "abc1234")).toBe("https://github.com/acme/shop/blob/abc1234/src/a.ts#L143-L158");
    expect(webUrl({ web: "https://github.com/acme/shop" }, "a.ts", [7, 7])).toBe("https://github.com/acme/shop/blob/HEAD/a.ts#L7");
  });
});
