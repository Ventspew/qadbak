import { notFound, redirect } from "next/navigation";
import { getSession, requireSession } from "./session";
import type { HostedDomain } from "./types";
import { getProvisioner } from "./provisioner";

async function resolveDomain(
  encodedDomain: string,
  onMissing: () => never,
): Promise<{
  session: Awaited<ReturnType<typeof requireSession>>;
  domain: string;
  domainInfo: HostedDomain;
}> {
  const session = await requireSession();
  const domainName = decodeURIComponent(encodedDomain);
  const domains = await getProvisioner().listDomains(session);
  const found = domains.find(
    (d) => d.name.toLowerCase() === domainName.toLowerCase(),
  );
  if (!found) onMissing();
  return { session, domain: domainName, domainInfo: found };
}

/** For server components / layouts */
export async function requireDomainAccess(encodedDomain: string) {
  return resolveDomain(encodedDomain, () => notFound());
}

/** For API route handlers */
export async function requireDomainApi(encodedDomain: string) {
  return resolveDomain(encodedDomain, () => {
    throw new Error("Domain not found.");
  });
}

export async function getSessionIfPresent() {
  return getSession();
}

export function assertNotAliasDomain(domainInfo: HostedDomain, service: string) {
  const type = String(domainInfo.type ?? "top").toLowerCase();
  if (type === "alias") {
    throw Object.assign(
      new Error(`Alias domains have no ${service}. Use the parent domain.`),
      { status: 400 },
    );
  }
}

export async function requireDomainApiNotAlias(
  encodedDomain: string,
  service: string,
) {
  const ctx = await requireDomainApi(encodedDomain);
  assertNotAliasDomain(ctx.domainInfo, service);
  return ctx;
}

export function redirectIfAlias(domainInfo: HostedDomain, domain: string) {
  if (String(domainInfo.type ?? "top").toLowerCase() === "alias") {
    redirect(`/domains/${encodeURIComponent(domain)}`);
  }
}

/** Pages that have no alias equivalent (mail, DNS, SSL, backups, aliases). */
export async function requireDomainPageNotAlias(encodedDomain: string) {
  const ctx = await requireDomainAccess(encodedDomain);
  redirectIfAlias(ctx.domainInfo, ctx.domain);
  return ctx;
}
