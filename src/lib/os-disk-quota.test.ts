import { describe, expect, it } from "vitest";
import { parseDiskLimitToKb } from "../../scripts/lib/os-disk-quota.mjs";

describe("parseDiskLimitToKb", () => {
  it("treats bare numbers as MB (Limits UI)", () => {
    expect(parseDiskLimitToKb("100")).toBe(100 * 1024);
    expect(parseDiskLimitToKb("5000")).toBe(5000 * 1024);
  });

  it("parses unit suffixes", () => {
    expect(parseDiskLimitToKb("1G")).toBe(1024 * 1024);
    expect(parseDiskLimitToKb("2GB")).toBe(2 * 1024 * 1024);
    expect(parseDiskLimitToKb("1024KB")).toBe(1024);
  });

  it("treats empty and unlimited as 0", () => {
    expect(parseDiskLimitToKb("")).toBe(0);
    expect(parseDiskLimitToKb("unlimited")).toBe(0);
    expect(parseDiskLimitToKb("0")).toBe(0);
  });
});
