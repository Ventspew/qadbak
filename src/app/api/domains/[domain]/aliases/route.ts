import { auditLog } from "@/lib/audit";
import { handleApiError, jsonError, jsonOk } from "@/lib/api";
import { requireDomainApiNotAlias } from "@/lib/domain-api";
import { beginJournal } from "@/lib/journal";
import { getProvisioner } from "@/lib/provisioner";
import {
  consumeLastJournalSteps,
  runWithJournalStore,
} from "@/lib/provisioner/native-exec";

type Params = { params: Promise<{ domain: string }> };

export async function GET(_req: Request, { params }: Params) {
  try {
    const { session, domain } = await requireDomainApiNotAlias((await params).domain, "aliases");
    const aliases = await getProvisioner().listAliases(domain, session);
    return jsonOk({ aliases });
  } catch (err) {
    return handleApiError(err);
  }
}

export async function POST(request: Request, { params }: Params) {
  return runWithJournalStore(async () => {
    let journal: ReturnType<typeof beginJournal> | undefined;
    try {
      const { session, domain } = await requireDomainApiNotAlias((await params).domain, "aliases");
      const body = (await request.json()) as { from?: string; to?: string };
      if (!body.from || !body.to) {
        return jsonError("From and to are required.");
      }
      journal = beginJournal({
        action: "alias.add",
        summary: `Add alias ${body.from}@${domain} → ${body.to}`,
        session,
        target: { domain, mailbox: body.from },
        metadata: { from: body.from, to: body.to },
      });
      consumeLastJournalSteps();
      journal.infoStep(`Validated alias from=${body.from} to=${body.to}`);
      await getProvisioner().createAlias(domain, body.from, body.to, session);
      journal.captureFromHelper(consumeLastJournalSteps());
      journal.setUndoSpec({
        kind: "alias.add",
        payload: { domain, from: body.from },
        warning: `Removes the alias ${body.from}@${domain}.`,
        ttlMinutes: 60,
      });
      await auditLog(session.username, "create-simple-alias", domain, body.from);
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
      const { session, domain } = await requireDomainApiNotAlias((await params).domain, "aliases");
      const body = (await request.json()) as { from?: string; to?: string };
      if (!body.from) return jsonError("Alias (from) is required.");
      // Capture the current target before delete so we can re-create on undo.
      let targetTo = body.to ?? "";
      if (!targetTo) {
        try {
          const aliases = await getProvisioner().listAliases(domain, session);
          const hit = aliases.find(
            (a) =>
              typeof a.from === "string" &&
              a.from.toLowerCase() === body.from!.toLowerCase(),
          );
          if (hit && typeof hit.to === "string") targetTo = hit.to;
        } catch {
          // best-effort - undo will simply be unavailable if we never knew the target
        }
      }
      journal = beginJournal({
        action: "alias.delete",
        summary: `Delete alias ${body.from}@${domain}`,
        session,
        target: { domain, mailbox: body.from },
        metadata: { from: body.from, capturedTo: targetTo || undefined },
      });
      consumeLastJournalSteps();
      journal.infoStep(`Validated alias deletion from=${body.from}`);
      await getProvisioner().deleteAlias(domain, body.from, session);
      journal.captureFromHelper(consumeLastJournalSteps());
      if (targetTo) {
        journal.setUndoSpec({
          kind: "alias.delete",
          payload: { domain, from: body.from, to: targetTo },
          warning: `Re-creates the alias ${body.from}@${domain} → ${targetTo}.`,
          ttlMinutes: 60,
        });
      } else {
        journal.warnStep(
          `Could not capture alias target - undo will be unavailable. Pass {to} in the request body next time.`,
        );
      }
      await auditLog(session.username, "delete-alias", domain, body.from);
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
