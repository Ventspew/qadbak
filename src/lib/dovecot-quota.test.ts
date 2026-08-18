import { describe, expect, it } from "vitest";
import { quotaUserdbLine } from "../../scripts/lib/dovecot-quota.mjs";

describe("quotaUserdbLine", () => {
  it("uses 7 colons before extra_fields", () => {
    const line = quotaUserdbLine("info", 250);
    expect(line).toBe("info:::::::userdb_quota_rule=*:storage=250M");
    expect(line?.startsWith("info:::::::")).toBe(true);
  });

  it("strips domain from mailbox address", () => {
    expect(quotaUserdbLine("info@example.com", 10)).toBe(
      "info:::::::userdb_quota_rule=*:storage=10M",
    );
  });

  it("skips empty or unlimited", () => {
    expect(quotaUserdbLine("info", 0)).toBeNull();
    expect(quotaUserdbLine("", 10)).toBeNull();
    expect(quotaUserdbLine("../x", 10)).toBeNull();
  });
});
