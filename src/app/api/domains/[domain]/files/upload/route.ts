import { createWriteStream } from "node:fs";
import { stat, unlink } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import path from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";

import { auditLog } from "@/lib/audit";
import { handleApiError, jsonError, jsonOk } from "@/lib/api";
import { isPanelFilesMode, normalizeDir, uploadDomainFile } from "@/lib/domain-files";
import {
  liveFilesEnabled,
  uploadDomainFileFromTempLive,
} from "@/lib/domain-files-service";
import { requireDomainApi } from "@/lib/domain-api";
import { demoMutationBlocked } from "@/middleware/demo-readonly";
import { PanelError } from "@/lib/errors";
import { getMaxUploadBytes } from "@/lib/upload-limits-server";
import { exceedsUploadLimit, formatUploadLimit } from "@/lib/upload-limits";
import { asUploadFile, readUploadFormData } from "@/lib/upload-request";

type Params = { params: Promise<{ domain: string }> };

export const maxDuration = 3600;
export const dynamic = "force-dynamic";

async function streamFileToTemp(file: File): Promise<{ tempPath: string; size: number }> {
  const tempPath = path.join(tmpdir(), `qadbak-upload-${randomUUID()}`);
  const webStream = file.stream();
  const nodeStream = Readable.fromWeb(webStream as import("stream/web").ReadableStream);
  await pipeline(nodeStream, createWriteStream(tempPath));
  const st = await stat(tempPath);
  return { tempPath, size: st.size };
}

export async function POST(request: Request, { params }: Params) {
  let tempPaths: string[] = [];
  try {
    const { session, domain } = await requireDomainApi((await params).domain);
    if (
      demoMutationBlocked(
        `/api/domains/${domain}/files/upload`,
        "POST",
        session.username,
      )
    ) {
      return jsonError("Demo is read-only.", 403);
    }
    const live = liveFilesEnabled();
    if (!isPanelFilesMode() && !live) {
      return jsonError("Upload requires native file access on the server.", 501);
    }

    const maxBytes = await getMaxUploadBytes();
    const limitLabel = formatUploadLimit(maxBytes);

    const form = await readUploadFormData(request);
    const dir = String(form.get("dir") ?? "");
    const overwrite = form.get("overwrite") !== "false";
    const parentNorm = normalizeDir(dir);
    const files = form.getAll("files");
    if (files.length === 0) return jsonError("No files received.");

    const uploaded: string[] = [];
    for (const item of files) {
      const file = asUploadFile(item);
      if (!file) continue;

      const safe = file.name.replace(/[/\\]/g, "").trim();
      if (!safe) throw new PanelError("Invalid file name.");
      const rel = parentNorm ? `${parentNorm}/${safe}` : safe;

      if (exceedsUploadLimit(file.size, maxBytes)) {
        return jsonError(`File ${file.name} is larger than ${limitLabel}.`);
      }

      if (live) {
        const { tempPath, size } = await streamFileToTemp(file);
        tempPaths.push(tempPath);
        if (exceedsUploadLimit(size, maxBytes)) {
          return jsonError(`File ${file.name} is larger than ${limitLabel}.`);
        }
        await uploadDomainFileFromTempLive(domain, rel, tempPath, maxBytes, session, {
          overwrite,
          fileBytes: size,
        });
        tempPaths = tempPaths.filter((p) => p !== tempPath);
        await unlink(tempPath).catch(() => {});
      } else {
        const bytes = new Uint8Array(await file.arrayBuffer());
        if (exceedsUploadLimit(bytes.byteLength, maxBytes)) {
          return jsonError(`File ${file.name} is larger than ${limitLabel}.`);
        }
        uploadDomainFile(dir, file.name, bytes, { overwrite });
      }

      uploaded.push(rel);
      await auditLog(session.username, "upload-file", domain, rel);
    }

    if (uploaded.length === 0) return jsonError("No valid files received.");
    return jsonOk({ uploaded, maxBytes });
  } catch (err) {
    return handleApiError(err);
  } finally {
    await Promise.all(tempPaths.map((p) => unlink(p).catch(() => {})));
  }
}
