import { auditLog } from "@/lib/audit";
import { handleApiError, jsonError, jsonOk } from "@/lib/api";
import { requireDomainApiNotAlias } from "@/lib/domain-api";
import { runProvisioningHelper } from "@/lib/provisioner/native-exec";

type Params = { params: Promise<{ domain: string }> };

export async function POST(request: Request, { params }: Params) {
  try {
    const { session, domain } = await requireDomainApiNotAlias((await params).domain, "mail");
    const body = (await request.json()) as {
      to?: string;
      subject?: string;
      bodyHtml?: string;
      bodyText?: string;
    };
    if (!body.to?.trim()) return jsonError("Test recipient is required.");
    await runProvisioningHelper(
      "newsletter-campaign-test",
      domain,
      JSON.stringify(body),
    );
    await auditLog(session.username, "newsletter-campaign-test", domain, body.to);
    return jsonOk({ ok: true, to: body.to });
  } catch (err) {
    return handleApiError(err);
  }
}
