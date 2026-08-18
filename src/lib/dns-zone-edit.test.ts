import { describe, expect, it } from "vitest";
import {
  bumpSoaSerial,
  canonDnsName,
  deleteZoneText,
  mapNameFromParentZone,
  mapNameToParentZone,
  nextSoaSerial,
  subLabelForParent,
  upsertZoneText,
} from "../../scripts/lib/dns-zone-edit.mjs";

const SAMPLE = `\$TTL 3600
@   IN  SOA ns1.example.com. admin.example.com. (
        2026010101 ; Serial
        3600
        1800
        1209600
        86400 )
@       IN  NS      ns1.example.com.
@       IN  A       1.1.1.1
www     IN  A       1.1.1.1
blog    IN  A       2.2.2.2
@       IN  MX  10  mail.example.com.
`;

describe("dns zone edit", () => {
  it("canonicalizes names against the origin", () => {
    expect(canonDnsName("@", "example.com")).toBe("@");
    expect(canonDnsName("example.com", "example.com")).toBe("@");
    expect(canonDnsName("blog.example.com", "example.com")).toBe("blog");
    expect(canonDnsName("blog", "example.com")).toBe("blog");
  });

  it("upserts A records instead of appending duplicates", () => {
    const next = upsertZoneText(
      SAMPLE,
      { name: "www", type: "A", value: "9.9.9.9" },
      "example.com",
    );
    expect(next.match(/www\s+IN\s+A\s+9\.9\.9\.9/i)).toBeTruthy();
    expect(next.match(/www\s+IN\s+A\s+1\.1\.1\.1/i)).toBeNull();
    expect((next.match(/\bIN\s+A\b/gi) || []).length).toBe(3);
  });

  it("keeps multiple MX values and refuses substring deletes", () => {
    const withSecond = upsertZoneText(
      SAMPLE,
      { name: "@", type: "MX", value: "mail2.example.com", priority: "20" },
      "example.com",
    );
    expect(withSecond).toMatch(/MX\s+10\s+mail\.example\.com/i);
    expect(withSecond).toMatch(/MX\s+20\s+mail2\.example\.com/i);
    const afterDel = deleteZoneText(
      withSecond,
      { name: "@", type: "MX", value: "mail.example.com", priority: "10" },
      "example.com",
    );
    expect(afterDel).not.toMatch(/MX\s+10\s+mail\.example\.com/i);
    expect(afterDel).toMatch(/MX\s+20\s+mail2\.example\.com/i);
    expect(afterDel).toMatch(/\bIN\s+A\s+1\.1\.1\.1/);
  });

  it("bumps YYYYMMDDNN SOA serials", () => {
    expect(nextSoaSerial(2026010101)).toBeGreaterThan(2026010101);
    const bumped = bumpSoaSerial(SAMPLE);
    expect(bumped).not.toMatch(/2026010101/);
    expect(bumped).toMatch(/SOA ns1\.example\.com\./);
  });

  it("maps subdomain labels onto the parent zone", () => {
    expect(subLabelForParent("blog.example.com", "example.com")).toBe("blog");
    expect(mapNameToParentZone("@", "blog")).toBe("blog");
    expect(mapNameToParentZone("www", "blog")).toBe("www.blog");
    expect(mapNameFromParentZone("blog", "blog")).toBe("@");
    expect(mapNameFromParentZone("www.blog", "blog")).toBe("www");
    expect(mapNameFromParentZone("www", "blog")).toBeNull();
    expect(mapNameFromParentZone("@", "blog")).toBeNull();
  });
});
