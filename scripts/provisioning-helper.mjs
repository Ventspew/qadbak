#!/usr/bin/env node
/**
 * Native provisioning (phase 8) — SSL, DNS, mail, DB, domain, backup, cron without remote.cgi.
 */
import { emit } from "./lib/provisioning-common.mjs";
import { loadEnvLocal } from "./lib/load-env-local.mjs";
import { assertProvisioningCommand } from "./lib/provisioning-helper-allowlist.mjs";
import { sslList, sslIssue } from "./lib/provision-ssl.mjs";
import { dnsGet, dnsAdd, dnsDel } from "./lib/provision-dns.mjs";
import {
  mailList,
  mailCreate,
  mailDelete,
  mailPass,
  mailSend,
  mailDraftSave,
  mailSync,
  mailDiagnoseDomain,
  mailReceiveTestDomain,
  mailDnsHintsDomain,
} from "./lib/provision-mail.mjs";
import { dbList, dbCreate, dbPass } from "./lib/provision-db.mjs";
import { domainCreate, domainDelete } from "./lib/provision-domain.mjs";
import { domainWebsiteRepair } from "./lib/provision-repair.mjs";
import {
  backupList,
  backupCreate,
  backupDelete,
  backupUpload,
  backupResolveDownload,
  backupRestore,
  backupScheduleGet,
  backupScheduleSet,
  backupScheduleToggle,
  ensureBackupSchedule,
  backupScheduleEnsureAll,
  backupListRemote,
  backupPullRemote,
  backupPullRemoteAndRestore,
  backupPolicyGet,
  backupPolicySet,
  backupArchiveList,
  backupRestoreFile,
  backupRestoreDatabase,
} from "./lib/provision-backup.mjs";
import {
  firewallStatus,
  firewallAllow,
  firewallDeny,
  fail2banStatus,
} from "./lib/provision-firewall.mjs";
import { malwareScanDomain } from "./lib/provision-malware.mjs";
import {
  modsecurityStatus,
  modsecurityToggle,
  modsecurityLogs,
  modsecurityCrsCheck,
} from "./lib/provision-modsecurity.mjs";
import {
  planGet,
  planApplyToDomain,
  planUpsert,
} from "./lib/provision-plans.mjs";
import {
  malwareStatus,
  malwareScheduleSet,
  malwareListQuarantine,
} from "./lib/provision-malware.mjs";
import { metricsSnapshot } from "./lib/metrics-collector.mjs";
import { cronList, cronCreate, cronDelete } from "./lib/provision-cron.mjs";
import { aliasList, aliasCreate, aliasDelete } from "./lib/provision-aliases.mjs";
import { redirectList, redirectCreate, redirectDelete } from "./lib/provision-redirects.mjs";
import { featureList, featureSet } from "./lib/provision-features.mjs";
import { logsTail } from "./lib/provision-logs.mjs";
import {
  phpVersions,
  phpDirectories,
  phpIni,
  phpSetDirectory,
  phpModifyIni,
  phpDeleteDirectory,
} from "./lib/provision-php.mjs";
import { ftpList, ftpCreate, ftpDelete, ftpPass } from "./lib/provision-ftp.mjs";
import { limitsGet, limitsSet } from "./lib/provision-limits.mjs";
import {
  domainEnable,
  domainDisable,
  domainValidate,
  domainClone,
  domainMigrate,
  domainTransfer,
} from "./lib/provision-lifecycle.mjs";
import {
  adminLicenseGet,
  adminTemplatesList,
  adminAdminsList,
  adminAdminsCreate,
  adminAdminsDelete,
  adminGlobalFeaturesList,
  adminGlobalFeatureSet,
  adminConfigSystem,
  adminCheckConfig,
  adminS3ListBuckets,
  adminS3ListFiles,
  adminS3Upload,
  adminServerStatus,
} from "./lib/provision-admin.mjs";
import { mailSettingsGet, mailSettingsSet } from "./lib/provision-mail-settings.mjs";
import { mailLogsSearch } from "./lib/provision-mail-logs.mjs";
import { imapList, imapCopy, imapMessages, imapFetch } from "./lib/provision-imap.mjs";
import {
  protectedList,
  protectedCreate,
  protectedDelete,
  protectedUsersList,
  protectedUserCreate,
  protectedUserDelete,
} from "./lib/provision-protected.mjs";
import {
  sharedList,
  sharedCreate,
  sharedDelete,
} from "./lib/provision-shared.mjs";
import { proxyList, proxyCreate, proxyDelete } from "./lib/provision-proxies.mjs";
import {
  scriptAvailable,
  scriptList,
  scriptInstall,
  scriptRollbackCmd,
  scriptDelete,
} from "./lib/provision-scripts.mjs";
import {
  runtimesGet,
  runtimesNodeInstall,
  runtimesPythonInstall,
  runtimesDockerInstall,
  runtimesDockerAction,
} from "./lib/provision-runtimes.mjs";
import {
  cloudCredentialsList,
  cloudCredentialsSave,
} from "./lib/cloud-credentials.mjs";
import { appInstallWordpress } from "./lib/provision-app-wordpress.mjs";
import { jellyfinInstall, jellyfinListVideos, jellyfinSetMediaPath, jellyfinStatus, jellyfinStreamResolve } from "./lib/provision-jellyfin.mjs";
import {
  securityGet,
  securitySetSpam,
  securitySetDkim,
} from "./lib/provision-security.mjs";
import {
  resellerList,
  resellerCreate,
  resellerDelete,
  planList,
  planCreate,
  planDelete,
} from "./lib/provision-resellers.mjs";
import {
  deliverabilityDashboard,
  bounceSuppressList,
  bounceSuppressAdd,
  newsletterGdprExport,
  newsletterTemplatesList,
  newsletterTemplateSave,
  newsletterSegmentsList,
  newsletterSegmentSave,
  analyticsHistory,
  gitDeployLogGet,
  gitDeployRollback,
  wpToolkitPlugins,
  wpToolkitSecurity,
  wpToolkitBackup,
  maintenanceNginx,
  contactFormEmbed,
  stagingPromote,
  stagingVhost,
  bandwidthTraffic,
  memcachedGet,
  memcachedSet,
  mongoCreate,
  awstatsRun,
  subdomainAdd,
  seo404Scan,
  woocommerceStatus,
  ciPipelineGet,
  ciPipelineSet,
  ciPipelineRun,
  ticketNotify,
  invoiceMarkSent,
  carddavExportVcf,
  nodesPingHealth,
  panelPolicyGet,
  panelPolicySet,
  mailboxAutoreplyApply,
} from "./lib/provision-panel-complete.mjs";
import {
  systemCronList,
  systemAwstatsSummary,
  domainHealthBatch,
  systemNetworkSummary,
  nodesRemoteProvision,
} from "./lib/provision-admin-native.mjs";
import {
  invoicePdfGenerate,
  invoicePaymentLink,
  mailboxQuotaSet,
  mailboxQuotasGet,
} from "./lib/provision-billing.mjs";
import {
  dmarcGet,
  dmarcSet,
  mailboxAutoreplyList,
  mailboxAutoreplySet,
  mailBouncesList,
  newsletterStatsGet,
  newsletterTrackRecord,
} from "./lib/provision-panel-phase1.mjs";
import {
  analyticsSummary,
  gitDeployGet,
  gitDeploySet,
  gitDeployRun,
  wpToolkitStatus,
  wpToolkitUpdate,
  maintenanceGet,
  maintenanceSet,
  contactFormGet,
  contactFormSet,
  contactFormSubmit,
} from "./lib/provision-panel-phase2.mjs";
import {
  stagingGet,
  stagingSync,
  bandwidthUsage,
  redisGet,
  redisSet,
  sshKeysList,
  sshKeysAdd,
  sshKeysDelete,
  awstatsConfig,
} from "./lib/provision-panel-phase3.mjs";
import {
  ticketsList,
  ticketsCreate,
  ticketsReply,
  billingInvoicesList,
  billingInvoiceCreate,
  nodesHealth,
  nodesRegister,
  carddavStatus,
  carddavContactUpsert,
} from "./lib/provision-panel-phase4.mjs";
import {
  newsletterGet,
  newsletterSet,
  newsletterSubscribersList,
  newsletterSubscriberUpsert,
  newsletterSubscriberDelete,
  newsletterSubscribersImport,
  newsletterCampaignsList,
  newsletterCampaignUpsert,
  newsletterCampaignDelete,
  newsletterCampaignQueue,
  newsletterSendBatch,
  newsletterCampaignTest,
  newsletterPublicSubscribe,
  newsletterPublicConfirm,
  newsletterPublicUnsubscribe,
} from "./lib/provision-newsletter.mjs";

const cmd = process.argv[2];
const args = process.argv.slice(3);

function parseJsonArg(i) {
  try {
    return JSON.parse(args[i] ?? "{}");
  } catch {
    return {};
  }
}

async function main() {
  await loadEnvLocal();
  assertProvisioningCommand(cmd);
  switch (cmd) {
    case "ping":
      emit({ ok: true, helper: "provisioning-helper", phase: 8 });
      break;
    case "ssl-list":
      await sslList(args[0]);
      break;
    case "ssl-issue":
      await sslIssue(args[0], args[1]);
      break;
    case "dns-get":
      await dnsGet(args[0]);
      break;
    case "dns-add":
      await dnsAdd(args[0], parseJsonArg(1));
      break;
    case "dns-del":
      await dnsDel(args[0], parseJsonArg(1));
      break;
    case "mail-list":
      await mailList(args[0]);
      break;
    case "mail-create":
      await mailCreate(args[0], args[1], args[2], args[3]);
      break;
    case "mail-delete":
      await mailDelete(args[0], args[1]);
      break;
    case "mail-pass":
      await mailPass(args[0], args[1], args[2]);
      break;
    case "mail-send":
      await mailSend(args[0], args[1], args.length > 2 ? args.slice(2).join(" ") : "{}");
      break;
    case "mail-draft-save":
      await mailDraftSave(args[0], args[1], args.length > 2 ? args.slice(2).join(" ") : "{}");
      break;
    case "mail-sync":
      await mailSync();
      break;
    case "mail-diagnose":
      await mailDiagnoseDomain(args[0], args[1]);
      break;
    case "mail-receive-test":
      await mailReceiveTestDomain(args[0], args[1]);
      break;
    case "mail-dns-hints":
      await mailDnsHintsDomain(args[0]);
      break;
    case "db-list":
      await dbList(args[0]);
      break;
    case "db-create":
      await dbCreate(args[0], args[1], args[2], args[3]);
      break;
    case "db-pass":
      await dbPass(args[0], args[1], args[2], args[3]);
      break;
    case "domain-create":
      await domainCreate(args[0], args[1], args[2], args[3]);
      break;
    case "domain-delete":
      await domainDelete(args[0]);
      break;
    case "domain-website-repair":
      await domainWebsiteRepair(args[0]);
      break;
    case "backup-list":
      await backupList(args[0]);
      break;
    case "backup-create":
      await backupCreate(args[0], args[1]);
      break;
    case "backup-delete":
      await backupDelete(args[0], args[1]);
      break;
    case "backup-upload":
      await backupUpload(args[0], args[1], args[2]);
      break;
    case "backup-resolve":
      await backupResolveDownload(args[0], args[1]);
      break;
    case "backup-restore":
      await backupRestore(args[0], args[1], args[2]);
      break;
    case "backup-schedule-get":
      await backupScheduleGet(args[0]);
      break;
    case "backup-schedule-set":
      await backupScheduleSet(args[0], args[1]);
      break;
    case "backup-schedule-toggle":
      await backupScheduleToggle(args[0], args[1]);
      break;
    case "backup-schedule-ensure":
      await ensureBackupSchedule(args[0], args[1] || "{}");
      break;
    case "backup-schedule-ensure-all":
      await backupScheduleEnsureAll(args[0] || "{}");
      break;
    case "cron-list":
      await cronList(args[0]);
      break;
    case "cron-create":
      await cronCreate(args[0], args[1], args.slice(2).join(" "));
      break;
    case "cron-delete":
      await cronDelete(args[0], args[1]);
      break;
    case "alias-list":
      await aliasList(args[0]);
      break;
    case "alias-create":
      await aliasCreate(args[0], args[1], args[2]);
      break;
    case "alias-delete":
      await aliasDelete(args[0], args[1]);
      break;
    case "redirect-list":
      await redirectList(args[0]);
      break;
    case "redirect-create":
      await redirectCreate(args[0], args[1], args[2], args[3]);
      break;
    case "redirect-delete":
      await redirectDelete(args[0], args[1]);
      break;
    case "feature-list":
      await featureList(args[0]);
      break;
    case "feature-set":
      await featureSet(args[0], args[1], args[2] === "true" || args[2] === "1");
      break;
    case "logs-tail":
      await logsTail(args[0], args[1] || "access");
      break;
    case "php-versions":
      await phpVersions(args[0]);
      break;
    case "php-directories":
      await phpDirectories(args[0]);
      break;
    case "php-ini":
      await phpIni(args[0], args[1]);
      break;
    case "php-set-directory":
      await phpSetDirectory(args[0], args[1], args[2]);
      break;
    case "php-modify-ini":
      await phpModifyIni(args[0], args[1], args[2], args[3]);
      break;
    case "php-delete-directory":
      await phpDeleteDirectory(args[0], args[1]);
      break;
    case "ftp-list":
      await ftpList(args[0]);
      break;
    case "ftp-create":
      await ftpCreate(args[0], args[1], args[2]);
      break;
    case "ftp-delete":
      await ftpDelete(args[0], args[1]);
      break;
    case "ftp-pass":
      await ftpPass(args[0], args[1], args[2]);
      break;
    case "limits-get":
      await limitsGet(args[0]);
      break;
    case "limits-set":
      await limitsSet(args[0], args[1]);
      break;
    case "domain-enable":
      await domainEnable(args[0]);
      break;
    case "domain-disable":
      await domainDisable(args[0]);
      break;
    case "domain-validate":
      await domainValidate(args[0]);
      break;
    case "domain-clone":
      await domainClone(args[0], args[1], args[2]);
      break;
    case "domain-migrate":
      await domainMigrate(args[0], args[1]);
      break;
    case "domain-transfer":
      await domainTransfer(args[0], args[1]);
      break;
    case "admin-license":
      await adminLicenseGet();
      break;
    case "admin-templates":
      await adminTemplatesList();
      break;
    case "admin-admins-list":
      await adminAdminsList();
      break;
    case "admin-admins-create":
      await adminAdminsCreate(args[0], args[1]);
      break;
    case "admin-admins-delete":
      await adminAdminsDelete(args[0]);
      break;
    case "admin-global-features":
      await adminGlobalFeaturesList();
      break;
    case "admin-global-feature-set":
      await adminGlobalFeatureSet(args[0], args[1]);
      break;
    case "admin-config-system":
      await adminConfigSystem(args[0]);
      break;
    case "admin-check-config":
      await adminCheckConfig();
      break;
    case "admin-s3-buckets":
      await adminS3ListBuckets(args[0], args[1]);
      break;
    case "admin-s3-files":
      await adminS3ListFiles(args[0], args[1], args[2]);
      break;
    case "admin-s3-upload":
      await adminS3Upload(args[0], args[1], args[2], args[3], args[4]);
      break;
    case "admin-server-status":
      await adminServerStatus();
      break;
    case "mail-logs-search":
      await mailLogsSearch(args[0], args[1] || "");
      break;
    case "imap-list":
      await imapList(args[0], args[1]);
      break;
    case "imap-copy":
      await imapCopy(args[0], args[1], args[2], args[3]);
      break;
    case "imap-messages":
      await imapMessages(args[0], args[1], args[2]);
      break;
    case "imap-fetch":
      await imapFetch(args[0], args[1], args[2], args[3]);
      break;
    case "protected-list":
      await protectedList(args[0]);
      break;
    case "protected-create":
      await protectedCreate(args[0], args[1]);
      break;
    case "protected-delete":
      await protectedDelete(args[0], args[1]);
      break;
    case "protected-users-list":
      await protectedUsersList(args[0], args[1]);
      break;
    case "protected-user-create":
      await protectedUserCreate(args[0], args[1], args[2], args[3]);
      break;
    case "protected-user-delete":
      await protectedUserDelete(args[0], args[1], args[2]);
      break;
    case "shared-list":
      await sharedList(args[0]);
      break;
    case "shared-create":
      await sharedCreate(args[0], args[1], args[2]);
      break;
    case "shared-delete":
      await sharedDelete(args[0], args[1]);
      break;
    case "mail-settings-get":
      await mailSettingsGet(args[0]);
      break;
    case "mail-settings-set":
      await mailSettingsSet(args[0], args[1]);
      break;
    case "proxy-list":
      await proxyList(args[0]);
      break;
    case "proxy-create":
      await proxyCreate(args[0], args[1], args[2], args[3]);
      break;
    case "proxy-delete":
      await proxyDelete(args[0], args[1]);
      break;
    case "script-available":
      await scriptAvailable(args[0]);
      break;
    case "script-list":
      await scriptList(args[0]);
      break;
    case "script-install":
      await scriptInstall(args[0], args[1], args[2], args[3]);
      break;
    case "script-rollback":
      await scriptRollbackCmd(args[0], args[1], args[2]);
      break;
    case "app-install-wordpress":
      await appInstallWordpress(args[0], args[1], args[2], args[3], args[4]);
      break;
    case "jellyfin-install":
      await jellyfinInstall(args[0], args[1]);
      break;
    case "jellyfin-status":
      await jellyfinStatus(args[0]);
      break;
    case "jellyfin-set-media-path":
      await jellyfinSetMediaPath(args[0], args[1]);
      break;
    case "jellyfin-list-videos":
      await jellyfinListVideos(args[0]);
      break;
    case "jellyfin-stream-resolve":
      await jellyfinStreamResolve(args[0], args[1]);
      break;
    case "script-delete":
      await scriptDelete(args[0], args[1]);
      break;
    case "runtimes-get":
      await runtimesGet(args[0]);
      break;
    case "runtimes-node-install":
      await runtimesNodeInstall(args[0], args[1], args[2], args[3]);
      break;
    case "runtimes-python-install":
      await runtimesPythonInstall(args[0], args[1], args[2]);
      break;
    case "runtimes-docker-install":
      await runtimesDockerInstall(args[0], args[1]);
      break;
    case "runtimes-docker-action":
      await runtimesDockerAction(args[0], args[1], args[2]);
      break;
    case "fail2ban-status":
      await fail2banStatus();
      break;
    case "cloud-credentials-list":
      await cloudCredentialsList();
      break;
    case "cloud-credentials-save":
      await cloudCredentialsSave(
        args[0],
        args[1],
        args[2],
        args[3],
        args[4],
        args[5],
        args[6],
        args[7],
      );
      break;
    case "backup-list-remote":
      await backupListRemote(args[0]);
      break;
    case "backup-pull-remote":
      await backupPullRemote(args[0], args[1]);
      break;
    case "backup-pull-remote-restore":
      await backupPullRemoteAndRestore(args[0], args[1], args[2]);
      break;
    case "backup-policy-get":
      await backupPolicyGet(args[0]);
      break;
    case "backup-policy-set":
      await backupPolicySet(args[0], args[1]);
      break;
    case "backup-archive-list":
      await backupArchiveList(args[0], args[1], args[2]);
      break;
    case "backup-restore-file":
      await backupRestoreFile(args[0], args[1], args[2]);
      break;
    case "backup-restore-database":
      await backupRestoreDatabase(args[0], args[1], args[2]);
      break;
    case "firewall-status":
      await firewallStatus();
      break;
    case "firewall-allow":
      await firewallAllow(args[0], args[1]);
      break;
    case "firewall-deny":
      await firewallDeny(args[0]);
      break;
    case "malware-scan":
      await malwareScanDomain(args[0]);
      break;
    case "malware-status":
      await malwareStatus(args[0]);
      break;
    case "malware-schedule-set":
      await malwareScheduleSet(args[0], args[1]);
      break;
    case "malware-quarantine-list":
      await malwareListQuarantine(args[0]);
      break;
    case "plan-get":
      await planGet(args[0]);
      break;
    case "plan-apply":
      await planApplyToDomain(args[0], args[1]);
      break;
    case "plan-upsert":
      await planUpsert(args[0], args[1]);
      break;
    case "modsecurity-status":
      await modsecurityStatus(args[0]);
      break;
    case "modsecurity-toggle":
      await modsecurityToggle(args[0], args[1]);
      break;
    case "modsecurity-logs":
      await modsecurityLogs(args[0], args[1], args[2]);
      break;
    case "modsecurity-crs-check":
      await modsecurityCrsCheck();
      break;
    case "metrics-snapshot":
      await metricsSnapshot();
      break;
    case "security-get":
      await securityGet(args[0]);
      break;
    case "security-spam":
      await securitySetSpam(args[0], args[1] === "true" || args[1] === "1");
      break;
    case "security-dkim":
      await securitySetDkim(args[0], args[1] === "true" || args[1] === "1");
      break;
    case "reseller-list":
      await resellerList();
      break;
    case "reseller-create":
      await resellerCreate(args[0], args[1]);
      break;
    case "reseller-delete":
      await resellerDelete(args[0]);
      break;
    case "plan-list":
      await planList();
      break;
    case "plan-create":
      await planCreate(args[0]);
      break;
    case "plan-delete":
      await planDelete(args[0]);
      break;
    case "newsletter-get":
      await newsletterGet(args[0]);
      break;
    case "newsletter-set":
      await newsletterSet(args[0], args.length > 1 ? args.slice(1).join(" ") : "{}");
      break;
    case "newsletter-subscribers-list":
      await newsletterSubscribersList(args[0]);
      break;
    case "newsletter-subscriber-upsert":
      await newsletterSubscriberUpsert(args[0], args.length > 1 ? args.slice(1).join(" ") : "{}");
      break;
    case "newsletter-subscriber-delete":
      await newsletterSubscriberDelete(args[0], args[1]);
      break;
    case "newsletter-subscribers-import":
      await newsletterSubscribersImport(args[0], args.length > 1 ? args.slice(1).join(" ") : "{}");
      break;
    case "newsletter-campaigns-list":
      await newsletterCampaignsList(args[0]);
      break;
    case "newsletter-campaign-upsert":
      await newsletterCampaignUpsert(args[0], args.length > 1 ? args.slice(1).join(" ") : "{}");
      break;
    case "newsletter-campaign-delete":
      await newsletterCampaignDelete(args[0], args[1]);
      break;
    case "newsletter-campaign-queue":
      await newsletterCampaignQueue(args[0], args[1]);
      break;
    case "newsletter-send-batch":
      await newsletterSendBatch(args[0], args[1]);
      break;
    case "newsletter-campaign-test":
      await newsletterCampaignTest(args[0], args.length > 1 ? args.slice(1).join(" ") : "{}");
      break;
    case "newsletter-public-subscribe":
      await newsletterPublicSubscribe(args[0], args.length > 1 ? args.slice(1).join(" ") : "{}");
      break;
    case "newsletter-public-confirm":
      await newsletterPublicConfirm(args[0], args[1]);
      break;
    case "newsletter-public-unsubscribe":
      await newsletterPublicUnsubscribe(args[0], args[1]);
      break;
    case "dmarc-get":
      await dmarcGet(args[0]);
      break;
    case "dmarc-set":
      await dmarcSet(args[0], args.length > 1 ? args.slice(1).join(" ") : "{}");
      break;
    case "mailbox-autoreply-list":
      await mailboxAutoreplyList(args[0]);
      break;
    case "mailbox-autoreply-set":
      await mailboxAutoreplySet(args[0], args.length > 1 ? args.slice(1).join(" ") : "{}");
      break;
    case "mail-bounces-list":
      await mailBouncesList(args[0]);
      break;
    case "newsletter-stats-get":
      await newsletterStatsGet(args[0]);
      break;
    case "newsletter-track-record":
      await newsletterTrackRecord(args[0], args.length > 1 ? args.slice(1).join(" ") : "{}");
      break;
    case "analytics-summary":
      await analyticsSummary(args[0]);
      break;
    case "git-deploy-get":
      await gitDeployGet(args[0]);
      break;
    case "git-deploy-set":
      await gitDeploySet(args[0], args.length > 1 ? args.slice(1).join(" ") : "{}");
      break;
    case "git-deploy-run":
      await gitDeployRun(args[0]);
      break;
    case "wp-toolkit-status":
      await wpToolkitStatus(args[0]);
      break;
    case "wp-toolkit-update":
      await wpToolkitUpdate(args[0]);
      break;
    case "maintenance-get":
      await maintenanceGet(args[0]);
      break;
    case "maintenance-set":
      await maintenanceSet(args[0], args.length > 1 ? args.slice(1).join(" ") : "{}");
      break;
    case "contact-form-get":
      await contactFormGet(args[0]);
      break;
    case "contact-form-set":
      await contactFormSet(args[0], args.length > 1 ? args.slice(1).join(" ") : "{}");
      break;
    case "contact-form-submit":
      await contactFormSubmit(args[0], args.length > 1 ? args.slice(1).join(" ") : "{}");
      break;
    case "staging-get":
      await stagingGet(args[0]);
      break;
    case "staging-sync":
      await stagingSync(args[0]);
      break;
    case "bandwidth-usage":
      await bandwidthUsage(args[0]);
      break;
    case "redis-get":
      await redisGet(args[0]);
      break;
    case "redis-set":
      await redisSet(args[0], args.length > 1 ? args.slice(1).join(" ") : "{}");
      break;
    case "ssh-keys-list":
      await sshKeysList(args[0]);
      break;
    case "ssh-keys-add":
      await sshKeysAdd(args[0], args.length > 1 ? args.slice(1).join(" ") : "{}");
      break;
    case "ssh-keys-delete":
      await sshKeysDelete(args[0], args[1]);
      break;
    case "awstats-config":
      await awstatsConfig(args[0]);
      break;
    case "tickets-list":
      await ticketsList(args[0]);
      break;
    case "tickets-create":
      await ticketsCreate(args[0], args.length > 1 ? args.slice(1).join(" ") : "{}");
      break;
    case "tickets-reply":
      await ticketsReply(args[0], args.length > 1 ? args.slice(1).join(" ") : "{}");
      break;
    case "billing-invoices-list":
      await billingInvoicesList(args[0]);
      break;
    case "billing-invoice-create":
      await billingInvoiceCreate(args[0], args.length > 1 ? args.slice(1).join(" ") : "{}");
      break;
    case "nodes-health":
      await nodesHealth();
      break;
    case "nodes-register":
      await nodesRegister(args[0] || "{}");
      break;
    case "carddav-status":
      await carddavStatus(args[0]);
      break;
    case "carddav-contact-upsert":
      await carddavContactUpsert(args[0], args.length > 1 ? args.slice(1).join(" ") : "{}");
      break;
    case "deliverability-dashboard":
      await deliverabilityDashboard(args[0]);
      break;
    case "mailbox-autoreply-apply":
      await mailboxAutoreplyApply(args[0], args[1]);
      break;
    case "bounce-suppress-list":
      await bounceSuppressList(args[0]);
      break;
    case "bounce-suppress-add": {
      const p = parseJsonArg(1);
      await bounceSuppressAdd(args[0], p.email || args[1]);
      break;
    }
    case "newsletter-gdpr-export":
      await newsletterGdprExport(args[0]);
      break;
    case "newsletter-templates-list":
      await newsletterTemplatesList(args[0]);
      break;
    case "newsletter-template-save":
      await newsletterTemplateSave(args[0], args.length > 1 ? args.slice(1).join(" ") : "{}");
      break;
    case "newsletter-segments-list":
      await newsletterSegmentsList(args[0]);
      break;
    case "newsletter-segment-save":
      await newsletterSegmentSave(args[0], args.length > 1 ? args.slice(1).join(" ") : "{}");
      break;
    case "analytics-history":
      await analyticsHistory(args[0]);
      break;
    case "git-deploy-log":
      await gitDeployLogGet(args[0]);
      break;
    case "git-deploy-rollback":
      await gitDeployRollback(args[0]);
      break;
    case "wp-toolkit-plugins":
      await wpToolkitPlugins(args[0]);
      break;
    case "wp-toolkit-security":
      await wpToolkitSecurity(args[0]);
      break;
    case "wp-toolkit-backup":
      await wpToolkitBackup(args[0]);
      break;
    case "maintenance-nginx":
      await maintenanceNginx(args[0], args.length > 1 ? args.slice(1).join(" ") : "{}");
      break;
    case "contact-form-embed":
      await contactFormEmbed(args[0]);
      break;
    case "staging-promote":
      await stagingPromote(args[0]);
      break;
    case "staging-vhost":
      await stagingVhost(args[0]);
      break;
    case "bandwidth-traffic":
      await bandwidthTraffic(args[0]);
      break;
    case "memcached-get":
      await memcachedGet(args[0]);
      break;
    case "memcached-set":
      await memcachedSet(args[0], args.length > 1 ? args.slice(1).join(" ") : "{}");
      break;
    case "mongo-create": {
      const p = parseJsonArg(1);
      await mongoCreate(args[0], p.name || args[1], p.pass || args[2]);
      break;
    }
    case "awstats-run":
      await awstatsRun(args[0]);
      break;
    case "subdomain-add":
      await subdomainAdd(args[0], args.length > 1 ? args.slice(1).join(" ") : "{}");
      break;
    case "seo-404-scan":
      await seo404Scan(args[0]);
      break;
    case "woocommerce-status":
      await woocommerceStatus(args[0]);
      break;
    case "ci-pipeline-get":
      await ciPipelineGet(args[0]);
      break;
    case "ci-pipeline-set":
      await ciPipelineSet(args[0], args.length > 1 ? args.slice(1).join(" ") : "{}");
      break;
    case "ci-pipeline-run":
      await ciPipelineRun(args[0]);
      break;
    case "ticket-notify":
      await ticketNotify(args[0], args.length > 1 ? args.slice(1).join(" ") : "{}");
      break;
    case "invoice-mark-sent": {
      const p = parseJsonArg(1);
      await invoiceMarkSent(args[0], p.invoiceId || args[1]);
      break;
    }
    case "carddav-export-vcf":
      await carddavExportVcf(args[0]);
      break;
    case "nodes-ping-health":
      await nodesPingHealth();
      break;
    case "panel-policy-get":
      await panelPolicyGet();
      break;
    case "panel-policy-set":
      await panelPolicySet(args[0] || "{}");
      break;
    case "system-cron-list":
      await systemCronList();
      break;
    case "system-awstats-summary":
      await systemAwstatsSummary(args[0]);
      break;
    case "domain-health-batch":
      await domainHealthBatch(args[0]);
      break;
    case "system-network-summary":
      await systemNetworkSummary();
      break;
    case "nodes-remote-provision":
      await nodesRemoteProvision(args[0] || "{}");
      break;
    case "invoice-pdf-generate": {
      const p = parseJsonArg(1);
      await invoicePdfGenerate(args[0], JSON.stringify(p));
      break;
    }
    case "invoice-payment-link": {
      const p = parseJsonArg(1);
      await invoicePaymentLink(args[0], JSON.stringify(p));
      break;
    }
    case "mailbox-quota-set": {
      const p = parseJsonArg(1);
      await mailboxQuotaSet(args[0], JSON.stringify(p));
      break;
    }
    case "mailbox-quotas-get":
      await mailboxQuotasGet(args[0]);
      break;
    default:
      emit({ ok: false, error: `Unknown command: ${cmd}` });
      process.exit(1);
  }
}

main().catch((e) => {
  emit({ ok: false, error: e instanceof Error ? e.message : String(e) });
  process.exit(1);
});
