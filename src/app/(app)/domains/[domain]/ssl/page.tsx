import { SslManager } from "@/components/SslManager";
import { requireDomainPageNotAlias } from "@/lib/domain-api";
import { getProvisioner } from "@/lib/provisioner";

type Props = { params: Promise<{ domain: string }> };

export default async function SslPage({ params }: Props) {
  const { session, domain } = await requireDomainPageNotAlias((await params).domain);
  let certs: Awaited<ReturnType<ReturnType<typeof getProvisioner>["listSslCerts"]>> = [];
  let error = "";
  try {
    certs = await getProvisioner().listSslCerts(domain, session);
  } catch (e) {
    error = e instanceof Error ? e.message : "Could not load certificates.";
  }
  return <SslManager domain={domain} initialCerts={certs} initialError={error} />;
}
