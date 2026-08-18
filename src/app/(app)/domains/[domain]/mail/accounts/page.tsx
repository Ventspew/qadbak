import { EmailManager } from "@/components/EmailManager";
import { requireDomainAccess } from "@/lib/domain-api";
import { getProvisioner } from "@/lib/provisioner";

type Props = { params: Promise<{ domain: string }> };

export default async function MailAccountsPage({ params }: Props) {
  const { session, domain } = await requireDomainAccess((await params).domain);
  let users: Awaited<ReturnType<ReturnType<typeof getProvisioner>["listMailboxes"]>> = [];
  let error = "";
  try {
    users = await getProvisioner().listMailboxes(domain, session);
  } catch (e) {
    error = e instanceof Error ? e.message : "Could not load mailboxes.";
  }

  return (
    <EmailManager
      domain={domain}
      initialUsers={users}
      initialError={error}
      isAdmin={session.role === "admin"}
    />
  );
}
