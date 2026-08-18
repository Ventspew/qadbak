import { describe, expect, it, beforeEach, afterEach } from "vitest";
import {
  assertDemoTerminalAllowed,
  demoTerminalBlocked,
  demoTerminalBlockedForUser,
  isDemoUser,
} from "./demo-mode";
import {
  demoBlockedPath,
  demoMutationBlocked,
} from "../middleware/demo-readonly";

describe("demo terminal blocking", () => {
  const env = { ...process.env };

  beforeEach(() => {
    process.env.QADBAK_DEMO_READ_ONLY = "true";
    process.env.QADBAK_DEMO_USERNAME = "demo";
  });

  afterEach(() => {
    process.env = { ...env };
  });

  it("detects demo user", () => {
    expect(isDemoUser("demo")).toBe(true);
    expect(isDemoUser("admin")).toBe(false);
  });

  it("blocks terminal when read-only demo", () => {
    expect(demoTerminalBlocked()).toBe(true);
    expect(demoTerminalBlockedForUser("demo")).toBe(true);
    expect(demoTerminalBlockedForUser("admin")).toBe(false);
    expect(() => assertDemoTerminalAllowed("demo")).toThrow(/disabled/i);
    expect(() => assertDemoTerminalAllowed("admin")).not.toThrow();
  });

  it("blocks GET ws-token routes in middleware", () => {
    expect(demoBlockedPath("/api/admin/terminal/ws-token")).toBe(true);
    expect(
      demoBlockedPath("/api/domains/showcase.qadbak.com/terminal/ws-token"),
    ).toBe(true);
    expect(
      demoMutationBlocked("/api/admin/terminal/ws-token", "GET", "demo"),
    ).toBe(true);
    expect(
      demoMutationBlocked("/api/domains/example.com/files", "GET", "demo"),
    ).toBe(false);
  });

  it("blocks demo POST uploads that skip middleware", () => {
    expect(
      demoMutationBlocked("/api/domains/example.com/files/upload", "POST", "demo"),
    ).toBe(true);
    expect(
      demoMutationBlocked(
        "/api/domains/example.com/backups/upload",
        "POST",
        "demo",
      ),
    ).toBe(true);
    expect(
      demoMutationBlocked("/api/domains/example.com/files/upload", "POST", "admin"),
    ).toBe(false);
  });

  it("allows terminal when explicitly enabled on demo host", () => {
    process.env.QADBAK_DEMO_TERMINAL_DISABLED = "false";
    expect(demoTerminalBlocked()).toBe(false);
    expect(() => assertDemoTerminalAllowed("demo")).not.toThrow();
  });
});
