import { auditLog } from "@/lib/audit";
import { requireAdmin } from "@/lib/admin-api";
import { handleApiError, jsonError, jsonOk } from "@/lib/api";
import { beginJournal } from "@/lib/journal";
import { randomPanelPassword } from "@/lib/panel-password";
import {
  ensurePanelVhost,
  upsertPanelClient,
} from "@/lib/panel-client-admin";
import { PremiumRequiredError } from "@/lib/premium/types";
import { isPremiumFeatureEnabled } from "@/lib/premium/server";
import { requireSession } from "@/lib/session";
import { PanelError } from "@/lib/errors";
import { getProvisioner } from "@/lib/provisioner";
import {
  consumeLastJournalSteps,
  runProvisioningHelper,
  runWithJournalStore,
} from "@/lib/provisioner/native-exec";
import { isIndependentMode } from "@/lib/provisioner/native-stub";

export async function GET() {
  try {
    const session = await requireSession();
    const domains = await getProvisioner().listDomains(session);
    await auditLog(session.username, "list-domains");
    return jsonOk({ domains });
  } catch (err) {
    return handleApiError(err);
  }
}

export async function POST(request: Request) {
  try {
    return await runWithJournalStore(async () => doCreateDomain(request));
  } catch (err) {
    return handleApiError(err);
  }
}

async function doCreateDomain(request: Request) {
  let journal: ReturnType<typeof beginJournal> | undefined;
  try {
    const session = await requireAdmin();
    const body = (await request.json()) as {
      domain?: string;
      pass?: string;
      user?: string;
      plan?: string;
      parent?: string;
      type?: "top" | "sub" | "alias";
      createClientAccount?: boolean;
      createPanelVhost?: boolean;
    };
    if (!body.domain) {
      return jsonError("Domain name is required.");
    }
    const domainName = body.domain.trim().toLowerCase();
    const providedPass = body.pass?.trim() ?? "";
    const unixPass = providedPass || randomPanelPassword();
    const unixPassGenerated = !providedPass;

    journal = beginJournal({
      action: "domain.create",
      summary: `Create domain ${domainName}`,
      session,
      target: { domain: domainName },
      undoable: false,
      metadata: {
        type: body.type ?? "top",
        plan: body.plan ?? "Default",
        parent: body.parent ?? undefined,
        createClientAccount: body.createClientAccount !== false,
        createPanelVhost: Boolean(body.createPanelVhost),
        unixUserProvided: Boolean(body.user),
        passwordGenerated: unixPassGenerated,
      },
    });
    consumeLastJournalSteps(); // discard any leftover from earlier requests
    journal.infoStep(`Validated input - domain="${domainName}", type=${body.type ?? "top"}`);

    try {
      await getProvisioner().createDomain(
        {
          domain: domainName,
          pass: unixPass,
          user: body.user,
          plan: body.plan,
          parent: body.parent,
          type: body.type,
          alias: body.type === "alias",
          subdom: body.type === "sub",
        },
        session,
      );
      journal.captureFromHelper(consumeLastJournalSteps());
    } catch (err) {
      journal.captureFromHelper(consumeLastJournalSteps());
      if (
        err instanceof PanelError &&
        /already exists|already been created|already in use/i.test(err.message)
      ) {
        const existing = await getProvisioner().findDomainByName(domainName, session);
        if (existing) {
          journal.warnStep(
            `Domain already existed on this server - treating as success.`,
          );
          await journal.finish(true);
          return jsonOk({
            ok: true,
            domain: existing.name,
            note: "Domain already existed on this server.",
            journalId: journal.id,
          });
        }
      }
      throw err;
    }

    let created: Awaited<
      ReturnType<ReturnType<typeof getProvisioner>["findDomainByName"]>
    > | undefined;
    for (let attempt = 0; attempt < 10; attempt++) {
      created = await getProvisioner().findDomainByName(domainName, session);
      if (created) break;
      await new Promise((r) => setTimeout(r, 1500));
    }

    if (!created) {
      const listed = await getProvisioner().listDomains(session).catch(() => []);
      const known = listed.some((d) => d.name.toLowerCase() === domainName);
      if (known) {
        return jsonOk({ ok: true, domain: domainName });
      }
      const hint =
        listed.length === 0
          ? isIndependentMode()
            ? "Qadbak cannot read domains (check data/native-domains.json and pm2 env). Run: cd /opt/qadbak && git pull && sudo bash scripts/pm2-restart-qadbak.sh "
            : "Qadbak cannot read domains (pm2 may not load .env.local). Run: cd /opt/qadbak && git pull && sudo bash scripts/pm2-restart-qadbak.sh && npm run test-api. "
          : `This server has ${listed.length} domain(s) but not "${domainName}". `;
      return jsonError(
        hint +
          "If the domain already exists, open Domains in the menu instead of creating it again.",
        502,
      );
    }

    await auditLog(session.username, "create-domain", domainName);
    journal.infoStep(`Domain '${domainName}' visible in registry after lookup retry.`);

    // Premium client provisioning (multi-tenant-clients) and per-tenant
    // panel.<domain> vhost (panel-client-vhost) are independent license
    // features; either may be missing. Each branch tries the real
    // helper and falls back to a `premiumNote` if the gate fires.
    let premiumNote: string | undefined;
    let clientUsername: string | undefined;
    let clientPassword: string | undefined;
    let panelUrl: string | undefined;
    const wantClient =
      body.type !== "sub" &&
      body.type !== "alias" &&
      body.createClientAccount !== false;
    if (wantClient) {
      if (
        !(await isPremiumFeatureEnabled("panel-client-vhost")) ||
        !(await isPremiumFeatureEnabled("multi-tenant-clients"))
      ) {
        premiumNote =
          "Client account not created - Qadbak Premium license required (Server admin → License).";
      } else {
        try {
          const upsert = await upsertPanelClient({
            domain: domainName,
            username: body.user,
          });
          clientUsername = upsert.username;
          clientPassword = upsert.password;
          journal.infoStep(
            `Provisioned panel client '${upsert.username}' for ${domainName}.`,
          );
        } catch (err) {
          if (err instanceof PremiumRequiredError) {
            premiumNote = `Client account not created - Premium feature missing: ${err.feature}.`;
          } else {
            journal.warnStep(
              `Panel client provisioning failed: ${err instanceof Error ? err.message : String(err)}`,
            );
            premiumNote =
              "Panel client provisioning failed - see action journal.";
          }
        }
      }
    }

    if (body.createPanelVhost && body.type !== "alias") {
      if (!(await isPremiumFeatureEnabled("panel-client-vhost"))) {
        premiumNote =
          (premiumNote ? premiumNote + " " : "") +
          "Panel vhost not applied - panel-client-vhost feature not licensed.";
      } else {
        try {
          await ensurePanelVhost(domainName);
          journal.infoStep(`Applied panel.${domainName} nginx vhost.`);
          panelUrl = `http://panel.${domainName}/login`;
        } catch (err) {
          if (err instanceof PremiumRequiredError) {
            premiumNote =
              (premiumNote ? premiumNote + " " : "") +
              `Panel vhost not applied - Premium feature missing: ${err.feature}.`;
          } else {
            journal.warnStep(
              `Panel vhost apply failed: ${err instanceof Error ? err.message : String(err)}`,
            );
            premiumNote =
              (premiumNote ? premiumNote + " " : "") +
              "Panel vhost apply failed - see action journal.";
          }
        }
      }
    }

    const hostingNote =
      "Website vhost is in place. After DNS points here, use Overview → Repair for SSL.";

    try {
      await runProvisioningHelper(
        "backup-schedule-ensure",
        domainName,
        JSON.stringify({ forceEnable: true, runIfStale: true }),
      );
      journal.infoStep(`Automatic backup schedule ensured for ${domainName}.`);
    } catch (err) {
      journal.warnStep(
        `Backup schedule ensure failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }

    const originIp =
      process.env.QADBAK_ORIGIN_IP?.trim() ||
      process.env.QADBAK_SERVER_IP?.trim() ||
      "";
    const dnsNote = originIp
      ? `Point @ and www A records to ${originIp}, or set nameservers to ns1.${domainName} if DNS is hosted on this VPS. Until DNS is live, the public URL check stays pending while the site works on the server.`
      : `Configure DNS at your registrar so ${domainName} points to this VPS (set QADBAK_ORIGIN_IP in .env.local).`;

    if (premiumNote) {
      journal.warnStep(`Premium note: ${premiumNote}`);
    }

    const finished = await journal.finish(true);

    return jsonOk({
      ok: true,
      domain: created.name,
      hostingNote,
      dnsNote,
      premiumNote,
      unixPassword: unixPassGenerated ? unixPass : undefined,
      clientUsername,
      clientPassword,
      panelUrl,
      journalId: finished.id,
    });
  } catch (err) {
    if (journal) {
      try {
        journal.captureFromHelper(consumeLastJournalSteps());
        await journal.finish(false, err instanceof Error ? err.message : String(err));
      } catch {
        /* never fail the API with a journal write */
      }
    }
    return handleApiError(err);
  }
}
