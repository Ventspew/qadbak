/**
 * Panel sidebar navigation — maps only to routes that exist in the app.
 * Source of truth for categories; admin flat list remains in features.ts for API compat.
 */

export type SidebarMatch = "exact" | "prefix";

export interface SidebarNavItem {
  id: string;
  label: string;
  href: string;
  premium?: string;
  match?: SidebarMatch;
  keywords?: string[];
  adminOnly?: boolean;
}

export interface SidebarCategory {
  id: string;
  label: string;
  adminOnly?: boolean;
  items: SidebarNavItem[];
}

export const SIDEBAR_CATEGORIES: SidebarCategory[] = [
  {
    id: "overview",
    label: "Overview",
    items: [
      {
        id: "dashboard",
        label: "Dashboard",
        href: "/dashboard",
        match: "exact",
        keywords: ["home", "start"],
      },
      {
        id: "domains",
        label: "Domains",
        href: "/domains",
        match: "prefix",
        keywords: ["websites", "hosting", "sites"],
      },
    ],
  },
  {
    id: "applications",
    label: "Applications",
    adminOnly: true,
    items: [
      {
        id: "app-store",
        label: "App store",
        href: "/admin/apps",
        match: "prefix",
        keywords: ["install", "wordpress", "apps"],
      },
    ],
  },
  {
    id: "containers",
    label: "Containers",
    adminOnly: true,
    items: [
      {
        id: "docker",
        label: "Docker",
        href: "/admin/docker",
        match: "prefix",
        keywords: ["containers", "compose", "images", "volumes"],
      },
    ],
  },
  {
    id: "server",
    label: "Server",
    adminOnly: true,
    items: [
      {
        id: "admin-overview",
        label: "Admin overview",
        href: "/admin",
        match: "exact",
        keywords: ["server admin"],
      },
      {
        id: "status",
        label: "System status",
        href: "/admin/status",
        keywords: ["metrics", "alerts"],
      },
      {
        id: "discord",
        label: "Discord",
        href: "/admin/discord",
        keywords: ["bot", "notify", "dm", "oauth", "slash"],
      },
      {
        id: "health",
        label: "Health",
        href: "/admin/health",
      },
      {
        id: "system",
        label: "System",
        href: "/admin/system",
        keywords: ["features", "global"],
      },
      {
        id: "services",
        label: "Services",
        href: "/admin/server",
        keywords: ["apache", "nginx", "postfix"],
      },
      {
        id: "stack",
        label: "Stack config",
        href: "/admin/stack",
      },
      {
        id: "updates",
        label: "Updates",
        href: "/admin/updates",
        premium: "admin-updates",
        keywords: ["upgrade", "git"],
      },
      {
        id: "journal",
        label: "Journal",
        href: "/admin/journal",
      },
      {
        id: "cron",
        label: "System cron",
        href: "/admin/cron",
      },
      {
        id: "awstats",
        label: "AWStats",
        href: "/admin/awstats",
      },
      {
        id: "terminal",
        label: "Terminal",
        href: "/admin/terminal",
        keywords: ["shell", "ssh"],
      },
      {
        id: "nodes",
        label: "Nodes",
        href: "/admin/nodes",
      },
    ],
  },
  {
    id: "networking",
    label: "Networking",
    adminOnly: true,
    items: [
      {
        id: "networking",
        label: "Networking",
        href: "/admin/networking",
      },
      {
        id: "firewall",
        label: "Firewall",
        href: "/admin/firewall",
      },
    ],
  },
  {
    id: "management",
    label: "Management",
    adminOnly: true,
    items: [
      {
        id: "activity",
        label: "Activity log",
        href: "/admin/audit",
        keywords: ["audit", "history"],
      },
      {
        id: "admins",
        label: "Administrators",
        href: "/admin/admins",
        keywords: ["users", "admin users"],
      },
      {
        id: "resellers",
        label: "Resellers",
        href: "/admin/resellers",
      },
      {
        id: "plans",
        label: "Plans",
        href: "/admin/plans",
      },
      {
        id: "templates",
        label: "Templates",
        href: "/admin/templates",
      },
      {
        id: "api-keys",
        label: "API keys",
        href: "/admin/api-keys",
      },
      {
        id: "license",
        label: "License",
        href: "/admin/license",
        keywords: ["premium", "billing"],
      },
      {
        id: "cloud",
        label: "Cloud (S3)",
        href: "/admin/cloud",
      },
    ],
  },
  {
    id: "settings",
    label: "Settings",
    items: [
      {
        id: "settings-hub",
        label: "All settings",
        href: "/settings",
        match: "exact",
        keywords: ["preferences", "configuration"],
      },
      {
        id: "account-security",
        label: "Account security",
        href: "/account/security",
        keywords: ["2fa", "totp", "password"],
      },
      {
        id: "branding",
        label: "Branding",
        href: "/admin/branding",
        premium: "white-label",
        adminOnly: true,
        keywords: ["logo", "theme", "white label"],
      },
      {
        id: "policy",
        label: "Panel policy",
        href: "/admin/policy",
        adminOnly: true,
      },
      {
        id: "privacy",
        label: "Privacy & data",
        href: "/admin/privacy",
        adminOnly: true,
      },
      {
        id: "totp-policy",
        label: "Two-factor policy",
        href: "/admin/totp",
        adminOnly: true,
        keywords: ["2fa", "server"],
      },
    ],
  },
];

/** Flatten categories for a role (client hides adminOnly categories and items). */
export function sidebarCategoriesForRole(
  role: "admin" | "client",
): SidebarCategory[] {
  return SIDEBAR_CATEGORIES.map((cat) => {
    if (cat.adminOnly && role !== "admin") return null;
    const items = cat.items.filter((item) => {
      if (item.adminOnly && role !== "admin") return false;
      return true;
    });
    if (items.length === 0) return null;
    return { ...cat, items };
  }).filter(Boolean) as SidebarCategory[];
}

export function isSidebarItemActive(
  pathname: string,
  item: SidebarNavItem,
): boolean {
  const match = item.match ?? "prefix";
  const hrefPath = item.href.split("#")[0];
  if (match === "exact") {
    return pathname === hrefPath;
  }
  if (hrefPath === "/domains") {
    return pathname === "/domains" || pathname.startsWith("/domains/");
  }
  if (hrefPath === "/admin") {
    return pathname === "/admin";
  }
  return pathname === hrefPath || pathname.startsWith(`${hrefPath}/`);
}

/** Category is active if any child is active. */
export function isSidebarCategoryActive(
  pathname: string,
  category: SidebarCategory,
): boolean {
  return category.items.some((item) => isSidebarItemActive(pathname, item));
}

export function flattenSidebarItems(
  categories: SidebarCategory[],
): SidebarNavItem[] {
  return categories.flatMap((c) => c.items);
}

export function filterSidebarItems(
  categories: SidebarCategory[],
  query: string,
): SidebarNavItem[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  const items = flattenSidebarItems(categories);
  return items.filter((item) => {
    if (item.label.toLowerCase().includes(q)) return true;
    if (item.href.toLowerCase().includes(q)) return true;
    return item.keywords?.some((k) => k.includes(q)) ?? false;
  });
}
