import { NextRequest } from "next/server";
import { describe, expect, it } from "vitest";
import { csrfCheckFailed } from "./request-security";

function req(
  headers: Record<string, string>,
  init?: { method?: string; url?: string },
) {
  return new NextRequest(init?.url ?? "https://qadbak.com/api/domains", {
    method: init?.method ?? "POST",
    headers,
  });
}

describe("csrfCheckFailed", () => {
  it("allows same-origin Origin on cookie sessions", () => {
    expect(
      csrfCheckFailed(
        req({
          host: "qadbak.com",
          origin: "https://qadbak.com",
          cookie: "panel_session=abc",
        }),
      ),
    ).toBe(false);
  });

  it("blocks cookie sessions that only send a fake Bearer header", () => {
    expect(
      csrfCheckFailed(
        req({
          host: "qadbak.com",
          authorization: "Bearer not-a-real-token",
          cookie: "panel_session=abc",
        }),
      ),
    ).toBe(true);
  });

  it("allows token-only Bearer clients without Origin (iOS)", () => {
    expect(
      csrfCheckFailed(
        req({
          host: "qadbak.com",
          authorization: "Bearer mobile-jwt",
        }),
      ),
    ).toBe(false);
  });

  it("does not treat attacker X-Forwarded-Host as the panel origin", () => {
    expect(
      csrfCheckFailed(
        req({
          host: "qadbak.com",
          origin: "https://evil.example",
          "x-forwarded-host": "evil.example",
          "x-forwarded-proto": "https",
          cookie: "panel_session=abc",
        }),
      ),
    ).toBe(true);
  });

  it("skips CSRF for internal token routes", () => {
    expect(
      csrfCheckFailed(
        req(
          { host: "127.0.0.1:3000" },
          { url: "http://127.0.0.1:3000/api/internal/session-revocation" },
        ),
      ),
    ).toBe(false);
  });
});
