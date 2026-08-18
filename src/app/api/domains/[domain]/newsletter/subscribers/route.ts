import { auditLog } from "@/lib/audit";
import { handleApiError, jsonError, jsonOk } from "@/lib/api";
import { requireDomainApiNotAlias } from "@/lib/domain-api";
import type { NewsletterSubscriber } from "@/lib/newsletter/types";
import { runProvisioningHelper } from "@/lib/provisioner/native-exec";

type Params = { params: Promise<{ domain: string }> };

export async function GET(_req: Request, { params }: Params) {
  try {
    const { domain } = await requireDomainApiNotAlias((await params).domain, "mail");
    const raw = await runProvisioningHelper("newsletter-subscribers-list", domain);
    return jsonOk({
      subscribers: (raw.subscribers as NewsletterSubscriber[]) ?? [],
    });
  } catch (err) {
    return handleApiError(err);
  }
}

export async function POST(request: Request, { params }: Params) {
  try {
    const { session, domain } = await requireDomainApiNotAlias((await params).domain, "mail");
    const body = (await request.json()) as {
      email?: string;
      name?: string;
      resubscribe?: boolean;
    };
    if (!body.email?.trim()) return jsonError("Email is required.");
    const raw = await runProvisioningHelper(
      "newsletter-subscriber-upsert",
      domain,
      JSON.stringify(body),
    );
    await auditLog(session.username, "newsletter-subscriber-add", domain, body.email);
    return jsonOk({
      ok: true,
      subscriber: raw.subscriber,
      created: raw.created,
    });
  } catch (err) {
    return handleApiError(err);
  }
}

export async function DELETE(request: Request, { params }: Params) {
  try {
    const { session, domain } = await requireDomainApiNotAlias((await params).domain, "mail");
    const body = (await request.json()) as { email?: string; id?: string };
    const key = body.id?.trim() || body.email?.trim();
    if (!key) return jsonError("Email or id is required.");
    await runProvisioningHelper("newsletter-subscriber-delete", domain, key);
    await auditLog(session.username, "newsletter-subscriber-delete", domain, key);
    return jsonOk({ ok: true });
  } catch (err) {
    return handleApiError(err);
  }
}
