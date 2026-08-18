import { AliasesManager } from "@/components/AliasesManager";
import { requireDomainPageNotAlias } from "@/lib/domain-api";
import { getProvisioner } from "@/lib/provisioner";

type Props = { params: Promise<{ domain: string }> };

export default async function AliasesPage({ params }: Props) {
  const { session, domain } = await requireDomainPageNotAlias((await params).domain);
  let aliases: Awaited<ReturnType<ReturnType<typeof getProvisioner>["listAliases"]>> = [];
  let error = "";
  try {
    aliases = await getProvisioner().listAliases(domain, session);
  } catch (e) {
    error = e instanceof Error ? e.message : "Could not load aliases.";
  }
  return (
    <AliasesManager domain={domain} initialAliases={aliases} initialError={error} />
  );
}
