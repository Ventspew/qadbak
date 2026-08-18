import { auditLog } from "@/lib/audit";
import { handleApiError, jsonError, jsonOk } from "@/lib/api";
import { requireDomainApiNotAlias } from "@/lib/domain-api";
import { getProvisioner } from "@/lib/provisioner";
import { nativeFeatureEnabled } from "@/lib/provisioner/native-features";
import { isIndependentMode } from "@/lib/provisioner/native-stub";
import { runProvisioningHelper } from "@/lib/provisioner/native-exec";

type Params = { params: Promise<{ domain: string }> };

function nativeBackups(): boolean {
  return nativeFeatureEnabled("backup") || isIndependentMode();
}

export async function GET(_req: Request, { params }: Params) {
  try {
    const { session, domain } = await requireDomainApiNotAlias((await params).domain, "backups");
    const scheduled = await getProvisioner().listScheduledBackups(domain, session);
    return jsonOk({
      scheduled,
      canBackup: session.role === "admin",
      native: nativeBackups(),
    });
  } catch (err) {
    return handleApiError(err);
  }
}

export async function POST(_req: Request, { params }: Params) {
  try {
    const { session, domain } = await requireDomainApiNotAlias((await params).domain, "backups");
    if (session.role !== "admin") {
      return jsonError("Only administrators may start a backup.", 403);
    }
    const result = await getProvisioner().startBackup(domain, session);
    await auditLog(session.username, "backup-domain", domain);
    return jsonOk({ ok: true, result, native: nativeBackups() });
  } catch (err) {
    return handleApiError(err);
  }
}

export async function PATCH(request: Request, { params }: Params) {
  try {
    const { session, domain } = await requireDomainApiNotAlias((await params).domain, "backups");
    if (session.role !== "admin") {
      return jsonError("Only administrators may change backup schedules.", 403);
    }
    const body = (await request.json()) as {
      id?: string;
      enabled?: boolean;
      schedule?: string;
      retain?: number;
    };

    if (nativeBackups() && body.id === "schedule" && (body.schedule || body.retain)) {
      const retain = body.retain;
      if (retain !== undefined) {
        const n = Number(retain);
        if (!Number.isFinite(n) || n < 1 || n > 90) {
          return jsonError("retain must be between 1 and 90.");
        }
      }
      await runProvisioningHelper(
        "backup-schedule-set",
        domain,
        JSON.stringify({
          schedule: body.schedule,
          enabled: body.enabled,
          retain: body.retain,
        }),
      );
      await auditLog(session.username, "backup-schedule", domain);
      const scheduled = await getProvisioner().listScheduledBackups(domain, session);
      return jsonOk({ scheduled, native: true });
    }

    if (!body.id || body.enabled === undefined) {
      return jsonError("id and enabled are required.");
    }
    await getProvisioner().modifyScheduledBackup(
      domain,
      body.id,
      { enabled: body.enabled },
      session,
    );
    await auditLog(session.username, "modify-scheduled-backup", domain, body.id);
    const scheduled = await getProvisioner().listScheduledBackups(domain, session);
    return jsonOk({ scheduled, native: nativeBackups() });
  } catch (err) {
    return handleApiError(err);
  }
}

export async function DELETE(request: Request, { params }: Params) {
  try {
    const { session, domain } = await requireDomainApiNotAlias((await params).domain, "backups");
    if (session.role !== "admin") {
      return jsonError("Only administrators may delete backups.", 403);
    }
    if (!nativeBackups()) {
      return jsonError("Delete backup is only available in native backup mode.", 501);
    }
    const body = (await request.json()) as { name?: string };
    const name = body.name?.trim();
    if (!name || name.includes("/") || name.includes("..")) {
      return jsonError("Invalid backup name.");
    }
    await runProvisioningHelper("backup-delete", domain, name);
    await auditLog(session.username, "backup-delete", domain, body.name);
    const scheduled = await getProvisioner().listScheduledBackups(domain, session);
    return jsonOk({ scheduled, native: true });
  } catch (err) {
    return handleApiError(err);
  }
}
