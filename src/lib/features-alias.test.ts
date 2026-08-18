import { describe, expect, it } from "vitest";
import { ADMIN_NAV, featuresForDomain, isAliasBlockedFeaturePath } from "./features";

describe("featuresForDomain alias type", () => {
  it("hides mail, DNS, SSL, backups, and aliases for alias domains", () => {
    const ids = featuresForDomain("admin", true, { type: "alias" }).map((f) => f.id);
    expect(ids).not.toContain("mail");
    expect(ids).not.toContain("dns");
    expect(ids).not.toContain("ssl");
    expect(ids).not.toContain("backups");
    expect(ids).not.toContain("aliases");
    expect(ids).toContain("files");
  });

  it("blocks bookmark paths for alias domains", () => {
    expect(isAliasBlockedFeaturePath("/domains/alias.example/mail")).toBe(true);
    expect(isAliasBlockedFeaturePath("/domains/alias.example/mail/accounts")).toBe(
      true,
    );
    expect(isAliasBlockedFeaturePath("/domains/alias.example/email")).toBe(true);
    expect(isAliasBlockedFeaturePath("/domains/alias.example/files")).toBe(false);
    expect(isAliasBlockedFeaturePath("/domains/alias.example")).toBe(false);
  });

  it("keeps mail and DNS for top-level domains", () => {
    const ids = featuresForDomain("admin", true, { type: "top" }).map((f) => f.id);
    expect(ids).toContain("mail");
    expect(ids).toContain("dns");
    expect(ids).toContain("ssl");
    expect(ids).toContain("backups");
  });
});

describe("ADMIN_NAV", () => {
  it("includes Docker next to Status", () => {
    const paths = ADMIN_NAV.map((n) => n.path);
    expect(paths).toContain("/admin/docker");
    expect(paths.indexOf("/admin/docker")).toBe(paths.indexOf("/admin/status") + 1);
  });
});
