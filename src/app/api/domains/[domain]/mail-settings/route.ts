import { auditLog } from "@/lib/audit";
import { handleApiError, jsonOk } from "@/lib/api";
import { requireDomainApiNotAlias } from "@/lib/domain-api";
import { getProvisioner } from "@/lib/provisioner";

type Params = { params: Promise<{ domain: string }> };

export async function GET(_req: Request, { params }: Params) {
  try {
    const { session, domain } = await requireDomainApiNotAlias((await params).domain, "mail");
    const settings = await getProvisioner().getMailSettings(domain, session);
    return jsonOk({ settings });
  } catch (err) {
    return handleApiError(err);
  }
}

export async function POST(request: Request, { params }: Params) {
  try {
    const { session, domain } = await requireDomainApiNotAlias((await params).domain, "mail");
    const body = (await request.json()) as {
      catchAll?: string;
      autoresponder?: string;
      autoresponderEnabled?: boolean;
    };
    await getProvisioner().updateMailSettings(domain, body, session);
    await auditLog(session.username, "modify-mail", domain);
    return jsonOk({ ok: true });
  } catch (err) {
    return handleApiError(err);
  }
}
