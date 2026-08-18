import { describe, expect, it } from "vitest";
import {
  isQadbakZoneFile,
  listNamedLocalZones,
  stripNamedZoneBlock,
} from "../../scripts/lib/bind-zone-remove.mjs";

const SAMPLE = `
zone "example.com" {
    type master;
    file "/var/lib/bind/example.com.hosts";
};

zone "keep.org" {
    type master;
    file "/var/lib/bind/keep.org.hosts";
};
`;

describe("bind-zone-remove", () => {
  it("strips one zone block and leaves others", () => {
    const next = stripNamedZoneBlock(SAMPLE, "example.com");
    expect(next).not.toContain('zone "example.com"');
    expect(next).toContain('zone "keep.org"');
  });

  it("lists zones from named.conf.local", () => {
    const rows = listNamedLocalZones(SAMPLE);
    expect(rows.map((r) => r.name)).toEqual(["example.com", "keep.org"]);
    expect(rows[0].file).toBe("/var/lib/bind/example.com.hosts");
  });

  it("only treats Qadbak zone file paths as owned", () => {
    expect(isQadbakZoneFile("example.com", "/var/lib/bind/example.com.hosts")).toBe(
      true,
    );
    expect(isQadbakZoneFile("example.com", "/etc/bind/zones/db.example.com")).toBe(
      true,
    );
    expect(
      isQadbakZoneFile("example.com", "/etc/bind/named.conf.default-zones"),
    ).toBe(false);
    expect(isQadbakZoneFile("example.com", "/var/lib/bind/other.com.hosts")).toBe(
      false,
    );
  });
});
