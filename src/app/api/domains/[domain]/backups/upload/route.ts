import { createWriteStream } from "node:fs";
import { stat, unlink } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import path from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";

import { auditLog } from "@/lib/audit";
import { handleApiError, jsonError, jsonOk } from "@/lib/api";
import { requireDomainApiNotAlias } from "@/lib/domain-api";
import { demoMutationBlocked } from "@/middleware/demo-readonly";
import { getProvisioner } from "@/lib/provisioner";
import { nativeFeatureEnabled } from "@/lib/provisioner/native-features";
import { isIndependentMode } from "@/lib/provisioner/native-stub";
import { runProvisioningHelper } from "@/lib/provisioner/native-exec";
import { getMaxUploadBytes } from "@/lib/upload-limits-server";
import { exceedsUploadLimit, formatUploadLimit } from "@/lib/upload-limits";
import { asUploadFile, readUploadFormData } from "@/lib/upload-request";

type Params = { params: Promise<{ domain: string }> };

export const maxDuration = 3600;
export const dynamic = "force-dynamic";

function nativeBackups(): boolean {
  return nativeFeatureEnabled("backup") || isIndependentMode();
}

async function streamFileToTemp(file: File): Promise<{ tempPath: string; size: number }> {
  const tempPath = path.join(tmpdir(), `qadbak-upload-${randomUUID()}`);
  const webStream = file.stream();
  const nodeStream = Readable.fromWeb(webStream as import("stream/web").ReadableStream);
  await pipeline(nodeStream, createWriteStream(tempPath));
  const st = await stat(tempPath);
  return { tempPath, size: st.size };
}

export async function POST(request: Request, { params }: Params) {
  let tempPath: string | null = null;
  try {
    const { session, domain } = await requireDomainApiNotAlias((await params).domain, "backups");
    if (
      demoMutationBlocked(
        `/api/domains/${domain}/backups/upload`,
        "POST",
        session.username,
      )
    ) {
      return jsonError("Demo is read-only.", 403);
    }
    if (session.role !== "admin") {
      return jsonError("Only administrators may upload backups.", 403);
    }
    if (!nativeBackups()) {
      return jsonError("Backup upload requires native backup mode.", 501);
    }

    const maxBytes = await getMaxUploadBytes();
    const limitLabel = formatUploadLimit(maxBytes);
    const form = await readUploadFormData(request);
    const file = asUploadFile(form.get("file") ?? "");
    if (!file) {
      return jsonError("No backup file received. Use form field \"file\".");
    }
    if (!file.name.toLowerCase().endsWith(".tar.gz")) {
      return jsonError("Backup must be a .tar.gz archive.");
    }
    if (exceedsUploadLimit(file.size, maxBytes)) {
      return jsonError(`Backup is larger than ${limitLabel}.`);
    }

    const destName = String(form.get("name") ?? "").trim();
    const { tempPath: tmp, size } = await streamFileToTemp(file);
    tempPath = tmp;
    if (exceedsUploadLimit(size, maxBytes)) {
      return jsonError(`Backup is larger than ${limitLabel}.`);
    }

    const result = await runProvisioningHelper(
      "backup-upload",
      domain,
      tempPath,
      destName || file.name.replace(/[/\\]/g, "").trim(),
    );
    await unlink(tempPath).catch(() => {});
    tempPath = null;

    await auditLog(
      session.username,
      "backup-upload",
      domain,
      String(result.file ?? (destName || file.name)),
    );

    const scheduled = await getProvisioner().listScheduledBackups(domain, session);

    return jsonOk({
      ok: true,
      result,
      scheduled,
      native: true,
    });
  } catch (err) {
    return handleApiError(err);
  } finally {
    if (tempPath) await unlink(tempPath).catch(() => {});
  }
}
