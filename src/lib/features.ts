import type { Role } from "./types";

/** Mirrors provisioner/native-stub (no import — keeps client bundles free of hosting-remote). */
function independentHostingFromEnv(): boolean {
  const prov = process.env.QADBAK_PROVISIONER?.trim().toLowerCase();
  const fb = process.env.QADBAK_LEGACY_API_FALLBACK?.trim().toLowerCase();
  const fallbackOff = fb === "false" || fb === "0" || fb === "no";
  return prov === "native" || (prov === "hybrid" && fallbackOff);
}

export type FeaturePhase = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 | 12;

export interface DomainFeature {
  id: string;
  phase: FeaturePhase;
  label: string;
  description: string;
  path: string; // suffix under /domains/[domain]
  programs: {
    admin: readonly string[];
    client: readonly string[];
  };
  adminOnly?: boolean;
  /** Lower = earlier in domain nav (default 50). */
  navOrder?: number;
  /** Kept for programs/redirects but omitted from domain top nav. */
  hideFromNav?: boolean;
}

/** All legacy hosting API programs used by Qadbak, grouped per feature. */
export const DOMAIN_FEATURES: DomainFeature[] = [
  {
    id: "mail",
    phase: 1,
    label: "Mail",
    description: "Accounts, Qmail, settings, and delivery logs",
    path: "mail",
    navOrder: 10,
    programs: {
      admin: [
        "list-users",
        "create-user",
        "modify-user",
        "delete-user",
        "list-mailbox",
        "copy-mailbox",
        "search-maillogs",
        "resend-email",
        "modify-mail",
      ],
      client: [
        "list-users",
        "create-user",
        "modify-user",
        "delete-user",
        "list-mailbox",
        "search-maillogs",
        "modify-mail",
      ],
    },
  },
  {
    id: "databases",
    phase: 1,
    label: "Databases",
    description: "MySQL / PostgreSQL",
    path: "databases",
    navOrder: 15,
    programs: {
      admin: ["list-databases", "create-database", "modify-database-pass"],
      client: ["list-databases", "create-database", "modify-database-pass"],
    },
  },
  {
    id: "dns",
    phase: 2,
    label: "DNS",
    description: "View and edit DNS records",
    path: "dns",
    programs: {
      admin: ["get-dns", "modify-dns"],
      client: ["get-dns", "modify-dns"],
    },
  },
  {
    id: "ssl",
    phase: 2,
    label: "SSL",
    description: "Certificates and Let's Encrypt",
    path: "ssl",
    programs: {
      admin: [
        "list-certs",
        "list-certs-expiry",
        "generate-letsencrypt-cert",
        "install-cert",
      ],
      client: ["list-certs", "list-certs-expiry", "generate-letsencrypt-cert"],
    },
  },
  {
    id: "aliases",
    phase: 2,
    label: "Aliases",
    description: "Email forwarding and aliases",
    path: "aliases",
    programs: {
      admin: [
        "list-aliases",
        "list-simple-aliases",
        "create-simple-alias",
        "create-alias",
        "delete-alias",
      ],
      client: [
        "list-simple-aliases",
        "create-simple-alias",
        "delete-alias",
      ],
    },
  },
  {
    id: "redirects",
    phase: 2,
    label: "Redirects",
    description: "URL redirects",
    path: "redirects",
    programs: {
      admin: ["list-redirects", "create-redirect", "delete-redirect"],
      client: ["list-redirects", "create-redirect", "delete-redirect"],
    },
  },
  {
    id: "backups",
    phase: 2,
    label: "Backups",
    description: "Qadbak backups — website, mail, databases, restore",
    path: "backups",
    navOrder: 60,
    programs: {
      admin: [
        "backup-domain",
        "list-scheduled-backups",
        "modify-scheduled-backup",
        "restore-domain",
      ],
      client: ["list-scheduled-backups"],
    },
  },
  {
    id: "files",
    phase: 3,
    label: "Files",
    description: "File manager (browser or embedded on live server)",
    path: "files",
    navOrder: 5,
    programs: {
      admin: ["create-login-link"],
      client: ["create-login-link"],
    },
  },
  {
    id: "terminal",
    phase: 3,
    label: "Terminal",
    description: "Native bash in panel (domain unix user)",
    path: "terminal",
    navOrder: 6,
    programs: {
      admin: ["list-domains"],
      client: ["list-domains"],
    },
  },
  {
    id: "logs",
    phase: 3,
    label: "Logs",
    description: "Website access and error logs",
    path: "logs",
    navOrder: 55,
    programs: {
      admin: ["get-logs"],
      client: ["get-logs"],
    },
  },
  {
    id: "php",
    phase: 3,
    label: "PHP",
    description: "PHP versions per directory and php.ini",
    path: "php",
    programs: {
      admin: [
        "list-php-versions",
        "list-php-directories",
        "set-php-directory",
        "delete-php-directory",
        "list-php-ini",
        "modify-php-ini",
      ],
      client: [
        "list-php-versions",
        "list-php-directories",
        "set-php-directory",
        "list-php-ini",
        "modify-php-ini",
      ],
    },
  },
  {
    id: "protected",
    phase: 3,
    label: "Protected directories",
    description: "Password-protected website directories",
    path: "protected",
    programs: {
      admin: [
        "list-protected-directories",
        "create-protected-directory",
        "delete-protected-directory",
        "list-protected-users",
        "create-protected-user",
        "delete-protected-user",
      ],
      client: [
        "list-protected-directories",
        "create-protected-directory",
        "list-protected-users",
        "create-protected-user",
        "delete-protected-user",
      ],
    },
  },
  {
    id: "security",
    phase: 3,
    label: "Spam & DKIM",
    description: "Spam filter and DKIM for email",
    path: "security",
    programs: {
      admin: ["set-spam", "set-dkim", "modify-web"],
      client: ["set-spam", "set-dkim"],
    },
  },
  {
    id: "features",
    phase: 4,
    label: "Features",
    description: "Toggle web, mail, DNS, and database",
    path: "features",
    adminOnly: true,
    programs: {
      admin: ["list-features", "enable-feature", "disable-feature"],
      client: [],
    },
  },
  {
    id: "limits",
    phase: 4,
    label: "Limits",
    description: "Disk, mailboxes, and bandwidth",
    path: "limits",
    adminOnly: true,
    programs: {
      admin: ["modify-limits", "modify-resources"],
      client: [],
    },
  },
  {
    id: "lifecycle",
    phase: 4,
    label: "Lifecycle",
    description: "Delete, migrate, validate",
    path: "lifecycle",
    adminOnly: true,
    programs: {
      admin: [
        "delete-domain",
        "migrate-domain",
        "transfer-domain",
        "clone-domain",
        "validate-domains",
        "check-config",
      ],
      client: [],
    },
  },
  {
    id: "scripts",
    phase: 5,
    label: "Apps",
    description: "One-click CMS installers (WordPress, Joomla, Drupal, …)",
    path: "scripts",
    programs: {
      admin: [
        "list-available-scripts",
        "list-scripts",
        "install-script",
        "delete-script",
      ],
      client: ["list-scripts", "list-available-scripts"],
    },
  },
  {
    id: "media",
    phase: 5,
    label: "Media library",
    description: "Upload folder, disk usage, and Jellyfin streaming link",
    path: "media",
    navOrder: 11,
    programs: {
      admin: ["list-domains"],
      client: ["list-domains"],
    },
  },
  {
    id: "runtimes",
    phase: 5,
    label: "Runtimes",
    description: "PHP-FPM, Node.js, Python, Docker apps",
    path: "runtimes",
    navOrder: 12,
    programs: {
      admin: ["list-domains"],
      client: ["list-domains"],
    },
  },
  {
    id: "proxies",
    phase: 5,
    label: "Proxies",
    description: "Reverse proxy and load balancing",
    path: "proxies",
    programs: {
      admin: ["list-proxies", "create-proxy", "modify-proxy", "delete-proxy"],
      client: ["list-proxies"],
    },
  },
  {
    id: "cron",
    phase: 5,
    label: "Cron",
    description: "Scheduled tasks (cron)",
    path: "cron",
    programs: {
      admin: ["list-cron-jobs", "create-cron-job", "delete-cron-job"],
      client: ["list-cron-jobs"],
    },
  },
  {
    id: "ftp",
    phase: 6,
    label: "FTP",
    description: "FTP accounts for this domain",
    path: "ftp",
    programs: {
      admin: ["list-users", "create-user", "modify-user", "delete-user"],
      client: ["list-users", "create-user", "modify-user", "delete-user"],
    },
  },
  {
    id: "shared",
    phase: 6,
    label: "Shared addresses",
    description: "Shared email address for multiple users",
    path: "shared",
    programs: {
      admin: [
        "list-shared-addresses",
        "create-shared-address",
        "delete-shared-address",
      ],
      client: ["list-shared-addresses"],
    },
  },
  {
    id: "tools",
    phase: 9,
    label: "Site tools",
    description:
      "Deliverability, analytics, deployments, staging, support tickets, and more",
    path: "tools",
    navOrder: 20,
    programs: {
      admin: ["list-domains"],
      client: ["list-domains"],
    },
  },
];

/** Server-wide legacy hosting API programs (phase 7, admin only). */
export const ADMIN_SERVER_PROGRAMS = [
  "list-bandwidth",
  "list-server-statuses",
  "restart-server",
  "list-resellers",
  "create-reseller",
  "modify-reseller",
  "delete-reseller",
  "list-plans",
  "create-plan",
  "modify-plan",
  "delete-plan",
  "list-templates",
  "get-template",
  "modify-template",
  "list-admins",
  "create-admin",
  "modify-admin",
  "delete-admin",
  "license-info",
  "setup-repos",
] as const;

/** Cloud & advanced system programs (phase 8, admin only). */
export const ADMIN_CLOUD_PROGRAMS = [
  "modify-scheduled-backup",
  "restore-domain",
  "list-s3-buckets",
  "list-s3-files",
  "upload-s3-file",
  "config-system",
  "set-global-feature",
  "list-global-features",
] as const;

export const IMPLEMENTED_PHASE: FeaturePhase = 12;

/** Primary server admin — no server admin embed menus (phase 4). */
export const ADMIN_NAV = [
  { path: "/admin", label: "Overview" },
  { path: "/admin/privacy", label: "Privacy & data" },
  { path: "/admin/totp", label: "Two-factor" },
  { path: "/admin/terminal", label: "Terminal" },
  { path: "/admin/updates", label: "Updates", premium: "admin-updates" as const },
  { path: "/admin/status", label: "Status" },
  { path: "/admin/discord", label: "Discord" },
  { path: "/admin/system", label: "System" },
  { path: "/admin/networking", label: "Networking" },
  { path: "/admin/health", label: "Health" },
  { path: "/admin/journal", label: "Journal" },
  { path: "/admin/audit", label: "Activity log" },
  { path: "/admin/apps", label: "App store" },
  { path: "/admin/nodes", label: "Nodes" },
  { path: "/admin/cron", label: "System cron" },
  { path: "/admin/awstats", label: "AWStats" },
  { path: "/admin/policy", label: "Panel policy" },
  { path: "/admin/server", label: "Services" },
  { path: "/admin/stack", label: "Stack config" },
  { path: "/admin/resellers", label: "Resellers" },
  { path: "/admin/plans", label: "Plans" },
  { path: "/admin/templates", label: "Templates" },
  { path: "/admin/admins", label: "Administrators" },
  { path: "/admin/license", label: "License" },
  { path: "/admin/branding", label: "Branding", premium: "white-label" as const },
  { path: "/admin/cloud", label: "Cloud (S3)" },
  { path: "/admin/firewall", label: "Firewall" },
  { path: "/admin/api-keys", label: "API keys" },
] as const;

export function adminNavItems(): readonly {
  path: string;
  label: string;
  premium?: string;
}[] {
  return ADMIN_NAV;
}

const GLOBAL_ADMIN_BASE = [
  "list-domains",
  "create-domain",
  "clone-domain",
  "delete-domain",
  "migrate-domain",
  "transfer-domain",
  "disable-domain",
  "enable-domain",
  "create-login-link",
  "get-command",
  "validate-domains",
  "check-config",
] as const;

export const GLOBAL_PROGRAMS: Record<Role, readonly string[]> = {
  admin: [
    ...GLOBAL_ADMIN_BASE,
    ...(IMPLEMENTED_PHASE >= 7 ? ADMIN_SERVER_PROGRAMS : []),
    ...(IMPLEMENTED_PHASE >= 8 ? ADMIN_CLOUD_PROGRAMS : []),
  ],
  client: ["list-domains", "create-login-link"],
};

export function programsForRole(role: Role): readonly string[] {
  const fromFeatures = DOMAIN_FEATURES.filter((f) => f.phase <= IMPLEMENTED_PHASE)
    .flatMap((f) => (role === "admin" ? f.programs.admin : f.programs.client));
  return [...new Set([...GLOBAL_PROGRAMS[role], ...fromFeatures])];
}

export function featuresForDomain(role: Role, isAdmin: boolean): DomainFeature[] {
  return DOMAIN_FEATURES.filter((f) => {
    if (f.hideFromNav) return false;
    if (f.phase > IMPLEMENTED_PHASE) return false;
    if (f.adminOnly && !isAdmin) return false;
    const progs = isAdmin ? f.programs.admin : f.programs.client;
    return progs.length > 0;
  }).sort(
    (a, b) => (a.navOrder ?? 50) - (b.navOrder ?? 50) || a.label.localeCompare(b.label, "en"),
  );
}

export function featureByPath(path: string): DomainFeature | undefined {
  return DOMAIN_FEATURES.find((f) => f.path === path);
}
