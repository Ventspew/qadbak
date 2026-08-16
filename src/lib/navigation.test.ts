import { describe, expect, it } from "vitest";
import {
  filterSidebarItems,
  isSidebarItemActive,
  sidebarCategoriesForRole,
} from "./navigation";

describe("sidebar navigation", () => {
  it("hides admin-only items for clients", () => {
    const cats = sidebarCategoriesForRole("client");
    const hrefs = cats.flatMap((c) => c.items.map((i) => i.href));
    expect(hrefs).toContain("/dashboard");
    expect(hrefs).not.toContain("/admin/status");
    expect(hrefs).toContain("/settings");
  });

  it("marks dashboard exact match", () => {
    const cats = sidebarCategoriesForRole("admin");
    const dashboard = cats
      .flatMap((c) => c.items)
      .find((i) => i.id === "dashboard")!;
    expect(isSidebarItemActive("/dashboard", dashboard)).toBe(true);
    expect(isSidebarItemActive("/dashboard/extra", dashboard)).toBe(false);
  });

  it("marks domains prefix match", () => {
    const cats = sidebarCategoriesForRole("admin");
    const domains = cats.flatMap((c) => c.items).find((i) => i.id === "domains")!;
    expect(isSidebarItemActive("/domains", domains)).toBe(true);
    expect(isSidebarItemActive("/domains/example.com", domains)).toBe(true);
  });

  it("filters nav search by keyword", () => {
    const cats = sidebarCategoriesForRole("admin");
    const hits = filterSidebarItems(cats, "firewall");
    expect(hits.some((h) => h.href === "/admin/firewall")).toBe(true);
  });

  it("includes Discord under Server", () => {
    const cats = sidebarCategoriesForRole("admin");
    const hits = filterSidebarItems(cats, "discord");
    expect(hits.some((h) => h.href === "/admin/discord")).toBe(true);
  });
});
