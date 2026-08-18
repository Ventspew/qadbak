import { handleApiError, jsonError, jsonOk } from "@/lib/api";
import { requireDomainApiNotAlias } from "@/lib/domain-api";
import { isPremiumFeatureEnabled } from "@/lib/premium/server";
import { assertActorDomainAccess } from "@/lib/rbac";
import { nativeImapEnabled } from "@/lib/provisioner/native-features";
import { runProvisioningHelper } from "@/lib/provisioner/native-exec";

type Params = { params: Promise<{ domain: string; id: string }> };

export async function GET(request: Request, { params }: Params) {
  try {
    const { session, domain } = await requireDomainApiNotAlias((await params).domain, "mail");
    if (!(await isPremiumFeatureEnabled("webmail-ui"))) {
      return jsonError("Qmail requires Premium (webmail-ui feature).", 402);
    }
    const { id } = await params;
    const sp = new URL(request.url).searchParams;
    const user = sp.get("user") ?? "";
    const folder = sp.get("folder") ?? "INBOX";
    const messageId = decodeURIComponent(id);

    if (!nativeImapEnabled()) {
      return jsonError(
        "IMAP (Qmail) requires Dovecot. Add imap to QADBAK_NATIVE_FEATURES in .env.local, then restart the panel.",
        501,
      );
    }

    assertActorDomainAccess(session, domain);
    const raw = await runProvisioningHelper(
      "imap-fetch",
      domain,
      user,
      folder,
      messageId,
    );
    return jsonOk({
      message: raw.message,
      folder: (raw.folder as string) ?? folder,
      authUser: raw.authUser as string | undefined,
    });
  } catch (err) {
    return handleApiError(err);
  }
}
