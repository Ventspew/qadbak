import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { runAppInstall } from "./install";
import type { AppInstallContext, AppInstallResult } from "./types";

const JOB_DIR = process.env.QADBAK_DIR
  ? path.join(process.env.QADBAK_DIR, "data", "app-jobs")
  : "/opt/qadbak/data/app-jobs";

export type AppInstallJob = {
  id: string;
  status: "running" | "ok" | "error";
  templateId: string;
  startedAt: string;
  finishedAt?: string;
  error?: string;
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
  };
  await writeInstallJob(job);

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
