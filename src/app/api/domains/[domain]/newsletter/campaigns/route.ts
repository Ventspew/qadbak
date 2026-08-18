import { auditLog } from "@/lib/audit";
import { handleApiError, jsonError, jsonOk } from "@/lib/api";
import { requireDomainApiNotAlias } from "@/lib/domain-api";
import type { NewsletterCampaign } from "@/lib/newsletter/types";
import { runProvisioningHelper } from "@/lib/provisioner/native-exec";

type Params = { params: Promise<{ domain: string }> };

export async function GET(_req: Request, { params }: Params) {
  try {
    const { domain } = await requireDomainApiNotAlias((await params).domain, "mail");
    const raw = await runProvisioningHelper("newsletter-campaigns-list", domain);
    return jsonOk({ campaigns: (raw.campaigns as NewsletterCampaign[]) ?? [] });
  } catch (err) {
    return handleApiError(err);
  }
}

export async function POST(request: Request, { params }: Params) {
  try {
    const { session, domain } = await requireDomainApiNotAlias((await params).domain, "mail");
    const body = (await request.json()) as Partial<NewsletterCampaign> & {
      action?: string;
      campaignId?: string;
    };

    if (body.action === "delete") {
      const id = body.campaignId ?? body.id;
      if (!id) return jsonError("Campaign id is required.");
      await runProvisioningHelper("newsletter-campaign-delete", domain, id);
      await auditLog(session.username, "newsletter-campaign-delete", domain, id);
      return jsonOk({ ok: true });
    }

    const raw = await runProvisioningHelper(
      "newsletter-campaign-upsert",
      domain,
      JSON.stringify(body),
    );
    const created = !body.id;
    await auditLog(
      session.username,
      created ? "newsletter-campaign-create" : "newsletter-campaign-update",
      domain,
      String((raw.campaign as NewsletterCampaign)?.id ?? ""),
    );
    return jsonOk({ ok: true, campaign: raw.campaign });
  } catch (err) {
    return handleApiError(err);
  }
}
