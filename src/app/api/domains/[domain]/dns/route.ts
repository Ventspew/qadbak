import { auditLog } from "@/lib/audit";
import { handleApiError, jsonError, jsonOk } from "@/lib/api";
import { requireDomainApiNotAlias } from "@/lib/domain-api";
import { beginJournal } from "@/lib/journal";
import { getProvisioner } from "@/lib/provisioner";
import {
  consumeLastJournalSteps,
  runWithJournalStore,
} from "@/lib/provisioner/native-exec";
import type { DnsRecord } from "@/lib/provisioner";

type Params = { params: Promise<{ domain: string }> };

export async function GET(_req: Request, { params }: Params) {
  try {
    const { session, domain } = await requireDomainApiNotAlias((await params).domain, "DNS");
    const result = await getProvisioner().getDns(domain, session);
    return jsonOk(result);
  } catch (err) {
    return handleApiError(err);
  }
}

export async function POST(request: Request, { params }: Params) {
  return runWithJournalStore(async () => {
    let journal: ReturnType<typeof beginJournal> | undefined;
    try {
      const { session, domain } = await requireDomainApiNotAlias((await params).domain, "DNS");
      const body = (await request.json()) as {
        name?: string;
        type?: string;
        value?: string;
        ttl?: string;
        priority?: string;
      };
      if (!body.name || !body.type || !body.value) {
        return jsonError("Name, type, and value are required.");
      }
      const record: DnsRecord = {
        name: body.name,
        type: body.type,
        value: body.value,
        ttl: body.ttl,
        priority: body.priority,
      };
      journal = beginJournal({
        action: "dns.record.add",
        summary: `Add DNS ${body.type} ${body.name} → ${body.value} (${domain})`,
        session,
        target: { domain },
        metadata: {
          recordType: body.type,
          recordName: body.name,
          ttl: body.ttl,
          priority: body.priority,
        },
      });
      consumeLastJournalSteps();
      journal.infoStep(`Validated DNS record (${body.type} ${body.name})`);
      await getProvisioner().addDnsRecord(domain, record, session);
      journal.captureFromHelper(consumeLastJournalSteps());
      journal.setUndoSpec({
        kind: "dns.record.add",
        payload: { domain, record: record as unknown as Record<string, unknown> },
        warning: `Removes the ${body.type} record "${body.name}" → "${body.value}" from ${domain}.`,
        ttlMinutes: 60,
      });
      await auditLog(session.username, "modify-dns", domain, body.name);
      const finished = await journal.finish(true);
      return jsonOk({ ok: true, journalId: finished.id });
    } catch (err) {
      if (journal) {
        journal.captureFromHelper(consumeLastJournalSteps());
        await journal.finish(false, err instanceof Error ? err.message : String(err));
      }
      return handleApiError(err);
    }
  });
}

export async function DELETE(request: Request, { params }: Params) {
  return runWithJournalStore(async () => {
    let journal: ReturnType<typeof beginJournal> | undefined;
    try {
      const { session, domain } = await requireDomainApiNotAlias((await params).domain, "DNS");
      const body = (await request.json()) as DnsRecord;
      if (!body.name || !body.type || !body.value) {
        return jsonError("Name, type, and value are required to delete a record.");
      }
      journal = beginJournal({
        action: "dns.record.delete",
        summary: `Delete DNS ${body.type} ${body.name} (${domain})`,
        session,
        target: { domain },
        metadata: {
          recordType: body.type,
          recordName: body.name,
          recordValue: body.value,
          ttl: body.ttl,
          priority: body.priority,
        },
      });
      consumeLastJournalSteps();
      journal.infoStep(`Validated DNS record for deletion (${body.type} ${body.name})`);
      await getProvisioner().deleteDnsRecord(domain, body, session);
      journal.captureFromHelper(consumeLastJournalSteps());
      journal.setUndoSpec({
        kind: "dns.record.delete",
        payload: { domain, record: body as unknown as Record<string, unknown> },
        warning: `Re-creates the ${body.type} record "${body.name}" → "${body.value}".`,
        ttlMinutes: 60,
      });
      await auditLog(session.username, "delete-dns", domain, body.name);
      const finished = await journal.finish(true);
      return jsonOk({ ok: true, journalId: finished.id });
    } catch (err) {
      if (journal) {
        journal.captureFromHelper(consumeLastJournalSteps());
        await journal.finish(false, err instanceof Error ? err.message : String(err));
      }
      return handleApiError(err);
    }
  });
}
