import { describe, expect, it } from "vitest";
import {
  extraPhpDirectories,
  isSitePhpDir,
  normalizePhpDir,
  phpDirSlug,
  phpDirUriPrefix,
} from "../../scripts/lib/php-dir.mjs";

describe("php-dir", () => {
  it("normalizes public_html aliases", () => {
    expect(normalizePhpDir("")).toBe("public_html");
    expect(normalizePhpDir(".")).toBe("public_html");
    expect(normalizePhpDir("public_html")).toBe("public_html");
    expect(normalizePhpDir("/public_html/")).toBe("public_html");
  });

  it("maps extra dirs under public_html", () => {
    expect(normalizePhpDir("blog")).toBe("public_html/blog");
    expect(normalizePhpDir("public_html/api/v1")).toBe("public_html/api/v1");
    expect(phpDirUriPrefix("blog")).toBe("/blog");
    expect(phpDirUriPrefix("public_html")).toBe("");
    expect(isSitePhpDir("blog")).toBe(false);
  });

  it("rejects traversal", () => {
    expect(() => normalizePhpDir("../etc")).toThrow(/Invalid/);
    expect(() => normalizePhpDir("homes/mail")).toThrow(/Invalid/);
  });

  it("sorts extras longest prefix first", () => {
    const extras = extraPhpDirectories([
      { dir: "public_html", version: "8.3" },
      { dir: "blog", version: "8.2" },
      { dir: "blog/old", version: "8.1" },
    ]);
    expect(extras.map((e) => e.uriPrefix)).toEqual(["/blog/old", "/blog"]);
    expect(phpDirSlug("example.com", "blog")).toMatch(/example_com-blog/);
  });
});
