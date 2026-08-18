import { handleApiError, jsonError, jsonOk } from "@/lib/api";
import { runDomainTool } from "@/lib/panel-tools";
import { secretsEqual } from "@/lib/security-utils";
import { readFile } from "node:fs/promises";
import path from "node:path";

type Params = { params: Promise<{ domain: string }> };

export async function POST(request: Request, { params }: Params) {
  try {
    const domain = decodeURIComponent((await params).domain).toLowerCase();
    if (
      domain.includes("..") ||
      domain.includes("/") ||
      domain.includes("\\") ||
      !/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/i.test(
        domain,
      )
    ) {
      return jsonError("Invalid domain.", 400);
    }
    const secret = request.headers.get("x-qadbak-deploy-secret")?.trim();
    const cfgPath = path.join(
      process.cwd(),
      "data",
      "domain-config",
      domain,
      "git-deploy.json",
    );
    let expected = "";
    try {
      const raw = await readFile(cfgPath, "utf8");
      expected = JSON.parse(raw).webhookSecret ?? "";
    } catch {
      /* */
    }
    if (!expected || !secretsEqual(secret ?? "", expected)) {
      return jsonError("Invalid deploy secret.", 401);
    }
    const raw = await runDomainTool(domain, "git-deploy-run");
    return jsonOk(raw);
  } catch (err) {
    return handleApiError(err);
  }
}
