import { auditLog } from "@/lib/audit";
import { handleApiError, jsonError, jsonOk } from "@/lib/api";
import { requireDomainApiNotAlias } from "@/lib/domain-api";
import { runProvisioningHelper } from "@/lib/provisioner/native-exec";

type Params = { params: Promise<{ domain: string }> };

export async function POST(request: Request, { params }: Params) {
  try {
    const { session, domain } = await requireDomainApiNotAlias((await params).domain, "mail");
    const body = (await request.json()) as { campaignId?: string };
    if (!body.campaignId?.trim()) return jsonError("campaignId is required.");

    const queued = await runProvisioningHelper(
      "newsletter-campaign-queue",
      domain,
      body.campaignId.trim(),
    );
    await auditLog(
      session.username,
      "newsletter-campaign-send",
      domain,
      body.campaignId,
    );

    let remaining = (queued.queued as number) ?? 0;
    let totalSent = 0;
    let totalFailed = 0;
    const maxRounds = 20;

    for (let i = 0; i < maxRounds && remaining > 0; i++) {
      const batch = await runProvisioningHelper("newsletter-send-batch", domain, "50");
      totalSent += (batch.sent as number) ?? 0;
      totalFailed += (batch.failed as number) ?? 0;
      remaining = (batch.remaining as number) ?? 0;
      if (batch.done) break;
    }

    return jsonOk({
      ok: true,
      queued: queued.queued,
      sent: totalSent,
      failed: totalFailed,
      remaining,
      done: remaining === 0,
    });
  } catch (err) {
    return handleApiError(err);
  }
}
