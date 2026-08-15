import { runProvisioningHelper } from "@/lib/provisioner/native-exec";
import type { AppTemplate } from "../types";

const ALLOWED_MODES = new Set([
  "core",
  "mapping",
  "android",
  "ios",
  "phones",
  "full",
  "workers",
]);

export const pogoStackTemplate: AppTemplate = {
  id: "pogo-stack",
  label: "PoGo Stack",
  tagline: "Account pool, map, Android Cosmog & jailbroken iPhone workers.",
  icon: "⚡",
  description:
    "Installs the bundled PoGo Stack on this VPS: login dashboard, account API, Golbat, ReactMap, " +
    "RotomNG, physical Android (Cosmog), jailbroken iPhone (Exeggcute/GC), and optional Redroid. " +
    "Proxied at pogo.yourdomain.com.",
  etaSeconds: 1800,
  inputs: [
    {
      name: "domain",
      label: "Primary domain",
      type: "domain",
      required: true,
      help: "Existing domain (e.g. example.com). Dashboard at pogo.example.com by default.",
    },
    {
      name: "subdomain",
      label: "Dashboard subdomain",
      type: "text",
      defaultValue: "pogo",
      pattern: "^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$",
      help: "Default pogo → pogo.example.com",
    },
    {
      name: "mode",
      label: "Stack mode",
      type: "select",
      required: true,
      defaultValue: "phones",
      options: [
        { value: "core", label: "Core — account API + dashboard" },
        { value: "mapping", label: "Mapping — core + Golbat, ReactMap, RotomNG" },
        { value: "android", label: "Android — mapping + Cosmog phones" },
        { value: "ios", label: "iPhone — mapping + jailbroken Exeggcute/GC" },
        { value: "phones", label: "Phones — mapping + Android + iPhone (recommended)" },
        { value: "full", label: "Full — phones + Redroid workers" },
        { value: "workers", label: "Workers only — Redroid/Cosmog (no physical phones)" },
      ],
      help: "Phones is the usual mode on an x86 VPS. Full adds Redroid (needs more RAM; ARM64 is better for Cosmog APKs).",
    },
  ],
  async install({ input }) {
    const domain = input.domain?.trim().toLowerCase();
    const subdomain = (input.subdomain || "pogo").trim().toLowerCase();
    const mode = (input.mode || "phones").trim();
    if (!domain) throw new Error("Domain is required.");
    if (!/^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/.test(subdomain)) {
      throw new Error("Invalid subdomain prefix.");
    }
    if (!ALLOWED_MODES.has(mode)) {
      throw new Error(`Invalid stack mode "${mode}".`);
    }

    const result = (await runProvisioningHelper(
      "pogo-stack-install",
      domain,
      JSON.stringify({ subdomain, mode }),
    )) as {
      adminUrl?: string;
      pogoHost?: string;
      mode?: string;
      postInstall?: string[];
      dashboardUser?: string;
      dashboardPassword?: string;
    };

    const host = result.pogoHost ?? `${subdomain}.${domain}`;
    const credentials = [
      {
        label: "Stack directory",
        value: "/opt/qadbak/integrations/pogo-stack",
        isSecret: false,
      },
      {
        label: "Dashboard login",
        value: result.dashboardUser || "admin",
        isSecret: false,
      },
    ];
    if (result.dashboardPassword) {
      credentials.push({
        label: "Dashboard password",
        value: result.dashboardPassword,
        isSecret: true,
      });
    }
    credentials.push({
      label: "Cosmog APK path",
      value: "/opt/qadbak/integrations/pogo-stack/services/cosmog/apk/",
      isSecret: false,
    });
    credentials.push({
      label: "Exeggcute deb path",
      value: "/opt/qadbak/integrations/pogo-stack/services/exeggcute/debs/",
      isSecret: false,
    });

    return {
      domain,
      primaryUrl: result.adminUrl ?? `https://${host}/`,
      credentials,
      postInstall:
        result.postInstall?.join(" ") ??
        `Open https://${host}/ and log in. iPhone: jailbreak + OpenSSH + Exeggcute, then bash scripts/provision-ios.sh.`,
    };
  },
};
