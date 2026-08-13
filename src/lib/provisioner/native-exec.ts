import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { AsyncLocalStorage } from "node:async_hooks";
import { extractJournalSteps } from "@/lib/journal/helper-stream";
import type { JournalStep } from "@/lib/journal/types";

const execFileAsync = promisify(execFile);

export const PROVISIONING_HELPER_WRAPPER =
  process.env.QADBAK_PROVISIONING_WRAPPER ??
  "/opt/qadbak/scripts/run-provisioning-helper.sh";

export const BACKUP_DOWNLOAD_WRAPPER =
  process.env.QADBAK_BACKUP_DOWNLOAD_WRAPPER ??
  "/opt/qadbak/scripts/run-backup-download.sh";

export type HelperResult = {
  ok?: boolean;
  error?: string;
  [key: string]: unknown;
};

/**
 * Per-request journal-step capture.
 *
 * The provisioning helper is invoked from many call sites in the codebase;
 * rather than thread a JournalBuilder argument through every signature
 * (getProvisioner().createDomain → native-ops → runProvisioningHelper), we
 * stash captured steps in an AsyncLocalStorage that flows automatically
 * across `await` boundaries.
 *
 * The previous implementation used a single module-level array which was
 * a real cross-request contamination hazard: when request A awaited the
 * sudo wrapper, request B could call consumeLastJournalSteps() and grab
 * A's steps (or vice-versa). With AsyncLocalStorage each request gets an
 * isolated store, and helper calls outside a wrapped scope are no-ops
 * (steps are silently dropped instead of leaking globally).
 *
 * Callers wrap their handler body in `runWithJournalStore(async () => …)`.
 */
interface JournalScope {
  steps: JournalStep[];
}
const journalStore = new AsyncLocalStorage<JournalScope>();

/** Wrap an async block so runProvisioningHelper steps are captured per-request. */
export function runWithJournalStore<T>(fn: () => Promise<T>): Promise<T> {
  return journalStore.run({ steps: [] }, fn);
}

/** Drain steps captured since the last consume call. Empty array outside a scope. */
export function consumeLastJournalSteps(): JournalStep[] {
  const scope = journalStore.getStore();
  if (!scope) return [];
  const steps = scope.steps;
  scope.steps = [];
  return steps;
}

function parseHelperStdout(stdout: string): HelperResult | null {
  const lines = stdout.trim().split("\n").filter(Boolean);
  for (let i = lines.length - 1; i >= 0; i -= 1) {
    const line = lines[i].trim();
    if (!line.startsWith("{")) continue;
    if (line.includes('"journal-step"')) continue;
    try {
      return JSON.parse(line) as HelperResult;
    } catch {
      /* try previous line */
    }
  }
  return null;
}

function rememberSteps(stdout: string): void {
  if (!stdout) return;
  const scope = journalStore.getStore();
  if (!scope) return; // outside a wrapped scope — drop steps rather than leak globally
  const steps = extractJournalSteps(stdout);
  if (steps.length > 0) {
    scope.steps.push(...steps);
  }
}

function helperTimeoutMs(command: string): number {
  if (command.startsWith("pogo-stack-") || command === "jellyfin-install") {
    return 2_700_000;
  }
  return 600_000;
}

function formatHelperFailure(err: {
  stdout?: string;
  stderr?: string;
  message?: string;
  killed?: boolean;
  signal?: NodeJS.Signals | null;
  code?: string | number | null;
}): string {
  const parsed = err.stdout ? parseHelperStdout(err.stdout) : null;
  if (parsed?.ok === false && parsed.error) return String(parsed.error);
  const stderr = err.stderr?.trim() ?? "";
  const stdoutTail =
    err.stdout
      ?.trim()
      .split("\n")
      .filter((line) => !line.includes('"journal-step"'))
      .slice(-12)
      .join("\n")
      .trim() ?? "";
  if (err.killed || err.signal === "SIGTERM") {
    return `PoGo/provisioning helper timed out. Last output: ${
      stderr || stdoutTail || "no output (docker build may still be running)"
    }`.slice(0, 2000);
  }
  if (stderr) return stderr.slice(0, 2000);
  if (stdoutTail) return stdoutTail.slice(0, 2000);
  if (err.message && !err.message.startsWith("Command failed:")) {
    return err.message;
  }
  return `${err.message || "Provisioning helper failed"}${
    err.code != null ? ` (code ${err.code})` : ""
  }`;
}

export async function runProvisioningHelper(
  ...args: string[]
): Promise<HelperResult> {
  const timeout = helperTimeoutMs(args[0] ?? "");
  try {
    const { stdout } = await execFileAsync(
      "sudo",
      ["-n", PROVISIONING_HELPER_WRAPPER, ...args],
      { timeout, maxBuffer: 32 * 1024 * 1024 },
    );
    rememberSteps(stdout);
    const parsed = parseHelperStdout(stdout);
    if (!parsed) {
      throw new Error(
        `Provisioning helper returned non-JSON output: ${stdout.slice(0, 200).replace(/\s+/g, " ")}`,
      );
    }
    if (parsed.ok === false) {
      throw new Error(parsed.error ?? "Provisioning helper failed");
    }
    return parsed;
  } catch (e) {
    const err = e as {
      stdout?: string;
      stderr?: string;
      message?: string;
      killed?: boolean;
      signal?: NodeJS.Signals | null;
      code?: string | number | null;
    };
    if (err.stdout) rememberSteps(err.stdout);
    throw new Error(formatHelperFailure(err));
  }
}
