import { auditLog } from "@/lib/audit";
import { handleApiError, jsonError, jsonOk } from "@/lib/api";
import { requireDomainApiNotAlias } from "@/lib/domain-api";
import { getProvisioner } from "@/lib/provisioner";

type Params = { params: Promise<{ domain: string }> };

export async function POST(request: Request, { params }: Params) {
  try {
    const { session, domain } = await requireDomainApiNotAlias((await params).domain, "backups");
    if (session.role !== "admin") {
      return jsonError("Only administrators may perform a restore.", 403);
    }
    const body = (await request.json()) as {
      source?: string;
      test?: boolean;
    };
    if (!body.source?.trim()) {
      return jsonError("Source path or S3 URL is required.");
    }
    const result = await getProvisioner().restoreDomain(
      domain,
      body.source.trim(),
      { test: body.test === true, allFeatures: true },
      session,
    );
    await auditLog(session.username, "restore-domain", domain, body.source.trim());
    return jsonOk({ ok: true, result });
  } catch (err) {
    return handleApiError(err);
  }
}
