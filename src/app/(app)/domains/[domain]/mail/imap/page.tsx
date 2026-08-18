import { redirect } from "next/navigation";
import { ImapMailboxesManager } from "@/components/ImapMailboxesManager";
import { requireDomainAccess } from "@/lib/domain-api";
import { getProvisioner } from "@/lib/provisioner";

type Props = { params: Promise<{ domain: string }> };

export default async function MailImapPage({ params }: Props) {
  const { session, domain } = await requireDomainAccess((await params).domain);
  if (session.role !== "admin") {
    redirect(`/domains/${encodeURIComponent(domain)}/mail`);
  }
  let mailboxes: Awaited<ReturnType<ReturnType<typeof getProvisioner>["listImapMailboxes"]>> = [];
  let error = "";
  try {
    mailboxes = await getProvisioner().listImapMailboxes(domain, "", session);
  } catch (e) {
    error = e instanceof Error ? e.message : "Could not load mailboxes.";
  }
  return (
    <ImapMailboxesManager
      domain={domain}
      initialMailboxes={mailboxes}
      initialError={error}
      isAdmin={session.role === "admin"}
    />
  );
}
