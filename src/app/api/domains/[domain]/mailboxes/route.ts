import { auditLog } from "@/lib/audit";
import { handleApiError, jsonError, jsonOk } from "@/lib/api";
import { requireDomainApiNotAlias } from "@/lib/domain-api";
import { isPremiumFeatureEnabled } from "@/lib/premium/server";
import { getProvisioner } from "@/lib/provisioner";
import { nativeImapEnabled } from "@/lib/provisioner/native-features";
import { runProvisioningHelper } from "@/lib/provisioner/native-exec";

type Params = { params: Promise<{ domain: string }> };

type ImapUser = { user: string; email?: string; label?: string };

export async function GET(request: Request, { params }: Params) {
  try {
    const { session, domain } = await requireDomainApiNotAlias((await params).domain, "mail");
    const user = new URL(request.url).searchParams.get("user") ?? "";

    if (user.trim() && !(await isPremiumFeatureEnabled("webmail-ui"))) {
      return jsonError("Qmail requires Premium (webmail-ui feature).", 402);
    }

    if (nativeImapEnabled()) {
      const raw = await runProvisioningHelper("imap-list", domain, user);
      return jsonOk({
        mailboxes: (raw.mailboxes as unknown[]) ?? [],
        users: (raw.users as ImapUser[]) ?? [],
        authUser: raw.authUser as string | undefined,
        maildirRoot: raw.maildirRoot as string | undefined,
        source: raw.source as string | undefined,
        hint: raw.hint as string | undefined,
      });
    }

    const mailboxes = await getProvisioner().listImapMailboxes(
      domain,
      user || undefined,
      session,
    );
    return jsonOk({ mailboxes });
  } catch (err) {
    return handleApiError(err);
  }
}

export async function POST(request: Request, { params }: Params) {
  try {
    const { session, domain } = await requireDomainApiNotAlias((await params).domain, "mail");
    if (session.role !== "admin") {
      return jsonError("Only administrators may copy mailboxes.", 403);
    }
    const body = (await request.json()) as {
      from?: string;
      to?: string;
      user?: string;
    };
    if (!body.from || !body.to) {
      return jsonError("from and to are required.");
    }
    await getProvisioner().copyMailbox(
      domain,
      body.from,
      body.to,
      session,
      body.user,
    );
    await auditLog(session.username, "copy-mailbox", domain);
    return jsonOk({ ok: true });
  } catch (err) {
    return handleApiError(err);
  }
}
