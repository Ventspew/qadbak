import { requireAdmin } from "@/lib/admin-api";
import { handleApiError, jsonError, jsonOk } from "@/lib/api";
import { readInstallJob } from "@/lib/apps/background-job";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** GET /api/admin/apps/install-status?id= */
export async function GET(request: Request) {
  try {
    await requireAdmin();
    const id = new URL(request.url).searchParams.get("id")?.trim() || "";
    if (!id || !/^[a-f0-9-]{8,}$/i.test(id)) {
      return jsonError("job id is required.", 400);
    }
    const job = await readInstallJob(id);
    if (!job) return jsonError("Install job not found.", 404);
    return jsonOk({ job });
  } catch (err) {
    return handleApiError(err);
  }
}
