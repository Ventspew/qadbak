import { auditLog } from "@/lib/audit";
import { handleApiError, jsonOk } from "@/lib/api";
import { requireDomainApiNotAlias } from "@/lib/domain-api";
import type { NewsletterOverview, NewsletterSettings } from "@/lib/newsletter/types";
import { runProvisioningHelper } from "@/lib/provisioner/native-exec";

type Params = { params: Promise<{ domain: string }> };

export async function GET(_req: Request, { params }: Params) {
  try {
    const { session, domain } = await requireDomainApiNotAlias((await params).domain, "mail");
    const raw = await runProvisioningHelper("newsletter-get", domain);
    return jsonOk({
      settings: raw.settings as NewsletterSettings,
      stats: raw.stats as NewsletterOverview["stats"],
      campaigns: raw.campaigns as number,
      publicUrls: raw.publicUrls as NewsletterOverview["publicUrls"],
      role: session.role,
    });
  } catch (err) {
    return handleApiError(err);
  }
}

export async function POST(request: Request, { params }: Params) {
  try {
    const { session, domain } = await requireDomainApiNotAlias((await params).domain, "mail");
    const body = (await request.json()) as Partial<NewsletterSettings>;
    const raw = await runProvisioningHelper(
      "newsletter-set",
      domain,
      JSON.stringify(body),
    );
    await auditLog(session.username, "newsletter-settings-update", domain);
    return jsonOk({ ok: true, settings: raw.settings });
  } catch (err) {
    return handleApiError(err);
  }
}
