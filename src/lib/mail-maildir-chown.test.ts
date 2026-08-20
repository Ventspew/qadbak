import { describe, expect, it } from "vitest";
import { isSafeMaildirChownPath } from "../../scripts/lib/mail-layout.mjs";

describe("isSafeMaildirChownPath", () => {
  it("allows mailbox Maildir trees, not the domain unix home", () => {
    expect(isSafeMaildirChownPath("/home/altbay/Maildir")).toBe(true);
    expect(isSafeMaildirChownPath("/home/altbay/homes/alt/Maildir")).toBe(true);
    expect(isSafeMaildirChownPath("/home/altbay/homes/alt/Maildir/.Sent")).toBe(
      true,
    );
    expect(isSafeMaildirChownPath("/home/altbay")).toBe(false);
    expect(isSafeMaildirChownPath("/home")).toBe(false);
    expect(isSafeMaildirChownPath("/etc/dovecot")).toBe(false);
  });
});
