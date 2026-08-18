import { describe, expect, it } from "vitest";
import { certMatchesDomain } from "../../scripts/lib/ssl-cert-match.mjs";

describe("certMatchesDomain", () => {
  it("matches exact, www, and dotted suffixes only", () => {
    expect(certMatchesDomain("example.com", "example.com")).toBe(true);
    expect(certMatchesDomain("www.example.com", "example.com")).toBe(true);
    expect(certMatchesDomain("shop.example.com", "example.com")).toBe(true);
    expect(certMatchesDomain("notexample.com", "example.com")).toBe(false);
    expect(certMatchesDomain("example.com.evil", "example.com")).toBe(false);
  });
});
