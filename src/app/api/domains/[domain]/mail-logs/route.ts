import { auditLog } from "@/lib/audit";
import { handleApiError, jsonError, jsonOk } from "@/lib/api";
import { requireDomainApiNotAlias } from "@/lib/domain-api";
import { getProvisioner } from "@/lib/provisioner";

type Params = { params: Promise<{ domain: string }> };

export async function GET(request: Request, { params }: Params) {
  try {
    const { session, domain } = await requireDomainApiNotAlias((await params).domain, "mail");
    const query = new URL(request.url).searchParams.get("q") ?? "";
    const lines = await getProvisioner().searchMailLogs(domain, query, session);
    return jsonOk({ lines });
  } catch (err) {
    return handleApiError(err);
  }
}

export async function POST(request: Request, { params }: Params) {
  try {
    const { session, domain } = await requireDomainApiNotAlias((await params).domain, "mail");
    if (session.role !== "admin") {
      return jsonError("Administrators only.", 403);
    }
    const body = (await request.json()) as { messageId?: string };
    if (!body.messageId) return jsonError("messageId is required.");
    await getProvisioner().resendEmail(domain, body.messageId, session);
    await auditLog(session.username, "resend-email", domain);
    return jsonOk({ ok: true });
  } catch (err) {
    return handleApiError(err);
  }
}
