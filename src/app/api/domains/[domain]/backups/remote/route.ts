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
      return jsonError("Only administrators may list remote backups.", 403);
    }
    if (!(await isPremiumFeatureEnabled("offsite-backup"))) {
      return jsonError("Offsite backups require Premium (offsite-backup feature).", 402);
    }
    const r = await runProvisioningHelper("backup-list-remote", domain);
    return jsonOk({
      remote: r.remote ?? [],
      bucket: r.bucket,
      prefix: r.prefix,
      reason: r.reason,
    });
  } catch (err) {
    return handleApiError(err);
  }
}

export async function POST(request: Request, { params }: Params) {
  try {
    const { session, domain } = await requireDomainApiNotAlias((await params).domain, "backups");
    if (session.role !== "admin") {
      return jsonError("Only administrators may import remote backups.", 403);
    }
    if (!(await isPremiumFeatureEnabled("offsite-backup"))) {
      return jsonError("Offsite backups require Premium (offsite-backup feature).", 402);
    }
    const body = (await request.json()) as {
      action?: string;
      remoteKey?: string;
      testRestore?: boolean;
    };
    if (!body.remoteKey?.trim()) return jsonError("remoteKey is required");
    const key = body.remoteKey.trim();
    if (
      key.includes("..") ||
      key.includes("/") ||
      !/^[\w.-]+\.tar\.gz$/.test(key)
    ) {
      return jsonError("Invalid remote backup key.");
    }
    if (body.action === "pull-restore") {
      const r = await runProvisioningHelper(
        "backup-pull-remote-restore",
        domain,
        key,
        body.testRestore ? "true" : "false",
      );
      await auditLog(session.username, "backup-pull-remote-restore", domain, key);
      return jsonOk({ ok: true, ...r });
    }
    const r = await runProvisioningHelper("backup-pull-remote", domain, key);
    await auditLog(session.username, "backup-pull-remote", domain, key);
    return jsonOk({ ok: true, file: r.file, ...r });
  } catch (err) {
    return handleApiError(err);
  }
}
