"use client";

import { Alert, Button, Card } from "@/components/ui";
import type {
  LinuxUpdateStatus,
  QadbakUpdateStatus,
  UbuntuReleaseStatus,
} from "@/lib/updates-helper";
import { useCallback, useEffect, useRef, useState } from "react";

function formatTime(iso?: string) {
  if (!iso) return " - ";
  try {
    return new Date(iso).toLocaleString();
  } catch {
    return iso;
  }
}

export function AdminUpdatesView() {
  const [available, setAvailable] = useState(true);
  const [setupError, setSetupError] = useState("");
  const [error, setError] = useState("");
  const [linux, setLinux] = useState<LinuxUpdateStatus | null>(null);
  const [ubuntuRelease, setUbuntuRelease] = useState<UbuntuReleaseStatus | null>(
    null,
  );
  const [qadbak, setQadbak] = useState<QadbakUpdateStatus | null>(null);
  const [linuxJobId, setLinuxJobId] = useState<string | null>(null);
  const [ubuntuJobId, setUbuntuJobId] = useState<string | null>(null);
  const [qadbakJobId, setQadbakJobId] = useState<string | null>(null);
  const [linuxLog, setLinuxLog] = useState("");
  const [ubuntuLog, setUbuntuLog] = useState("");
  const [qadbakLog, setQadbakLog] = useState("");
  const [backupNote, setBackupNote] = useState("");
  const [loading, setLoading] = useState(true);
  const [acting, setActing] = useState<string | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const loadLinux = useCallback(async (refresh = false) => {
    const q = refresh ? "?refresh=1" : "";
    const res = await fetch(`/api/admin/updates/linux${q}`);
    const data = await res.json();
    if (!res.ok) throw new Error(data.error ?? "Linux status failed.");
    if (data.available === false) {
      setAvailable(false);
      setSetupError(data.error ?? "Updates helper unavailable.");
      return;
    }
    setAvailable(true);
    setLinux(data.linux ?? null);
  }, []);

  const loadUbuntuRelease = useCallback(async (refresh = false) => {
    const q = refresh ? "?refresh=1" : "";
    const res = await fetch(`/api/admin/updates/ubuntu-release${q}`);
    const data = await res.json();
    if (!res.ok) throw new Error(data.error ?? "Ubuntu release status failed.");
    if (data.available === false) {
      setAvailable(false);
      setSetupError(data.error ?? "Updates helper unavailable.");
      return;
    }
    setAvailable(true);
    setUbuntuRelease(data.ubuntuRelease ?? null);
  }, []);

  const loadQadbak = useCallback(async () => {
    const res = await fetch("/api/admin/updates/qadbak");
    const data = await res.json();
    if (!res.ok) throw new Error(data.error ?? "Qadbak status failed.");
    if (data.available === false) {
      setAvailable(false);
      setSetupError(data.error ?? "Updates helper unavailable.");
      return;
    }
    setQadbak(data.qadbak ?? null);
  }, []);

  const loadAll = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      await Promise.all([loadLinux(), loadUbuntuRelease(), loadQadbak()]);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error.");
    } finally {
      setLoading(false);
    }
  }, [loadLinux, loadUbuntuRelease, loadQadbak]);

  useEffect(() => {
    loadAll();
  }, [loadAll]);

  const pollJob = useCallback(
    async (kind: "linux" | "ubuntu" | "qadbak", jobId: string) => {
      const url =
        kind === "linux"
          ? `/api/admin/updates/linux?jobId=${encodeURIComponent(jobId)}`
          : kind === "ubuntu"
            ? `/api/admin/updates/ubuntu-release?jobId=${encodeURIComponent(jobId)}`
            : `/api/admin/updates/qadbak?jobId=${encodeURIComponent(jobId)}`;
      const res = await fetch(url);
      const data = await res.json();
      if (!res.ok) return;
      if (kind === "linux") {
        setLinuxLog(data.log ?? "");
        if (data.job?.status !== "running") {
          setLinuxJobId(null);
          await loadLinux(true);
        }
      } else if (kind === "ubuntu") {
        setUbuntuLog(data.log ?? "");
        if (data.job?.status !== "running") {
          setUbuntuJobId(null);
          await loadUbuntuRelease(true);
        }
      } else {
        setQadbakLog(data.log ?? "");
        if (data.job?.status !== "running") {
          setQadbakJobId(null);
          await loadQadbak();
        }
      }
    },
    [loadLinux, loadUbuntuRelease, loadQadbak],
  );

  useEffect(() => {
    const active = linuxJobId ?? ubuntuJobId ?? qadbakJobId;
    if (!active) {
      if (pollRef.current) clearInterval(pollRef.current);
      pollRef.current = null;
      return;
    }
    const tick = () => {
      if (linuxJobId) void pollJob("linux", linuxJobId);
      if (ubuntuJobId) void pollJob("ubuntu", ubuntuJobId);
      if (qadbakJobId) void pollJob("qadbak", qadbakJobId);
    };
    tick();
    pollRef.current = setInterval(tick, 2500);
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, [linuxJobId, ubuntuJobId, qadbakJobId, pollJob]);

  async function postJson(
    path: string,
    action: "refresh" | "upgrade",
    extra?: { targetVersion?: string },
  ) {
    const key = `${path}-${action}`;
    setActing(key);
    setError("");
    try {
      const res = await fetch(path, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, ...extra }),
      });
      const text = await res.text();
      let data: Record<string, unknown>;
      try {
        data = JSON.parse(text) as Record<string, unknown>;
      } catch {
        throw new Error(
          text.startsWith("<!")
            ? "Server returned HTML instead of JSON. Check that you are logged in as admin."
            : "Invalid response from server.",
        );
      }
      if (!res.ok) throw new Error(String(data.error ?? "Action failed."));
      if (path.includes("/linux")) {
        if (data.linux) setLinux(data.linux as LinuxUpdateStatus);
        const job = data.job as { id?: string } | undefined;
        if (job?.id) {
          setLinuxJobId(job.id);
          setLinuxLog("Upgrade started…\n");
        }
      } else if (path.includes("/ubuntu-release")) {
        if (data.ubuntuRelease) setUbuntuRelease(data.ubuntuRelease as UbuntuReleaseStatus);
        const job = data.job as { id?: string } | undefined;
        if (job?.id) {
          setUbuntuJobId(job.id);
          setUbuntuLog("Ubuntu release upgrade started…\n");
        }
      } else {
        if (data.qadbak) setQadbak(data.qadbak as QadbakUpdateStatus);
        const job = data.job as { id?: string } | undefined;
        if (job?.id) {
          setQadbakJobId(job.id);
          setQadbakLog("Update started…\n");
          if (data.backupDir) {
            const copied = data.copied as string[] | undefined;
            setBackupNote(
              `Backed up panel data to ${String(data.backupDir)} (${(copied ?? []).join(", ") || "none"})`,
            );
          }
        }
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error.");
    } finally {
      setActing(null);
    }
  }

  async function post(
    endpoint: "linux" | "ubuntu" | "qadbak",
    action: "refresh" | "upgrade",
    extra?: { targetVersion?: string },
  ) {
    const path =
      endpoint === "ubuntu"
        ? "/api/admin/updates/ubuntu-release"
        : `/api/admin/updates/${endpoint}`;
    await postJson(path, action, extra);
  }

  return (
    <div className="space-y-6">
      {error && <Alert>{error}</Alert>}
      {!available && (
        <Alert>
          Run on the VPS:{" "}
          <code className="text-xs">
            sudo bash /opt/qadbak/scripts/configure-updates-sudo.sh
          </code>
          <br />
          {setupError}
        </Alert>
      )}

      <Card>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-lg font-medium text-white">Linux packages</h2>
          <div className="flex flex-wrap gap-2">
            <Button
              variant="secondary"
              disabled={loading || !available || !!linuxJobId}
              onClick={() => post("linux", "refresh")}
            >
              {acting === "linux-refresh" ? "Refreshing…" : "Refresh status"}
            </Button>
            <Button
              variant="danger"
              disabled={
                loading ||
                !available ||
                !!linuxJobId ||
                (linux?.upgradable ?? 0) === 0
              }
              onClick={() => {
                if (
                  !window.confirm(
                    "Run apt-get upgrade -y on this server? This may take several minutes.",
                  )
                ) {
                  return;
                }
                void post("linux", "upgrade");
              }}
            >
              {acting === "linux-upgrade" || linuxJobId
                ? "Upgrading…"
                : "Install updates"}
            </Button>
          </div>
        </div>
        <p className="mt-1 text-sm text-panel-muted">
          Cached status refreshes hourly; use Refresh for apt-get update + simulate.
        </p>
        {linux && (
          <ul className="mt-4 space-y-2 text-sm">
            <li>
              <span className="text-panel-muted">Summary: </span>
              <span className="text-white">{linux.summaryLine}</span>
            </li>
            <li>
              <span className="text-panel-muted">Upgradable: </span>
              <span className="text-white">{linux.upgradable}</span>
              <span className="text-panel-muted"> · Security mentions: </span>
              <span className="text-white">{linux.security}</span>
            </li>
            <li>
              <span className="text-panel-muted">Reboot required: </span>
              <span className={linux.rebootRequired ? "text-amber-400" : "text-emerald-400"}>
                {linux.rebootRequired ? "Yes (/var/run/reboot-required)" : "No"}
              </span>
            </li>
            <li className="text-panel-muted">Checked: {formatTime(linux.updatedAt)}</li>
          </ul>
        )}
        {linuxLog && (
          <pre className="mt-4 max-h-48 overflow-auto rounded-lg border border-panel-border bg-panel-bg p-3 text-xs text-panel-muted">
            {linuxLog}
          </pre>
        )}
      </Card>

      <Card>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-lg font-medium text-white">Ubuntu release upgrade</h2>
          <div className="flex flex-wrap gap-2">
            <Button
              variant="secondary"
              disabled={loading || !available || !!ubuntuJobId}
              onClick={() => post("ubuntu", "refresh")}
            >
              {acting === "ubuntu-refresh" ? "Checking…" : "Check upgrade path"}
            </Button>
            <Button
              variant="danger"
              disabled={
                loading ||
                !available ||
                !!ubuntuJobId ||
                !ubuntuRelease?.supported ||
                !ubuntuRelease?.nextTarget ||
                !ubuntuRelease?.preflightOk
              }
              onClick={() => {
                const target = ubuntuRelease?.nextTarget;
                if (!target) return;
                const steps =
                  ubuntuRelease?.finalTarget &&
                  ubuntuRelease.current?.version === "22.04"
                    ? `\n\nNote: reaching ${ubuntuRelease.finalTarget.version} requires two upgrades (22.04 → 24.04 → 26.04). This run only upgrades to ${target.version}.`
                    : "";
                if (
                  !window.confirm(
                    `Upgrade this server from Ubuntu ${ubuntuRelease?.current?.version ?? "?"} to ${target.version} (${target.codename})?\n\nThe panel will go offline for 30–90+ minutes. Customer sites and mail may be interrupted. A reboot is scheduled automatically when finished.${steps}`,
                  )
                ) {
                  return;
                }
                void post("ubuntu", "upgrade", { targetVersion: target.version });
              }}
            >
              {acting === "ubuntu-upgrade" || ubuntuJobId
                ? "Upgrading Ubuntu…"
                : ubuntuRelease?.nextTarget
                  ? `Upgrade to ${ubuntuRelease.nextTarget.version}`
                  : "Upgrade Ubuntu"}
            </Button>
          </div>
        </div>
        <p className="mt-1 text-sm text-panel-muted">
          In-place LTS upgrade via <code className="text-xs">do-release-upgrade</code>.
          One step at a time: 22.04→24.04, then 24.04→26.04. Install pending package
          updates first (card above).
        </p>
        {ubuntuRelease && (
          <ul className="mt-4 space-y-2 text-sm">
            {!ubuntuRelease.supported && (
              <li className="text-amber-400">
                {ubuntuRelease.reason ??
                  (ubuntuRelease.installMode === "panel-only"
                    ? "Panel-only hosts cannot run OS release upgrades."
                    : "Ubuntu release upgrade not available on this host.")}
              </li>
            )}
            {ubuntuRelease.current && (
              <li>
                <span className="text-panel-muted">Current: </span>
                <span className="text-white">
                  {ubuntuRelease.current.pretty || ubuntuRelease.current.version}
                </span>
              </li>
            )}
            {ubuntuRelease.nextTarget ? (
              <li>
                <span className="text-panel-muted">Next step: </span>
                <span className="text-white">{ubuntuRelease.nextTarget.label}</span>
                <span className="text-panel-muted">
                  {" "}
                  · release offered:{" "}
                  {ubuntuRelease.upgradeAvailable ? "yes" : "not yet / check failed"}
                </span>
              </li>
            ) : (
              <li className="text-emerald-400">
                No further LTS in-place upgrade from Qadbak on this version.
              </li>
            )}
            {ubuntuRelease.finalTarget && ubuntuRelease.current?.version === "22.04" && (
              <li className="text-panel-muted">
                To reach {ubuntuRelease.finalTarget.label}: upgrade to 24.04 first,
                reboot, then run this again for 26.04.
              </li>
            )}
            {ubuntuRelease.preflightIssues.length > 0 && (
              <li>
                <span className="text-panel-muted">Preflight: </span>
                <ul className="mt-1 list-disc pl-5 text-amber-400">
                  {ubuntuRelease.preflightIssues.map((issue) => (
                    <li key={issue}>{issue}</li>
                  ))}
                </ul>
              </li>
            )}
            {ubuntuRelease.preflightOk && ubuntuRelease.nextTarget && (
              <li className="text-emerald-400">Preflight passed - ready to upgrade.</li>
            )}
            <li className="text-panel-muted">
              Disk free on /: {ubuntuRelease.diskFreeMb ?? " - "} MB · Checked:{" "}
              {formatTime(ubuntuRelease.checkedAt)}
            </li>
          </ul>
        )}
        {ubuntuLog && (
          <pre className="mt-4 max-h-64 overflow-auto rounded-lg border border-panel-border bg-panel-bg p-3 text-xs text-panel-muted">
            {ubuntuLog}
          </pre>
        )}
      </Card>

      <Card>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-lg font-medium text-white">Qadbak application</h2>
          <div className="flex flex-wrap gap-2">
            <Button
              variant="secondary"
              disabled={loading || !available || !!qadbakJobId}
              onClick={() => post("qadbak", "refresh")}
            >
              {acting === "qadbak-refresh" ? "Checking…" : "Check for updates"}
            </Button>
            <Button
              disabled={loading || !available || !!qadbakJobId}
              onClick={() => {
                if (
                  !window.confirm(
                    "Run update-qadbak.sh (git pull, npm build, pm2 restart)? Panel data is backed up first.",
                  )
                ) {
                  return;
                }
                void post("qadbak", "upgrade");
              }}
            >
              {acting === "qadbak-upgrade" || qadbakJobId
                ? "Updating…"
                : qadbak?.originVersion &&
                    qadbak.originVersion !== qadbak.version
                  ? `Update to v${qadbak.originVersion}`
                  : qadbak?.behind && qadbak.behind > 0
                    ? "Pull latest commits"
                    : "Update Qadbak"}
            </Button>
          </div>
        </div>
        <p className="mt-1 text-sm text-panel-muted">
          Pulls from git origin, then runs scripts/update-qadbak.sh (npm build,
          pm2 restart). Backs up users.json and native-domains.json first. After
          the update this page shows the new version and changelog.
        </p>
        {backupNote && (
          <p className="mt-2 text-sm text-emerald-400">{backupNote}</p>
        )}
        {qadbak && (
          <ul className="mt-4 space-y-2 text-sm">
            {(qadbak.version || qadbak.originVersion) && (
              <li>
                <span className="text-panel-muted">Installed: </span>
                <span className="text-white">
                  {qadbak.version ? `v${qadbak.version}` : "unknown"}
                </span>
                {qadbak.originVersion &&
                  qadbak.originVersion !== qadbak.version && (
                    <span className="text-amber-400">
                      {" "}
                      · origin has v{qadbak.originVersion}
                    </span>
                  )}
                {qadbak.upToDate && qadbak.version && (
                  <span className="text-emerald-400"> · up to date</span>
                )}
              </li>
            )}
            {!qadbak.isGit && (
              <li className="text-panel-muted">{qadbak.message ?? "Not a git repo."}</li>
            )}
            {qadbak.isGit && (
              <>
                <li>
                  <span className="text-panel-muted">Commit: </span>
                  <code className="text-white">{qadbak.commit}</code>
                  <span className="text-panel-muted"> ({qadbak.branch})</span>
                </li>
                {qadbak.remoteUrl && (
                  <li className="text-panel-muted truncate">Origin: {qadbak.remoteUrl}</li>
                )}
                <li>
                  <span className="text-panel-muted">Behind origin: </span>
                  <span className="text-white">
                    {qadbak.behind === -1
                      ? "Could not fetch"
                      : qadbak.behind === 0
                        ? qadbak.diverged
                          ? "Diverged (local commits not on origin)"
                          : "Up to date"
                        : `${qadbak.behind} commit(s)`}
                  </span>
                </li>
                {qadbak.releasesUrl && (
                  <li>
                    <a
                      href={qadbak.releasesUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="text-panel-accent hover:underline"
                    >
                      GitHub releases
                    </a>
                  </li>
                )}
                <li className="text-panel-muted">
                  Checked: {formatTime(qadbak.checkedAt)}
                </li>
              </>
            )}
          </ul>
        )}
        {qadbak?.changelog && (
          <div className="mt-4 rounded-lg border border-panel-border bg-panel-bg p-3">
            <p className="text-sm font-medium text-white">
              {qadbak.changelogVersion
                ? `v${qadbak.changelogVersion}`
                : "Latest notes"}
              {qadbak.changelogDate ? ` · ${qadbak.changelogDate}` : ""}
              {qadbak.originVersion &&
              qadbak.version &&
              qadbak.originVersion !== qadbak.version
                ? " on origin — Update Qadbak to install"
                : ""}
            </p>
            <pre className="mt-2 max-h-56 overflow-auto whitespace-pre-wrap text-xs text-panel-muted">
              {qadbak.changelog}
            </pre>
          </div>
        )}
        {qadbakLog && (
          <pre className="mt-4 max-h-64 overflow-auto rounded-lg border border-panel-border bg-panel-bg p-3 text-xs text-panel-muted">
            {qadbakLog}
          </pre>
        )}
      </Card>
    </div>
  );
}
