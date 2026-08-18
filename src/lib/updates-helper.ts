import "server-only";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { requirePremiumFeature } from "./premium/guard";

const execFileAsync = promisify(execFile);

export const UPDATE_HELPER_WRAPPER =
  process.env.QADBAK_UPDATE_HELPER_WRAPPER ??
  "/opt/qadbak/scripts/run-update-helper.sh";

export type LinuxUpdateStatus = {
  updatedAt: string;
  upgradable: number;
  security: number;
  rebootRequired: boolean;
  summaryLine: string;
};

export type UbuntuReleaseTarget = {
  version: string;
  codename: string;
  label: string;
};

export type UbuntuReleaseStatus = {
  supported: boolean;
  reason?: string;
  installMode?: string;
  current?: {
    version: string;
    codename: string;
    pretty: string;
  };
  nextTarget?: UbuntuReleaseTarget | null;
  finalTarget?: UbuntuReleaseTarget | null;
  upgradeAvailable: boolean;
  checkSummary?: string;
  packageUpdatesPending: number;
  rebootRequired: boolean;
  preflightOk: boolean;
  preflightIssues: string[];
  diskFreeMb?: number;
  checkedAt: string;
};

export type QadbakUpdateStatus = {
  isGit: boolean;
  commit?: string;
  branch?: string;
  trackingBranch?: string;
  remoteUrl?: string;
  behind?: number;
  diverged?: boolean;
  upToDate?: boolean;
  checkedAt?: string;
  message?: string;
  error?: string;
  version?: string;
  originVersion?: string;
  changelogVersion?: string;
  changelogDate?: string;
  changelog?: string;
  releasesUrl?: string;
};

export type UpdateJobMeta = {
  id: string;
  type: string;
  status: "running" | "done" | "failed";
  startedAt?: string;
  finishedAt?: string;
  exitCode?: number;
};

type HelperPayload = {
  ok?: boolean;
  error?: string;
  linux?: LinuxUpdateStatus;
  ubuntuRelease?: UbuntuReleaseStatus;
  fromCache?: boolean;
  qadbak?: QadbakUpdateStatus;
  job?: UpdateJobMeta;
  log?: string;
  backupDir?: string;
  copied?: string[];
  pong?: boolean;
};

async function runUpdateHelper(args: string[]): Promise<HelperPayload> {
  const { stdout } = await execFileAsync(
    "sudo",
    ["-n", UPDATE_HELPER_WRAPPER, ...args],
    {
      timeout: 600_000,
      maxBuffer: 8 * 1024 * 1024,
    },
  );
  const trimmed = stdout.trim();
  const line = trimmed.split("\n").pop() ?? "{}";
  let parsed: HelperPayload | null = null;
  try {
    parsed = JSON.parse(line) as HelperPayload;
  } catch {
    const start = trimmed.lastIndexOf("{");
    const end = trimmed.lastIndexOf("}");
    if (start >= 0 && end > start) {
      try {
        parsed = JSON.parse(trimmed.slice(start, end + 1)) as HelperPayload;
      } catch {
        parsed = null;
      }
    }
  }
  if (!parsed || typeof parsed !== "object") {
    throw new Error(trimmed.slice(0, 200) || "Update helper returned invalid JSON.");
  }
  if (parsed.ok === false) {
    throw new Error(parsed.error ?? "Update helper failed");
  }
  return parsed;
}

export async function probeUpdatesHelperSudo(): Promise<boolean> {
  await requirePremiumFeature("admin-updates");
  try {
    await runUpdateHelper(["ping"]);
    return true;
  } catch {
    return false;
  }
}

export async function getLinuxUpdateStatus(refresh = false): Promise<{
  linux: LinuxUpdateStatus;
  fromCache?: boolean;
}> {
  await requirePremiumFeature("admin-updates");
  const r = await runUpdateHelper([refresh ? "linux-refresh" : "linux-status"]);
  if (!r.linux) throw new Error("No Linux update status returned.");
  return { linux: r.linux, fromCache: r.fromCache };
}

export async function startLinuxUpgrade(): Promise<UpdateJobMeta> {
  await requirePremiumFeature("admin-updates");
  const r = await runUpdateHelper(["linux-upgrade-start"]);
  if (!r.job) throw new Error("No job started.");
  return r.job;
}

export async function getUbuntuReleaseStatus(refresh = false): Promise<{
  ubuntuRelease: UbuntuReleaseStatus;
}> {
  await requirePremiumFeature("admin-updates");
  if (refresh) {
    await runUpdateHelper(["linux-refresh"]);
  }
  const r = await runUpdateHelper(["ubuntu-release-status"]);
  if (!r.ubuntuRelease) throw new Error("No Ubuntu release status returned.");
  return { ubuntuRelease: r.ubuntuRelease };
}

export async function startUbuntuReleaseUpgrade(
  targetVersion: string,
): Promise<UpdateJobMeta> {
  await requirePremiumFeature("admin-updates");
  const r = await runUpdateHelper(["ubuntu-release-start", targetVersion]);
  if (!r.job) throw new Error("No job started.");
  return r.job;
}

export async function getQadbakUpdateStatus(): Promise<QadbakUpdateStatus> {
  await requirePremiumFeature("admin-updates");
  const r = await runUpdateHelper(["qadbak-status"]);
  if (!r.qadbak) throw new Error("No Qadbak update status returned.");
  return r.qadbak;
}

export async function startQadbakUpgrade(): Promise<{
  job: UpdateJobMeta;
  backupDir?: string;
  copied?: string[];
}> {
  await requirePremiumFeature("admin-updates");
  const r = await runUpdateHelper(["qadbak-upgrade-start"]);
  if (!r.job) throw new Error("No job started.");
  return { job: r.job, backupDir: r.backupDir, copied: r.copied };
}

export async function getUpdateJob(
  jobId: string,
): Promise<{ job: UpdateJobMeta; log: string }> {
  await requirePremiumFeature("admin-updates");
  const r = await runUpdateHelper(["job-status", jobId]);
  if (!r.job) throw new Error("Job not found.");
  return { job: r.job, log: r.log ?? "" };
}
