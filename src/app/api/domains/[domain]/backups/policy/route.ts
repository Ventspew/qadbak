import { auditLog } from "@/lib/audit";
import { handleApiError, jsonError, jsonOk } from "@/lib/api";
import { requireDomainApiNotAlias } from "@/lib/domain-api";
import { isPremiumFeatureEnabled } from "@/lib/premium/server";
import { runProvisioningHelper } from "@/lib/provisioner/native-exec";

type Params = { params: Promise<{ domain: string }> };

export async function GET(_req: Request, { params }: Params) {
  try {
    const { session, domain } = await requireDomainApiNotAlias((await params).domain, "backups");
    if (session.role !== "admin") {
      return jsonError("Only administrators may view offsite backup policy.", 403);
    }
    const r = await runProvisioningHelper("backup-policy-get", domain);
    return jsonOk({ policy: r.policy ?? {} });
  } catch (err) {
    return handleApiError(err);
  }
}

export async function PATCH(request: Request, { params }: Params) {
  try {
    const { session, domain } = await requireDomainApiNotAlias((await params).domain, "backups");
    if (session.role !== "admin") {
      return jsonError("Only administrators may change offsite backup policy.", 403);
    }
    const body = (await request.json()) as {
      offsite?: boolean;
      providerId?: string;
    };
    if (body.offsite && !(await isPremiumFeatureEnabled("offsite-backup"))) {
      return jsonError("Offsite backups require Premium (offsite-backup feature).", 402);
    }
    await runProvisioningHelper(
      "backup-policy-set",
      domain,
      JSON.stringify(body),
    );
    await auditLog(session.username, "backup-policy", domain);
    const r = await runProvisioningHelper("backup-policy-get", domain);
    return jsonOk({ policy: r.policy ?? {} });
  } catch (err) {
    return handleApiError(err);
  }
}
