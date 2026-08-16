/**
 * Searchable registry of panel settings pages (admin + account).
 */

export interface SettingsEntry {
  id: string;
  title: string;
  description: string;
  href: string;
  category: string;
  keywords?: string[];
  adminOnly?: boolean;
  premium?: string;
}

export const SETTINGS_ENTRIES: SettingsEntry[] = [
  {
    id: "account-security",
    title: "Account security",
    description: "Password, two-factor authentication, and session security for your login.",
    href: "/account/security",
    category: "Account",
    keywords: ["2fa", "totp", "password", "login"],
  },
  {
    id: "branding",
    title: "Branding",
    description: "Panel name, logo, colors, and white-label appearance.",
    href: "/admin/branding",
    category: "Panel",
    keywords: ["logo", "theme", "white label"],
    adminOnly: true,
    premium: "white-label",
  },
  {
    id: "policy",
    title: "Panel policy",
    description: "Demo mode, client restrictions, and global panel behavior rules.",
    href: "/admin/policy",
    category: "Panel",
    adminOnly: true,
    keywords: ["demo", "clients", "rbac"],
  },
  {
    id: "privacy",
    title: "Privacy and data",
    description: "What stays on your VPS, license heartbeat, audit export, and data handling.",
    href: "/admin/privacy",
    category: "Panel",
    adminOnly: true,
    keywords: ["gdpr", "audit", "export", "license"],
  },
  {
    id: "totp-policy",
    title: "Two-factor policy",
    description: "Require TOTP for admin accounts and manage server-wide 2FA rules.",
    href: "/admin/totp",
    category: "Security",
    adminOnly: true,
    keywords: ["2fa", "totp", "admins"],
  },
  {
    id: "system",
    title: "System features",
    description: "Enable or disable global features and module toggles for the panel.",
    href: "/admin/system",
    category: "Server",
    adminOnly: true,
  },
  {
    id: "stack",
    title: "Stack configuration",
    description: "Web server, PHP, mail, and database stack defaults for new domains.",
    href: "/admin/stack",
    category: "Server",
    adminOnly: true,
    keywords: ["nginx", "apache", "php", "mariadb"],
  },
  {
    id: "license",
    title: "License",
    description: "Premium activation, feature entitlements, and license heartbeat status.",
    href: "/admin/license",
    category: "Billing",
    adminOnly: true,
    keywords: ["premium", "subscription"],
  },
  {
    id: "plans",
    title: "Hosting plans",
    description: "Disk, bandwidth, and feature limits assigned to client accounts.",
    href: "/admin/plans",
    category: "Billing",
    adminOnly: true,
  },
  {
    id: "api-keys",
    title: "API keys",
    description: "Programmatic access tokens for automation and integrations.",
    href: "/admin/api-keys",
    category: "Access",
    adminOnly: true,
  },
  {
    id: "admins",
    title: "Administrators",
    description: "Panel admin accounts, roles, and access control.",
    href: "/admin/admins",
    category: "Access",
    adminOnly: true,
    keywords: ["users"],
  },
  {
    id: "resellers",
    title: "Resellers",
    description: "Reseller accounts and delegated client management.",
    href: "/admin/resellers",
    category: "Access",
    adminOnly: true,
  },
  {
    id: "cloud",
    title: "Cloud storage (S3)",
    description: "Off-site backup credentials and S3-compatible storage settings.",
    href: "/admin/cloud",
    category: "Backups",
    adminOnly: true,
    keywords: ["s3", "backup", "aws"],
    premium: "offsite-backup",
  },
  {
    id: "networking",
    title: "Networking",
    description: "Host network interfaces, IPs, and routing overview.",
    href: "/admin/networking",
    category: "Network",
    adminOnly: true,
  },
  {
    id: "firewall",
    title: "Firewall",
    description: "UFW or firewalld rules and open ports on this server.",
    href: "/admin/firewall",
    category: "Network",
    adminOnly: true,
  },
  {
    id: "updates",
    title: "Panel updates",
    description: "Upgrade Qadbak, OS packages, and Ubuntu LTS release hops.",
    href: "/admin/updates",
    category: "Maintenance",
    adminOnly: true,
    premium: "admin-updates",
  },
  {
    id: "discord",
    title: "Discord bot",
    description: "Invite a hosted Discord bot, assign no-code tasks, and get host DMs.",
    href: "/admin/discord",
    category: "Server",
    adminOnly: true,
    keywords: ["discord", "bot", "notify", "dm", "slash"],
  },
];

export function settingsForRole(role: "admin" | "client"): SettingsEntry[] {
  return SETTINGS_ENTRIES.filter((e) => !e.adminOnly || role === "admin");
}

export function filterSettings(
  entries: SettingsEntry[],
  query: string,
): SettingsEntry[] {
  const q = query.trim().toLowerCase();
  if (!q) return entries;
  return entries.filter((e) => {
    if (e.title.toLowerCase().includes(q)) return true;
    if (e.description.toLowerCase().includes(q)) return true;
    if (e.category.toLowerCase().includes(q)) return true;
    return e.keywords?.some((k) => k.includes(q)) ?? false;
  });
}

export function settingsCategories(entries: SettingsEntry[]): string[] {
  return [...new Set(entries.map((e) => e.category))];
}
