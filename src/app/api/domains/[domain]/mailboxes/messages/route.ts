import { handleApiError, jsonError, jsonOk } from "@/lib/api";
import { requireDomainApiNotAlias } from "@/lib/domain-api";
import { isPremiumFeatureEnabled } from "@/lib/premium/server";
import { assertActorDomainAccess } from "@/lib/rbac";
import { nativeImapEnabled } from "@/lib/provisioner/native-features";
import { runProvisioningHelper } from "@/lib/provisioner/native-exec";

type Params = { params: Promise<{ domain: string }> };

export async function GET(request: Request, { params }: Params) {
  try {
    const { session, domain } = await requireDomainApiNotAlias((await params).domain, "mail");
    if (!(await isPremiumFeatureEnabled("webmail-ui"))) {
      return jsonError("Qmail requires Premium (webmail-ui feature).", 402);
    }
    const sp = new URL(request.url).searchParams;
    const user = sp.get("user") ?? "";
    const folder = sp.get("folder") ?? "INBOX";

    if (!nativeImapEnabled()) {
      return jsonError(
        "IMAP (Qmail) requires Dovecot. Add imap to QADBAK_NATIVE_FEATURES in .env.local, then restart the panel.",
        501,
      );
    }

    assertActorDomainAccess(session, domain);
    const raw = await runProvisioningHelper(
      "imap-messages",
      domain,
      user,
      folder,
    );
    return jsonOk({
      messages: (raw.messages as unknown[]) ?? [],
      folder: (raw.folder as string) ?? folder,
      authUser: raw.authUser as string | undefined,
      maildirRoot: raw.maildirRoot as string | undefined,
      source: (raw.source as string) ?? undefined,
      count: Array.isArray(raw.messages) ? raw.messages.length : 0,
    });
  } catch (err) {
    return handleApiError(err);
  }
}
