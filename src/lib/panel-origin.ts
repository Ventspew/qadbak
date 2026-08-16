import { trustProxyHeaders } from "./security-config";

function protoFromRequest(request: Request): "http" | "https" {
  try {
    const url = new URL(request.url);
    if (url.protocol === "https:") return "https";
  } catch {
    /* ignore */
  }
  return "http";
}

/** Public panel origin for OAuth redirect URIs (honours reverse-proxy headers). */
export function panelPublicOrigin(request: Request): string {
  const host = trustProxyHeaders()
    ? request.headers.get("x-forwarded-host")?.split(",")[0]?.trim() ||
      request.headers.get("host")?.trim()
    : request.headers.get("host")?.trim();
  const proto = trustProxyHeaders()
    ? request.headers.get("x-forwarded-proto")?.split(",")[0]?.trim() ||
      protoFromRequest(request)
    : protoFromRequest(request);
  const scheme = proto === "https" ? "https" : "http";
  if (host) return `${scheme}://${host}`;
  const envHost = process.env.QADBAK_PUBLIC_HOST?.trim();
  if (envHost) return `https://${envHost}`;
  try {
    return new URL(request.url).origin;
  } catch {
    return "http://127.0.0.1:3000";
  }
}

export function discordAdminRedirectUri(origin: string): string {
  return `${origin.replace(/\/$/, "")}/auth/callback`;
}
