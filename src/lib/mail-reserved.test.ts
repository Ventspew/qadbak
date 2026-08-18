import { describe, expect, it } from "vitest";
import { RESERVED_MAILBOX_LOCALS } from "../../scripts/lib/mail-reserved.mjs";

describe("reserved mailbox locals", () => {
  it("blocks panel mail tabs and keeps postmaster allowed", () => {
    expect(RESERVED_MAILBOX_LOCALS.has("accounts")).toBe(true);
    expect(RESERVED_MAILBOX_LOCALS.has("newsletter")).toBe(true);
    expect(RESERVED_MAILBOX_LOCALS.has("settings")).toBe(true);
    expect(RESERVED_MAILBOX_LOCALS.has("logs")).toBe(true);
    expect(RESERVED_MAILBOX_LOCALS.has("imap")).toBe(true);
    expect(RESERVED_MAILBOX_LOCALS.has("mail")).toBe(true);
    expect(RESERVED_MAILBOX_LOCALS.has("postmaster")).toBe(false);
  });
});
