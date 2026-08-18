import {
  demoReadOnlyEnabled,
  demoShowcaseDomain,
  isDemoUser,
} from "./demo-mode";

export function demoSandboxActive(username: string | null | undefined): boolean {
  return demoReadOnlyEnabled() && isDemoUser(username);
}

export function demoSandboxLabel(): string {
  return demoShowcaseDomain();
}

type SessionLike = { username: string };

export function demoGlobalToolMock(
  action: string,
  _payload?: Record<string, unknown>,
): Record<string, unknown> {
  const showcase = demoShowcaseDomain();
  switch (action) {
    case "system-awstats-summary":
      return {
        ok: true,
        awstatsInstalled: true,
        domains: [
          {
            domain: showcase,
            configured: true,
            enabled: true,
            configPath: "(demo sample)",
            dataDir: "(demo sample)",
          },
        ],
        total: 1,
        configured: 1,
        demoSandbox: true,
      };
    case "domain-health-batch":
      return {
        ok: true,
        domains: [
          {
            domain: showcase,
            disabled: false,
            sslDaysLeft: 90,
            backupAgeDays: 1,
            diskUsedMb: 256,
            diskLimitMb: 5120,
            websiteOk: true,
            dnsPending: false,
            localWebsiteOk: true,
            mailOk: true,
            type: "top",
            containersStopped: [],
            actions: [],
          },
        ],
        demoSandbox: true,
      };
    case "system-cron-list":
      return {
        ok: true,
        jobs: [
          {
            schedule: "0 3 * * *",
            command: "qadbak-demo-backup showcase",
            raw: "0 3 * * * qadbak-demo-backup showcase",
          },
        ],
        scope: "demo",
        demoSandbox: true,
      };
    case "system-network-summary":
      return {
        ok: true,
        interfaces: [
          {
            name: "eth0",
            state: "UP",
            addresses: [{ family: "inet", address: "203.0.113.10", prefix: 24, scope: "global" }],
          },
        ],
        defaultRoute: "default via 203.0.113.1 dev eth0",
        primaryIpv4: "203.0.113.10",
        originIp: "203.0.113.10",
        demoSandbox: true,
      };
    case "panel-policy-get":
      return {
        ok: true,
        policy: { requireClientTotp: false, allowWeakPasswords: false },
        demoSandbox: true,
      };
    case "nodes-health":
    case "nodes-ping-health":
      return { ok: true, nodes: [], demoSandbox: true };
    default:
      return { ok: true, demoSandbox: true, action, note: "Demo sample data only." };
  }
}

export function demoVmStatusMock() {
  const showcase = demoShowcaseDomain();
  return {
    mode: "native",
    provisioner: "native",
    legacyApiConfigured: false,
    legacyApiUrl: "",
    tlsInsecure: false,
    mock: false,
    probeStatus: 0,
    probeBytes: 0,
    probePreview: "Demo panel — production domains hidden",
    domainCount: 1,
    domains: [showcase],
    services: [],
    nginxTest: { ok: true, output: "demo" },
    demoSandbox: true,
  };
}

export function demoAuditMock() {
  return {
    entries: [
      {
        at: new Date().toISOString(),
        username: "demo",
        action: "login",
        detail: "demo panel",
        ip: "203.0.113.1",
      },
    ],
    scannedLines: 1,
    stats: { failedLogins: 0, logins: 1 },
    demoSandbox: true,
  };
}

export function demoHostMetricsMock() {
  return {
    metrics: {
      cpuPercent: 12,
      memoryUsedMb: 2048,
      memoryTotalMb: 8192,
      diskUsedPercent: 34,
      loadAvg: [0.15, 0.12, 0.1],
      uptimeSec: 864000,
      demoSandbox: true,
    },
  };
}

export function demoServerServicesMock() {
  return {
    bandwidth: [{ domain: demoShowcaseDomain(), mb: 48, limit: 5120 }],
    bandwidthSource: "demo",
    services: [
      { name: "nginx", status: "running" },
      { name: "postfix", status: "running" },
    ],
    servicesSource: "demo",
    demoSandbox: true,
  };
}

export function demoSecuritySnapshotMock() {
  return {
    firewall: { ruleCount: 4, preview: "Demo — ufw status sample" },
    fail2ban: { jailCount: 1, jails: ["sshd"], preview: "Demo fail2ban sample" },
    demoSandbox: true,
  };
}

export function demoJournalMock() {
  return {
    entries: [],
    total: 0,
    demoSandbox: true,
  };
}

export function demoFirewallMock() {
  return {
    ok: true,
    raw: "Status: active (demo sample)\nTo                         Action      From\n--                         ------      ----\n22/tcp                     ALLOW       Anywhere\n80/tcp                     ALLOW       Anywhere\n443/tcp                    ALLOW       Anywhere",
    rules: ["22/tcp ALLOW", "80/tcp ALLOW", "443/tcp ALLOW"],
    demoSandbox: true,
  };
}

export function demoFail2banMock() {
  return {
    ok: true,
    raw: "Status\n|- Number of jail:\t1\n`- Jail list:\tsshd (demo sample)",
    demoSandbox: true,
  };
}

export function demoMetricsHistoryMock(hours: number) {
  return {
    history: [],
    hours,
    demoSandbox: true,
  };
}

export function demoNodesMock() {
  return {
    nodes: [],
    health: [],
    defaultNodeId: "",
    multiServerEnabled: false,
    provisioner: "native",
    demoSandbox: true,
  };
}

export async function demoPrivacyReportMock() {
  const showcase = demoShowcaseDomain();
  return {
    generatedAt: new Date().toISOString(),
    posture: "mock" as const,
    summary: "Demo panel — no production VPS telemetry is shown.",
    staysOnVps: ["Demo credentials", `Sample domain ${showcase}`],
    outbound: [],
    session: { cookieSecure: "true", installSalt: true },
    license: { configured: false, status: "demo" },
    storage: {
      auditLogPath: "(demo)",
      auditLogBytes: 0,
      usersPath: "(demo)",
      licensePath: "(demo)",
      cloudCredentialsConfigured: false,
      alertRulesConfigured: false,
      apiKeysCount: 0,
    },
    hardening: {
      loginRateLimit: true,
      apiKeysWithIpAllowlist: 0,
      terminalWsLocalOnly: true,
      failedLogins24h: 0,
      totpUsers: 0,
    },
    auditRetention: { enabled: true, maxBytes: 0, maxAgeDays: 90 },
    envHints: [],
    recommendations: [],
    demoSandbox: true,
  };
}
