import { auditLog } from "@/lib/audit";
import { handleApiError, jsonError, jsonOk } from "@/lib/api";
import { requireDomainApiNotAlias } from "@/lib/domain-api";
import { isPremiumFeatureEnabled } from "@/lib/premium/server";
import {
  nativeFeatureEnabled,
  nativeImapEnabled,
} from "@/lib/provisioner/native-features";
import { runProvisioningHelper } from "@/lib/provisioner/native-exec";

type Params = { params: Promise<{ domain: string }> };

export async function POST(request: Request, { params }: Params) {
  try {
    const { session, domain } = await requireDomainApiNotAlias((await params).domain, "mail");
    if (!(await isPremiumFeatureEnabled("webmail-ui"))) {
      return jsonError("Qmail requires Premium (webmail-ui feature).", 402);
    }
    if (!nativeImapEnabled() && !nativeFeatureEnabled("mail")) {
      return jsonError("Native mail send is not enabled on this server.", 503);
    }

    const body = (await request.json()) as {
      user?: string;
      to?: string;
      cc?: string;
      subject?: string;
      body?: string;
      inReplyTo?: string;
      references?: string;
    };
    if (!body.user?.trim()) {
      return jsonError("Mailbox user is required.");
    }
    if (!body.to?.trim()) {
      return jsonError("Recipient (to) is required.");
    }

    const payload = JSON.stringify({
      to: body.to.trim(),
      cc: body.cc?.trim() ?? "",
      subject: body.subject ?? "",
      body: body.body ?? "",
      inReplyTo: body.inReplyTo?.trim() ?? "",
      references: body.references?.trim() ?? "",
    });

    const raw = await runProvisioningHelper(
      "mail-send",
      domain,
      body.user.trim(),
      payload,
    );

    await auditLog(session.username, "send-mail", domain);
    return jsonOk({
      ok: true,
      from: raw.from as string | undefined,
      to: raw.to as string | undefined,
      source: raw.source as string | undefined,
      savedToSent: raw.savedToSent as boolean | undefined,
      sentSaveError: raw.sentSaveError as string | undefined,
    });
  } catch (err) {
    return handleApiError(err);
  }
}
