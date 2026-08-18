import { handleApiError, jsonOk } from "@/lib/api";
import { requireDomainApiNotAlias } from "@/lib/domain-api";
import { runProvisioningHelper } from "@/lib/provisioner/native-exec";

type Params = { params: Promise<{ domain: string }> };

export async function POST(request: Request, { params }: Params) {
  try {
    const { domain } = await requireDomainApiNotAlias((await params).domain, "mail");
    const body = (await request.json().catch(() => ({}))) as { max?: number };
    const max = Math.min(100, Math.max(1, body.max ?? 50));
    const batch = await runProvisioningHelper(
      "newsletter-send-batch",
      domain,
      String(max),
    );
    return jsonOk({
      ok: true,
      processed: batch.processed,
      sent: batch.sent,
      failed: batch.failed,
      remaining: batch.remaining,
      done: batch.done,
      campaigns: batch.campaigns,
    });
  } catch (err) {
    return handleApiError(err);
  }
}
