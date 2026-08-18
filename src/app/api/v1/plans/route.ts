import { auditLog } from "@/lib/audit";
import { apiV1Error, requireApiV1 } from "@/lib/api-v1-auth";
import { jsonOk } from "@/lib/api";
import { runProvisioningHelper } from "@/lib/provisioner/native-exec";

export async function GET() {
  try {
    await requireApiV1("plans:read");
    const r = await runProvisioningHelper("plan-list");
    return jsonOk({ plans: r.plans ?? [] });
  } catch (err) {
    return apiV1Error(err);
  }
}

export async function POST(request: Request) {
  try {
    const key = await requireApiV1("limits:write");
    if (key.resellerId) {
      return apiV1Error(
        Object.assign(new Error("Reseller keys cannot change global plans."), {
          status: 403,
        }),
      );
    }
    const body = (await request.json()) as {
      name?: string;
      disk?: string;
      bandwidth?: string;
      mailboxes?: string;
      databases?: string;
    };
    if (!body.name?.trim()) {
      return apiV1Error(Object.assign(new Error("name required"), { status: 400 }));
    }
    await runProvisioningHelper("plan-upsert", body.name.trim(), JSON.stringify(body));
    await auditLog(`api:${key.id}`, "api-v1-plan-upsert", undefined, body.name);
    return jsonOk({ ok: true });
  } catch (err) {
    return apiV1Error(err);
  }
}
