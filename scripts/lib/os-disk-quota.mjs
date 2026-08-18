import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fail, loadRegistry } from "./provisioning-common.mjs";

const exec = promisify(execFile);

/** Parse Limits “Disk (MB)” or values like 5G / 10GB. Returns KB for setquota, or 0 = unlimited. */
export function parseDiskLimitToKb(raw) {
  const s = String(raw ?? "").trim().toLowerCase();
  if (!s || s === "0" || s === "unlimited" || s === "none" || s === "-") return 0;
  const m = s.match(/^([\d.]+)\s*(b|k|kb|m|mb|g|gb|t|tb)?$/i);
  if (!m) return 0;
  const n = Number(m[1]);
  if (!Number.isFinite(n) || n < 0) return 0;
  const unit = (m[2] || "mb").toLowerCase();
  let mb = n;
  if (unit === "b") mb = n / (1024 * 1024);
  else if (unit === "k" || unit === "kb") mb = n / 1024;
  else if (unit === "g" || unit === "gb") mb = n * 1024;
  else if (unit === "t" || unit === "tb") mb = n * 1024 * 1024;
  const kb = Math.round(mb * 1024);
  return kb > 0 ? kb : 0;
}

async function mountForHome(home) {
  try {
    const { stdout } = await exec("findmnt", ["-n", "-o", "TARGET", "--target", home], {
      timeout: 8000,
    });
    const t = stdout.trim().split("\n")[0];
    if (t) return t;
  } catch {
    /* */
  }
  try {
    const { stdout } = await exec("df", ["-P", home], { timeout: 8000 });
    const line = stdout.trim().split("\n").pop() || "";
    const parts = line.split(/\s+/);
    return parts[parts.length - 1] || "/";
  } catch {
    return "/";
  }
}

async function maxDiskKbForUnixUser(user) {
  const rows = await loadRegistry();
  let maxKb = 0;
  let sawLimit = false;
  for (const row of rows) {
    if (String(row.user || "") !== String(user)) continue;
    const kb = parseDiskLimitToKb(row.disk_limit);
    if (kb === 0 && String(row.disk_limit || "").trim()) {
      /* explicit unlimited on this domain */
      return 0;
    }
    if (kb > 0) {
      sawLimit = true;
      if (kb > maxKb) maxKb = kb;
    }
  }
  return sawLimit ? maxKb : 0;
}

export async function applyOsDiskQuota(user) {
  const unix = String(user || "").trim();
  if (!unix || !/^[a-z_][a-z0-9_-]*$/i.test(unix)) {
    fail("Invalid unix user for disk quota.");
  }
  const kb = await maxDiskKbForUnixUser(unix);
  const home = `/home/${unix}`;
  const mount = await mountForHome(home);
  const soft = String(kb);
  const hard = String(kb);
  try {
    await exec("setquota", ["-u", unix, soft, hard, "0", "0", mount], {
      timeout: 15_000,
    });
  } catch (e) {
    if (kb === 0) return;
    const code = e && typeof e === "object" && "code" in e ? e.code : "";
    const msg = e instanceof Error ? e.message : String(e);
    if (code === "ENOENT") {
      fail(
        "setquota is not installed. Install the quota package (apt install quota) and enable usrquota on the /home filesystem.",
      );
    }
    fail(
      `OS disk quota failed on ${mount} for ${unix}: ${msg.slice(0, 300)}. Enable usrquota (ext4: usrquota in fstab, then mount -o remount,usrquota and quotaon).`,
    );
  }
}
