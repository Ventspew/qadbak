import { handleApiError, jsonOk } from "@/lib/api";
import { requireDomainApiNotAlias } from "@/lib/domain-api";
import { runProvisioningHelper } from "@/lib/provisioner/native-exec";

type Params = { params: Promise<{ domain: string }> };

export async function GET(_request: Request, { params }: Params) {
  try {
    await requireDomainApiNotAlias((await params).domain, "mail");
    const raw = await runProvisioningHelper("mail-dns-hints", (await params).domain);
    const hints = (raw.hints ?? raw) as Record<string, unknown>;
    return jsonOk({ hints });
  } catch (err) {
    return handleApiError(err);
  }
}
