import { DnsManager } from "@/components/DnsManager";
import { requireDomainPageNotAlias } from "@/lib/domain-api";
import { getProvisioner } from "@/lib/provisioner";

type Props = { params: Promise<{ domain: string }> };

export default async function DnsPage({ params }: Props) {
  const { session, domain } = await requireDomainPageNotAlias((await params).domain);
  let records: Awaited<ReturnType<ReturnType<typeof getProvisioner>["getDns"]>>["records"] = [];
  let error = "";
  try {
    const result = await getProvisioner().getDns(domain, session);
    records = result.records;
  } catch (e) {
    error = e instanceof Error ? e.message : "Could not load DNS.";
  }
  return <DnsManager domain={domain} initialRecords={records} initialError={error} />;
}
