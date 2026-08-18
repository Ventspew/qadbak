import { describe, expect, it } from "vitest";
import {
  absUnderRoot,
  defaultDirFromRoots,
  filesRootFromWebRoot,
  isAbsInsideRoot,
  isSharedUnixSubdomain,
  sharedSubDocroot,
  sharedSubFilesRoot,
} from "./domain-docroot";

describe("domain-docroot", () => {
  it("puts shared subs under domains/fqdn/public_html", () => {
    expect(sharedSubFilesRoot("/home/site", "blog.example.com")).toBe(
      "/home/site/domains/blog.example.com",
    );
    expect(sharedSubDocroot("/home/site", "blog.example.com")).toBe(
      "/home/site/domains/blog.example.com/public_html",
    );
  });

  it("detects shared-user subdomains", () => {
    expect(
      isSharedUnixSubdomain(
        { type: "sub", user: "site", parent: "example.com" },
        { user: "site" },
      ),
    ).toBe(true);
    expect(
      isSharedUnixSubdomain(
        { type: "sub", user: "blog", parent: "example.com" },
        { user: "site" },
      ),
    ).toBe(false);
    expect(isSharedUnixSubdomain({ type: "top", user: "site" }, null)).toBe(false);
  });

  it("jails Files to the subdomain folder, not the unix home", () => {
    const home = "/home/site";
    const web = sharedSubDocroot(home, "blog.example.com");
    const root = filesRootFromWebRoot(home, web);
    expect(root).toBe("/home/site/domains/blog.example.com");
    expect(defaultDirFromRoots(root, web)).toBe("public_html");
    expect(absUnderRoot(root, "public_html/index.html")).toBe(
      "/home/site/domains/blog.example.com/public_html/index.html",
    );
    expect(isAbsInsideRoot(root, `${home}/public_html`)).toBe(false);
  });

  it("keeps top domains jailed to the unix home", () => {
    const home = "/home/site";
    const web = `${home}/public_html`;
    expect(filesRootFromWebRoot(home, web)).toBe(home);
    expect(defaultDirFromRoots(home, web)).toBe("public_html");
  });

  it("uses a custom webRoot as the Files jail", () => {
    const home = "/home/site";
    const web = `${home}/apps/minecraft/www`;
    expect(filesRootFromWebRoot(home, web)).toBe(web);
    expect(defaultDirFromRoots(web, web)).toBe("");
  });
});
