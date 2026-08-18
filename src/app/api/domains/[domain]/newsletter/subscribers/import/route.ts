import { auditLog } from "@/lib/audit";
import { handleApiError, jsonError, jsonOk } from "@/lib/api";
import { requireDomainApiNotAlias } from "@/lib/domain-api";
import { runProvisioningHelper } from "@/lib/provisioner/native-exec";

type Params = { params: Promise<{ domain: string }> };

function parseCsv(text: string): { email: string; name: string }[] {
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const rows: { email: string; name: string }[] = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (i === 0 && /^email/i.test(line)) continue;
    const parts = line.includes(";")
      ? line.split(";")
      : line.split(",").map((p) => p.replace(/^"|"$/g, "").trim());
    const email = (parts[0] ?? "").trim();
    const name = (parts[1] ?? "").trim();
    if (email) rows.push({ email, name });
  }
  return rows;
}

export async function POST(request: Request, { params }: Params) {
  try {
    const { session, domain } = await requireDomainApiNotAlias((await params).domain, "mail");
    const contentType = request.headers.get("content-type") ?? "";
    let rows: { email: string; name: string }[] = [];

    if (contentType.includes("application/json")) {
      const body = (await request.json()) as {
        rows?: { email?: string; name?: string }[];
        csv?: string;
      };
      if (body.csv) {
        rows = parseCsv(body.csv);
      } else if (Array.isArray(body.rows)) {
        rows = body.rows.map((r) => ({
          email: String(r.email ?? "").trim(),
          name: String(r.name ?? "").trim(),
        }));
      }
    } else {
      const csv = await request.text();
      rows = parseCsv(csv);
    }

    if (rows.length === 0) return jsonError("No valid rows to import.");
    if (rows.length > 5000) return jsonError("Maximum 5000 rows per import.");

    const raw = await runProvisioningHelper(
      "newsletter-subscribers-import",
      domain,
      JSON.stringify({ rows }),
    );
    await auditLog(
      session.username,
      "newsletter-subscribers-import",
      domain,
      String(raw.added),
    );
    return jsonOk({
      ok: true,
      added: raw.added,
      skipped: raw.skipped,
      total: raw.total,
    });
  } catch (err) {
    return handleApiError(err);
  }
}
