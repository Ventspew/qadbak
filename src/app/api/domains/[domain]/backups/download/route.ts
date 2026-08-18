import { spawn } from "node:child_process";
import { Readable } from "node:stream";
import { auditLog } from "@/lib/audit";
import { handleApiError, jsonError } from "@/lib/api";
import { requireDomainApiNotAlias } from "@/lib/domain-api";
import { BACKUP_DOWNLOAD_WRAPPER, runProvisioningHelper } from "@/lib/provisioner/native-exec";
import { nativeFeatureEnabled } from "@/lib/provisioner/native-features";
import { isIndependentMode } from "@/lib/provisioner/native-stub";

type Params = { params: Promise<{ domain: string }> };

export const maxDuration = 3600;
export const dynamic = "force-dynamic";

function nativeBackups(): boolean {
  return nativeFeatureEnabled("backup") || isIndependentMode();
}

export async function GET(request: Request, { params }: Params) {
  try {
    const { session, domain } = await requireDomainApiNotAlias((await params).domain, "backups");
    if (!nativeBackups()) {
      return jsonError("Backup download requires native backup mode.", 501);
    }
    const name = new URL(request.url).searchParams.get("name")?.trim();
    if (!name || name.includes("/") || name.includes("..")) {
      return jsonError("Invalid backup name.");
    }

    const resolved = await runProvisioningHelper("backup-resolve", domain, name);
    const fileName = String(resolved.fileName ?? name);
    const sizeBytes = Number(resolved.sizeBytes ?? 0);
    if (!resolved.path) return jsonError("Could not resolve backup file.", 404);

    await auditLog(session.username, "backup-download", domain, fileName);

    const child = spawn("sudo", ["-n", BACKUP_DOWNLOAD_WRAPPER, domain, name], {
      stdio: ["ignore", "pipe", "pipe"],
    });
    if (!child.stdout) return jsonError("Could not open backup file.", 500);

    let stderr = "";
    child.stderr?.on("data", (chunk: Buffer) => {
      stderr = (stderr + chunk.toString()).slice(-2000);
    });

    const exitPromise = new Promise<number | null>((resolve) => {
      child.on("close", (code) => resolve(code));
      child.on("error", () => resolve(-1));
    });

    const web = Readable.toWeb(child.stdout) as ReadableStream<Uint8Array>;
    const headers: Record<string, string> = {
      "Content-Type": "application/gzip",
      "Content-Disposition": `attachment; filename="${fileName.replace(/"/g, "")}"`,
      "Cache-Control": "no-store",
    };
    if (sizeBytes > 0) headers["Content-Length"] = String(sizeBytes);

    const body = new ReadableStream<Uint8Array>({
      async start(controller) {
        const reader = web.getReader();
        try {
          for (;;) {
            const { done, value } = await reader.read();
            if (done) break;
            if (value?.length) controller.enqueue(value);
          }
          const code = await exitPromise;
          if (code !== 0 && code !== null) {
            controller.error(
              new Error(stderr.trim() || `Backup download failed (exit ${code})`),
            );
            return;
          }
          controller.close();
        } catch (err) {
          controller.error(err);
        } finally {
          reader.releaseLock();
        }
      },
    });

    return new Response(body, { headers });
  } catch (err) {
    return handleApiError(err);
  }
}
