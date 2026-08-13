import { runProvisioningHelper } from "@/lib/provisioner/native-exec";
import type { AppTemplate } from "../types";

export const pogoStackTemplate: AppTemplate = {
  id: "pogo-stack",
  label: "PoGo Stack",
  tagline: "Account pool, map stack & deviceless workers — one server, no phones.",
  icon: "⚡",
  description:
    "Installs the bundled PoGo Stack on this VPS: account API, dashboard, Golbat, ReactMap, " +
    "RotomNG, and optional Redroid/Cosmog deviceless workers. Proxied at pogo.yourdomain.com.",
  etaSeconds: 300,
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
      defaultValue: "full",
      options: [
        { value: "core", label: "Core — account API + dashboard" },
        { value: "mapping", label: "Mapping — core + Golbat, ReactMap, RotomNG" },
        { value: "full", label: "Full — mapping + Redroid workers (x86 and ARM64)" },
        { value: "workers", label: "Workers only — Redroid/Cosmog stack" },
      ],
      help: "Full starts mapping plus Redroid. x86 uses official Redroid; ARM64 uses the Magisk image.",
    },
  ],
  async install({ input }) {
    const domain = input.domain?.trim().toLowerCase();
    const subdomain = (input.subdomain || "pogo").trim().toLowerCase();
    const mode = (input.mode || "full").trim();
    const allowedModes = new Set(["core", "mapping", "full", "workers"]);
    if (!domain) throw new Error("Domain is required.");
    if (!/^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/.test(subdomain)) {
      throw new Error("Invalid subdomain prefix.");
    }
    if (!allowedModes.has(mode)) {
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
    };

    const host = result.pogoHost ?? `${subdomain}.${domain}`;

    return {
      domain,
      primaryUrl: result.adminUrl ?? `https://${host}/`,
      credentials: [
        {
          label: "Stack directory",
          value: "/opt/qadbak/integrations/pogo-stack",
          isSecret: false,
        },
        {
          label: "Cosmog APK path",
          value: "/opt/qadbak/integrations/pogo-stack/services/cosmog/apk/",
          isSecret: false,
        },
      ],
      postInstall:
        result.postInstall?.join(" ") ??
        `Open https://${host}/ to manage accounts. See integrations/pogo-stack/docs/DEVICELESS.md for workers.`,
    };
  },
};
