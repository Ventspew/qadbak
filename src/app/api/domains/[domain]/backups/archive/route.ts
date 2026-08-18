import { auditLog } from "@/lib/audit";
import { handleApiError, jsonError, jsonOk } from "@/lib/api";
import { requireDomainApiNotAlias } from "@/lib/domain-api";
import { runProvisioningHelper } from "@/lib/provisioner/native-exec";

type Params = { params: Promise<{ domain: string }> };

export async function GET(request: Request, { params }: Params) {
  try {
    const { session, domain } = await requireDomainApiNotAlias((await params).domain, "backups");
    const url = new URL(request.url);
    const name = url.searchParams.get("name")?.trim();
    let prefix = url.searchParams.get("prefix")?.trim() ?? "";
    if (!name) return jsonError("name query param required");
    if (session.role !== "admin") {
      prefix = prefix || "public_html";
      const norm = prefix.replace(/^\/+/, "");
      if (!norm.startsWith("public_html")) {
        return jsonError("Clients may only browse public_html/ in backups.", 403);
      }
    }
    const r = await runProvisioningHelper(
      "backup-archive-list",
      domain,
      name,
      prefix,
    );
    return jsonOk({
      archive: r.archive,
      prefix: r.prefix,
      entries: r.entries ?? [],
    });
  } catch (err) {
    return handleApiError(err);
  }
}

export async function POST(request: Request, { params }: Params) {
  try {
    const { session, domain } = await requireDomainApiNotAlias((await params).domain, "backups");
    const body = (await request.json()) as {
      action?: string;
      name?: string;
      path?: string;
      database?: string;
    };
    if (!body.name?.trim()) return jsonError("name is required");
    if (body.action === "restore-file") {
      if (!body.path?.trim()) return jsonError("path is required");
      if (
        session.role !== "admin" &&
        !body.path.startsWith("public_html/")
      ) {
        return jsonError("Clients may only restore under public_html/", 403);
      }
      const r = await runProvisioningHelper(
        "backup-restore-file",
        domain,
        body.name.trim(),
        body.path.trim(),
      );
      await auditLog(session.username, "backup-restore-file", domain, body.path);
      return jsonOk({ ok: true, restored: r.restored });
    }
    if (body.action === "restore-database") {
      if (session.role !== "admin") {
        return jsonError("Only administrators may restore databases.", 403);
      }
      if (!body.database?.trim()) return jsonError("database is required");
      const r = await runProvisioningHelper(
        "backup-restore-database",
        domain,
        body.name.trim(),
        body.database.trim(),
      );
      await auditLog(session.username, "backup-restore-database", domain, body.database);
      return jsonOk({ ok: true, database: r.database });
    }
    return jsonError("Unknown action.");
  } catch (err) {
    return handleApiError(err);
  }
}
