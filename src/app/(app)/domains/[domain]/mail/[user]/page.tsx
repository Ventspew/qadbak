import Link from "next/link";
import { QadbakWebmailClient } from "@/components/QadbakWebmailClient";
import { requireDomainAccess } from "@/lib/domain-api";
import { isPremiumFeatureEnabled } from "@/lib/premium/server";
import { getProvisioner } from "@/lib/provisioner";

type Props = { params: Promise<{ domain: string; user: string }> };

export default async function WebmailPage({ params }: Props) {
  const { session, domain } = await requireDomainAccess((await params).domain);
  const user = decodeURIComponent((await params).user);

  if (!(await isPremiumFeatureEnabled("webmail-ui"))) {
    return (
      <div className="max-w-lg space-y-4 rounded-lg border border-panel-border bg-panel-surface p-6">
        <h1 className="text-xl font-semibold text-white">Qmail</h1>
        <p className="text-panel-muted">
          Built-in IMAP mail (Qmail) is a Premium feature. The free core still supports
          mailboxes, forwarding, and delivery logs - use your own mail client or
          activate Premium in Server admin → License.
        </p>
        <Link href={`/domains/${encodeURIComponent(domain)}`} className="text-panel-link hover:underline">
          Back to {domain}
        </Link>
        {session.role === "admin" && (
          <Link href="/admin/license" className="ml-4 text-panel-link hover:underline">
            License
          </Link>
        )}
      </div>
    );
  }

  let mailboxes: Awaited<ReturnType<ReturnType<typeof getProvisioner>["listImapMailboxes"]>> = [];
  let error = "";
  try {
    mailboxes = await getProvisioner().listImapMailboxes(domain, user, session);
  } catch (e) {
    error = e instanceof Error ? e.message : "Could not load mailboxes.";
  }

  return (
    <QadbakWebmailClient
      domain={domain}
      initialMailboxes={mailboxes}
      initialError={error}
      initialUser={user}
    />
  );
}
