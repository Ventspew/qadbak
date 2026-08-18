"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { Sidebar } from "@/components/sidebar/Sidebar";
import { PanelFooter } from "@/components/PanelFooter";
import { Button } from "@/components/ui";

interface AppShellProps {
  children: React.ReactNode;
  username: string;
  role: "admin" | "client";
  brandName?: string;
  logoUrl?: string | null;
  demoBanner?: boolean;
  unlockedPremium?: string[];
}

export function AppShell({
  children,
  username,
  role,
  brandName,
  logoUrl,
  demoBanner,
  unlockedPremium = [],
}: AppShellProps) {
  const pathname = usePathname();
  const router = useRouter();

  async function logout() {
    await fetch("/api/auth/logout", { method: "POST" });
    router.push("/login");
    router.refresh();
  }

  const pageTitle = pageTitleFromPath(pathname);

  return (
    <div className="flex min-h-screen bg-panel-bg">
      <Sidebar
        role={role}
        brandName={brandName}
        logoUrl={logoUrl}
        unlockedPremium={unlockedPremium}
      />
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-30 border-b border-panel-border bg-panel-bg/90 backdrop-blur-md">
          <div className="flex items-center justify-between gap-4 px-4 py-3 pl-16 lg:pl-6">
            <div className="min-w-0">
              {pageTitle ? (
                <p className="truncate text-sm font-medium text-panel-text">
                  {pageTitle}
                </p>
              ) : null}
            </div>
            <div className="flex shrink-0 items-center gap-3 text-sm">
              <Link
                href="/account/security"
                className="hidden text-panel-muted hover:text-panel-text sm:inline"
              >
                Security
              </Link>
              <span className="hidden text-panel-muted md:inline">
                {username}
                <span className="ml-1.5 rounded-md bg-panel-card px-1.5 py-0.5 text-xs ring-1 ring-panel-border">
                  {role === "admin" ? "admin" : "client"}
                </span>
              </span>
              <Button variant="ghost" onClick={logout} className="px-2 py-1.5">
                Sign out
              </Button>
            </div>
          </div>
        </header>
        {demoBanner ? (
          <div className="border-b border-amber-500/30 bg-amber-500/10 px-4 py-2 text-center text-sm text-amber-100">
            Live demo - read-only. Changes are blocked.{" "}
            <a
              href="https://qadbak.com/#install"
              className="underline hover:text-white"
            >
              Install on your VPS
            </a>{" "}
            to run your own panel.
          </div>
        ) : null}
        <main className="flex-1 px-4 py-6 lg:px-8 lg:py-8">
          <div className="mx-auto w-full max-w-7xl">{children}</div>
        </main>
        <div className="border-t border-panel-border px-4 py-6 lg:px-8">
          <div className="mx-auto w-full max-w-7xl">
            <PanelFooter />
          </div>
        </div>
      </div>
    </div>
  );
}

function pageTitleFromPath(pathname: string): string | null {
  if (pathname === "/dashboard") return "Dashboard";
  if (pathname === "/domains") return "Domains";
  if (pathname.startsWith("/domains/") && pathname.includes("/")) {
    const parts = pathname.split("/").filter(Boolean);
    if (parts.length >= 2) return parts[1];
  }
  if (pathname.startsWith("/admin")) {
    const segment = pathname.split("/").filter(Boolean).pop();
    if (segment === "admin") return "Server admin";
    return segment?.replace(/-/g, " ") ?? "Server admin";
  }
  if (pathname.startsWith("/account")) return "Account";
  if (pathname.startsWith("/settings")) return "Settings";
  return null;
}
