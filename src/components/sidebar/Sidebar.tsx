"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Activity,
  AppWindow,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Box,
  Cloud,
  FileKey,
  Flame,
  Globe,
  HardDrive,
  HeartPulse,
  KeyRound,
  LayoutDashboard,
  Lock,
  Menu,
  MessageCircle,
  Network,
  Package,
  Palette,
  ScrollText,
  Search,
  Server,
  Settings,
  Shield,
  Terminal,
  Timer,
  Users,
  X,
  type LucideIcon,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { APP_NAME, DEFAULT_LOGO_PATH } from "@/lib/brand";
import {
  filterSidebarItems,
  isSidebarCategoryActive,
  isSidebarItemActive,
  sidebarCategoriesForRole,
  type SidebarCategory,
  type SidebarNavItem,
} from "@/lib/navigation";
import { PremiumNavLock } from "@/lib/premium/stubs";
import { Input } from "@/components/ui";

const STORAGE_COLLAPSED = "qadbak-sidebar-collapsed";
const STORAGE_OPEN_CATS = "qadbak-sidebar-open-categories";

const ITEM_ICONS: Record<string, LucideIcon> = {
  dashboard: LayoutDashboard,
  domains: Globe,
  "app-store": Package,
  "admin-overview": Server,
  status: Activity,
  discord: MessageCircle,
  health: HeartPulse,
  system: Server,
  services: AppWindow,
  stack: HardDrive,
  updates: Package,
  journal: ScrollText,
  cron: Timer,
  awstats: Activity,
  terminal: Terminal,
  nodes: Server,
  networking: Network,
  firewall: Flame,
  activity: Activity,
  admins: Users,
  resellers: Users,
  plans: FileKey,
  templates: ScrollText,
  "api-keys": KeyRound,
  license: Lock,
  cloud: Cloud,
  docker: Box,
  "account-security": Shield,
  branding: Palette,
  policy: Settings,
  privacy: Shield,
  "totp-policy": Lock,
};

const CATEGORY_ICONS: Record<string, LucideIcon> = {
  overview: LayoutDashboard,
  applications: Package,
  containers: Box,
  server: Server,
  networking: Network,
  management: Users,
  settings: Settings,
  "settings-hub": Settings,
};

function readOpenCategories(): Record<string, boolean> {
  if (typeof window === "undefined") return {};
  try {
    const raw = localStorage.getItem(STORAGE_OPEN_CATS);
    if (!raw) return {};
    const ids = JSON.parse(raw) as string[];
    return Object.fromEntries(ids.map((id) => [id, true]));
  } catch {
    return {};
  }
}

function writeOpenCategories(open: Record<string, boolean>) {
  const ids = Object.entries(open)
    .filter(([, v]) => v)
    .map(([k]) => k);
  localStorage.setItem(STORAGE_OPEN_CATS, JSON.stringify(ids));
}

export function Sidebar({
  role,
  brandName,
  logoUrl,
  unlockedPremium = [],
}: {
  role: "admin" | "client";
  brandName?: string;
  logoUrl?: string | null;
  unlockedPremium?: string[];
}) {
  const pathname = usePathname();
  const title = brandName ?? APP_NAME;
  const categories = useMemo(() => sidebarCategoriesForRole(role), [role]);
  const unlocked = useMemo(() => new Set(unlockedPremium), [unlockedPremium]);

  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [openCats, setOpenCats] = useState<Record<string, boolean>>({});

  useEffect(() => {
    const stored = localStorage.getItem(STORAGE_COLLAPSED);
    if (stored === "1") setCollapsed(true);
    setOpenCats(readOpenCategories());
  }, []);

  useEffect(() => {
    setOpenCats((prev) => {
      const next = { ...prev };
      for (const cat of categories) {
        if (isSidebarCategoryActive(pathname, cat)) {
          next[cat.id] = true;
        }
      }
      writeOpenCategories(next);
      return next;
    });
  }, [pathname, categories]);

  const searchResults = useMemo(
    () => filterSidebarItems(categories, search),
    [categories, search],
  );

  const toggleCollapsed = useCallback(() => {
    setCollapsed((c) => {
      const next = !c;
      localStorage.setItem(STORAGE_COLLAPSED, next ? "1" : "0");
      return next;
    });
  }, []);

  const toggleCategory = useCallback((id: string) => {
    setOpenCats((prev) => {
      const next = { ...prev, [id]: !prev[id] };
      writeOpenCategories(next);
      return next;
    });
  }, []);

  const navContent = (
    <div className="flex h-full flex-col">
      <div
        className={`flex items-center border-b border-panel-border px-3 py-4 ${
          collapsed ? "justify-center" : "gap-3"
        }`}
      >
        <Link
          href="/dashboard"
          className={`flex items-center gap-2.5 font-semibold text-panel-text ${
            collapsed ? "justify-center" : ""
          }`}
          title={title}
          onClick={() => setMobileOpen(false)}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={logoUrl ?? DEFAULT_LOGO_PATH}
            alt=""
            className={
              logoUrl
                ? "h-8 w-auto max-w-[100px]"
                : "h-8 w-8 shrink-0 rounded-md"
            }
          />
          {!collapsed ? <span className="truncate text-sm">{title}</span> : null}
        </Link>
        {!collapsed ? (
          <button
            type="button"
            className="ml-auto hidden rounded-md p-1.5 text-panel-muted hover:bg-panel-card hover:text-panel-text lg:inline-flex"
            onClick={toggleCollapsed}
            aria-label="Collapse sidebar"
          >
            <ChevronLeft className="h-4 w-4" />
          </button>
        ) : null}
      </div>

      {!collapsed ? (
        <div className="border-b border-panel-border px-3 py-3">
          <div className="relative">
            <Search className="pointer-events-none absolute left-2.5 top-2.5 h-4 w-4 text-panel-muted" />
            <Input
              type="search"
              placeholder="Find a page…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-9"
              aria-label="Search navigation"
            />
          </div>
          {search.trim() ? (
            <ul className="mt-2 max-h-48 space-y-0.5 overflow-y-auto">
              {searchResults.length === 0 ? (
                <li className="px-2 py-2 text-xs text-panel-muted">No matches</li>
              ) : (
                searchResults.map((item) => (
                  <SidebarLink
                    key={item.id}
                    item={item}
                    pathname={pathname}
                    unlocked={unlocked}
                    collapsed={false}
                    onNavigate={() => {
                      setMobileOpen(false);
                      setSearch("");
                    }}
                  />
                ))
              )}
            </ul>
          ) : null}
        </div>
      ) : null}

      <nav
        className="flex-1 overflow-y-auto px-2 py-3"
        aria-label="Main navigation"
      >
        {search.trim() ? null : (
          <div className="space-y-1">
            {categories.map((cat) => (
              <SidebarCategoryBlock
                key={cat.id}
                category={cat}
                pathname={pathname}
                collapsed={collapsed}
                open={openCats[cat.id] ?? false}
                onToggle={() => toggleCategory(cat.id)}
                unlocked={unlocked}
                onNavigate={() => setMobileOpen(false)}
              />
            ))}
          </div>
        )}
      </nav>

      {collapsed ? (
        <div className="hidden border-t border-panel-border p-2 lg:block">
          <button
            type="button"
            className="flex w-full items-center justify-center rounded-md p-2 text-panel-muted hover:bg-panel-card hover:text-panel-text"
            onClick={toggleCollapsed}
            aria-label="Expand sidebar"
            title="Expand sidebar"
          >
            <ChevronRight className="h-4 w-4" />
          </button>
        </div>
      ) : null}
    </div>
  );

  return (
    <>
      <button
        type="button"
        className="fixed left-4 top-4 z-40 rounded-lg border border-panel-border bg-panel-card p-2 text-panel-text shadow-lg lg:hidden"
        onClick={() => setMobileOpen(true)}
        aria-label="Open menu"
      >
        <Menu className="h-5 w-5" />
      </button>

      {mobileOpen ? (
        <button
          type="button"
          className="fixed inset-0 z-40 bg-black/60 lg:hidden"
          aria-label="Close menu overlay"
          onClick={() => setMobileOpen(false)}
        />
      ) : null}

      <aside
        className={`fixed inset-y-0 left-0 z-50 flex w-72 flex-col border-r border-panel-border bg-panel-card/95 backdrop-blur-sm transition-transform lg:static lg:z-auto lg:translate-x-0 ${
          mobileOpen ? "translate-x-0" : "-translate-x-full"
        } ${collapsed ? "lg:w-[4.25rem]" : "lg:w-72"}`}
      >
        <button
          type="button"
          className="absolute right-3 top-4 rounded-md p-1 text-panel-muted hover:text-panel-text lg:hidden"
          onClick={() => setMobileOpen(false)}
          aria-label="Close menu"
        >
          <X className="h-5 w-5" />
        </button>
        {navContent}
      </aside>
    </>
  );
}

function SidebarCategoryBlock({
  category,
  pathname,
  collapsed,
  open,
  onToggle,
  unlocked,
  onNavigate,
}: {
  category: SidebarCategory;
  pathname: string;
  collapsed: boolean;
  open: boolean;
  onToggle: () => void;
  unlocked: Set<string>;
  onNavigate: () => void;
}) {
  const CatIcon = CATEGORY_ICONS[category.id] ?? Settings;
  const active = isSidebarCategoryActive(pathname, category);

  if (collapsed) {
    return (
      <ul className="space-y-0.5">
        {category.items.map((item) => (
          <SidebarLink
            key={item.id}
            item={item}
            pathname={pathname}
            unlocked={unlocked}
            collapsed
            onNavigate={onNavigate}
          />
        ))}
      </ul>
    );
  }

  return (
    <div className="rounded-lg">
      <button
        type="button"
        onClick={onToggle}
        className={`flex w-full items-center gap-2 rounded-md px-2 py-2 text-left text-xs font-semibold uppercase tracking-wide ${
          active ? "text-panel-text" : "text-panel-muted"
        } hover:bg-panel-bg/60`}
        aria-expanded={open}
      >
        <CatIcon className="h-4 w-4 shrink-0 opacity-70" aria-hidden />
        <span className="flex-1">{category.label}</span>
        <ChevronDown
          className={`h-4 w-4 shrink-0 transition-transform ${open ? "rotate-180" : ""}`}
          aria-hidden
        />
      </button>
      {open ? (
        <ul className="mb-2 ml-1 space-y-0.5 border-l border-panel-border/60 pl-2">
          {category.items.map((item) => (
            <SidebarLink
              key={item.id}
              item={item}
              pathname={pathname}
              unlocked={unlocked}
              collapsed={false}
              onNavigate={onNavigate}
            />
          ))}
        </ul>
      ) : null}
    </div>
  );
}

function SidebarLink({
  item,
  pathname,
  unlocked,
  collapsed,
  onNavigate,
}: {
  item: SidebarNavItem;
  pathname: string;
  unlocked: Set<string>;
  collapsed: boolean;
  onNavigate: () => void;
}) {
  const active = isSidebarItemActive(pathname, item);
  const locked = item.premium && !unlocked.has(item.premium);
  const Icon = ITEM_ICONS[item.id] ?? Settings;

  return (
    <li>
      <Link
        href={item.href}
        onClick={onNavigate}
        title={collapsed ? item.label : undefined}
        className={`flex items-center gap-2.5 rounded-md px-2 py-2 text-sm transition-colors ${
          active
            ? "bg-panel-accent/15 font-medium text-panel-text ring-1 ring-panel-accent/25"
            : "text-panel-muted hover:bg-panel-bg/80 hover:text-panel-text"
        } ${collapsed ? "justify-center px-2" : ""}`}
      >
        <Icon className="h-4 w-4 shrink-0 opacity-80" aria-hidden />
        {!collapsed ? (
          <>
            <span className="truncate">{item.label}</span>
            {locked ? <PremiumNavLock /> : null}
          </>
        ) : null}
      </Link>
    </li>
  );
}
