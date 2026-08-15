import { spawn } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { runAppInstall } from "./install";
import type { AppInstallContext, AppInstallResult } from "./types";

const QADBAK_DIR = process.env.QADBAK_DIR || "/opt/qadbak";
const JOB_DIR = path.join(QADBAK_DIR, "data", "app-jobs");

export type AppInstallJob = {
  id: string;
  status: "running" | "ok" | "error";
  templateId: string;
  startedAt: string;
  finishedAt?: string;
  error?: string;
  lastMessage?: string;
  result?: AppInstallResult;
};

async function jobPath(id: string) {
  await mkdir(JOB_DIR, { recursive: true });
  return path.join(JOB_DIR, `${id}.json`);
}

export async function writeInstallJob(job: AppInstallJob) {
  const file = await jobPath(job.id);
  await writeFile(file, `${JSON.stringify(job, null, 2)}\n`, "utf8");
}

export async function readInstallJob(id: string): Promise<AppInstallJob | null> {
  try {
    const raw = await readFile(path.join(JOB_DIR, `${id}.json`), "utf8");
    return JSON.parse(raw) as AppInstallJob;
  } catch {
    return null;
  }
}

function spawnDetachedWorker(jobId: string): boolean {
  const worker = path.join(QADBAK_DIR, "scripts", "run-app-install-job.mjs");
  try {
    const child = spawn(process.execPath, [worker, jobId], {
      detached: true,
      stdio: "ignore",
      cwd: QADBAK_DIR,
      env: { ...process.env, QADBAK_DIR },
    });
    child.unref();
    return true;
  } catch {
    return false;
  }
}

export async function startBackgroundAppInstall(opts: {
  templateId: string;
  rawInput: Record<string, unknown>;
  session: AppInstallContext["session"];
}): Promise<string> {
  const id = randomUUID();
  const job: AppInstallJob = {
    id,
    status: "running",
    templateId: opts.templateId,
    startedAt: new Date().toISOString(),
    lastMessage: "Queued",
  };
  await writeInstallJob(job);
  await writeFile(
    path.join(JOB_DIR, `${id}.input.json`),
    `${JSON.stringify(
      {
        templateId: opts.templateId,
        rawInput: opts.rawInput,
        session: { username: opts.session.username, role: opts.session.role },
      },
      null,
      2,
    )}\n`,
    "utf8",
  );

  if (spawnDetachedWorker(id)) {
    return id;
  }

  void runAppInstall(opts)
    .then(async (result) => {
      await writeInstallJob({
        ...job,
        status: "ok",
        finishedAt: new Date().toISOString(),
        result,
      });
    })
    .catch(async (err) => {
      await writeInstallJob({
        ...job,
        status: "error",
        finishedAt: new Date().toISOString(),
        error: err instanceof Error ? err.message : String(err),
      });
    });

  return id;
}
