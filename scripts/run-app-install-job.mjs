#!/usr/bin/env node
/**
 * Detached app-install worker. Next.js only starts this process so Docker
 * builds cannot block or crash the panel (Cloudflare/nginx HTML 502).
 *
 * Usage: node scripts/run-app-install-job.mjs <jobId>
 */
import { spawn } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = process.env.QADBAK_DIR
  ? process.env.QADBAK_DIR
  : path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const JOB_DIR = path.join(ROOT, "data", "app-jobs");
const HELPER =
  process.env.QADBAK_PROVISIONING_WRAPPER ||
  path.join(ROOT, "scripts", "run-provisioning-helper.sh");

const jobId = String(process.argv[2] || "").trim();
if (!jobId || !/^[a-f0-9-]{8,}$/i.test(jobId)) {
  console.error("job id required");
  process.exit(1);
}

function parseHelperJson(stdout) {
  const lines = String(stdout || "")
    .trim()
    .split("\n")
    .filter(Boolean);
  for (let i = lines.length - 1; i >= 0; i -= 1) {
    const line = lines[i].trim();
    if (!line.startsWith("{")) continue;
    if (line.includes('"journal-step"')) continue;
    try {
      return JSON.parse(line);
    } catch {
      /* try previous */
    }
  }
  return null;
}

async function readJson(file) {
  return JSON.parse(await readFile(file, "utf8"));
}

async function writeJob(job) {
  const file = path.join(JOB_DIR, `${job.id}.json`);
  await writeFile(file, `${JSON.stringify(job, null, 2)}\n`, "utf8");
}

function runHelper(args) {
  return new Promise((resolve, reject) => {
    const child = spawn("sudo", ["-n", HELPER, ...args], {
      env: { ...process.env, QADBAK_DIR: ROOT },
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (buf) => {
      stdout += buf.toString();
    });
    child.stderr.on("data", (buf) => {
      stderr += buf.toString();
    });
    const timer = setTimeout(() => {
      child.kill("SIGTERM");
      reject(new Error(`Install helper timed out. ${stderr || stdout}`.slice(0, 2000)));
    }, 2_700_000);
    child.on("error", (err) => {
      clearTimeout(timer);
      reject(err);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      const parsed = parseHelperJson(stdout);
      if (code === 0 && parsed?.ok !== false) {
        resolve(parsed || { ok: true });
        return;
      }
      const err =
        parsed?.error ||
        stderr.trim() ||
        stdout.trim().split("\n").slice(-15).join("\n") ||
        `helper exit ${code}`;
      reject(new Error(String(err).slice(0, 2000)));
    });
  });
}

function minecraftResult(jobId, input, helper) {
  const domain = String(input.domain || "").trim();
  const subdomain = String(input.subdomain || "mc").trim() || "mc";
  const host = helper.subdomain || `${subdomain}.${domain}`;
  const credentials = [
    {
      label: "Join address (Java Edition)",
      value: helper.joinAddress || host,
      isSecret: false,
    },
  ];
  if (helper.dataDir) {
    credentials.push({
      label: "Mods / plugins folder",
      value: helper.dataDir,
      isSecret: false,
    });
  }
  if (helper.rconPassword) {
    credentials.push({
      label: "RCON password",
      value: helper.rconPassword,
      isSecret: true,
    });
  }
  if (helper.discordLogin) {
    credentials.push({
      label: "Discord login (DM updates)",
      value: helper.discordLogin,
      isSecret: false,
    });
  }
  const postInstall = Array.isArray(helper.postInstall)
    ? helper.postInstall.join(" ")
    : helper.postInstall;
  return {
    appId: "minecraft",
    domain,
    primaryUrl: helper.adminUrl || `https://${host}/`,
    credentials,
    postInstall,
    journalId: jobId,
  };
}

const TEMPLATES = {
  minecraft: {
    message: "Starting Minecraft Java server (detached from panel)",
    helperArgs: (input) => [
      "minecraft-install",
      String(input.domain || "").trim(),
      JSON.stringify({
        subdomain: String(input.subdomain || "mc").trim() || "mc",
        pack: String(input.pack || "paper").trim() || "paper",
        memory: String(input.memory || "4G").trim() || "4G",
        onlineMode: input.onlineMode,
        extraMods: String(input.extraMods || "").trim(),
        discordBotToken: String(input.discordBotToken || "").trim(),
        discordClientId: String(input.discordClientId || "").trim(),
        discordClientSecret: String(input.discordClientSecret || "").trim(),
        discordInvite: String(input.discordInvite || "").trim(),
      }),
    ],
    result: minecraftResult,
  },
};

const jobFile = path.join(JOB_DIR, `${jobId}.json`);
const inputFile = path.join(JOB_DIR, `${jobId}.input.json`);

let job;
try {
  job = await readJson(jobFile);
  const payload = await readJson(inputFile);
  const input = payload.rawInput || {};
  const spec = TEMPLATES[payload.templateId];
  if (!spec) {
    throw new Error(`Unsupported background template: ${payload.templateId}`);
  }
  job.lastMessage = spec.message;
  await writeJob(job);

  const domain = String(input.domain || "").trim();
  if (!domain) throw new Error("domain is required");
  const helper = await runHelper(spec.helperArgs(input));
  job.status = "ok";
  job.finishedAt = new Date().toISOString();
  job.lastMessage = "Install finished";
  job.result = spec.result(jobId, input, helper);
  await writeJob(job);
} catch (err) {
  const message = err instanceof Error ? err.message : String(err);
  try {
    job = job || (await readJson(jobFile));
    job.status = "error";
    job.finishedAt = new Date().toISOString();
    job.error = message;
    job.lastMessage = message;
    await writeJob(job);
  } catch {
    console.error(message);
  }
  process.exit(1);
}
