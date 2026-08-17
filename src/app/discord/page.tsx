"use client";

import { Alert, Button, Card } from "@/components/ui";
import { PanelFooter } from "@/components/PanelFooter";
import { APP_NAME, APP_TAGLINE, DEFAULT_LOGO_PATH } from "@/lib/brand";
import { applyBrandingTheme } from "@/lib/branding-css";
import type { BrandingThemeColors } from "@/lib/branding-theme";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

type PublicDiscord = {
  configured?: boolean;
  inviteUrl?: string;
  invite?: string;
  redirectUri?: string;
};

function statusMessage(code: string | null): string {
  if (code === "linked") return "Discord is linked. Check your DMs for a confirmation.";
  if (code === "need-oauth") {
    return "Discord OAuth is not configured yet. Ask the panel admin to save a client ID and secret.";
  }
  if (code === "error") return "Discord login did not complete. Try Link Discord again.";
  return "";
}

export default function PublicDiscordPage() {
  const [brandName, setBrandName] = useState(APP_NAME);
  const [tagline, setTagline] = useState(APP_TAGLINE);
  const [logoUrl, setLogoUrl] = useState<string | null>(null);
  const [info, setInfo] = useState<PublicDiscord | null>(null);
  const [queryCode, setQueryCode] = useState<string | null>(null);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    setQueryCode(params.get("discord"));
    fetch("/api/discord/public")
      .then((r) => r.json())
      .then((d: PublicDiscord) => setInfo(d))
      .catch(() => setInfo({}));
    fetch("/api/branding")
      .then((r) => r.json())
      .then(
        (d: {
          brandName?: string;
          tagline?: string;
          logoUrl?: string;
        } & Partial<BrandingThemeColors>) => {
          if (d.brandName) setBrandName(d.brandName);
          if (d.tagline) setTagline(d.tagline);
          if (d.logoUrl) setLogoUrl(d.logoUrl);
          applyBrandingTheme(d);
        },
      )
      .catch(() => {});
  }, []);

  const notice = useMemo(() => statusMessage(queryCode), [queryCode]);

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-panel-bg px-4 py-10">
      <Card className="w-full max-w-lg">
        <p className="mb-4 text-center text-sm">
          <Link href="/" className="text-panel-muted hover:text-white">
            ← Back to home
          </Link>
        </p>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={logoUrl ?? DEFAULT_LOGO_PATH}
          alt=""
          className={
            logoUrl
              ? "mx-auto mb-4 h-12 w-auto max-w-[200px]"
              : "mx-auto mb-4 h-12 w-12"
          }
        />
        <h1 className="text-2xl font-semibold text-panel-text">{brandName} Discord</h1>
        <p className="mt-1 text-sm text-panel-muted">{tagline}</p>
        <p className="mt-4 text-sm text-panel-muted">
          Invite the bot to your server, then link your Discord account for DMs.
          This page works on every Qadbak panel — you do not need the bot subdomain.
        </p>
        {notice ? (
          <div className="mt-4">
            <Alert variant={queryCode === "linked" ? "success" : "error"}>{notice}</Alert>
          </div>
        ) : null}
        <div className="mt-6 flex flex-col gap-3">
          {info?.inviteUrl ? (
            <a
              href={info.inviteUrl}
              className="inline-flex items-center justify-center rounded-md bg-panel-accent px-4 py-2 text-sm font-medium text-panel-bg hover:brightness-105"
            >
              Invite bot to Discord
            </a>
          ) : (
            <p className="text-sm text-panel-muted">
              Invite is not ready yet. The admin still needs to save a Discord application
              client ID under Server → Discord.
            </p>
          )}
          <Button
            type="button"
            variant="secondary"
            disabled={!info?.configured}
            onClick={() => {
              window.location.href = "/api/discord/login";
            }}
          >
            Link Discord for DMs
          </Button>
          {info?.invite ? (
            <a
              href={info.invite}
              className="text-center text-sm text-panel-link hover:underline"
            >
              Join the Discord server
            </a>
          ) : null}
        </div>
        {info?.redirectUri ? (
          <p className="mt-6 text-xs text-panel-muted">
            Add this exact redirect URI in Discord Developer Portal → OAuth2:{" "}
            <code className="break-all text-slate-300">{info.redirectUri}</code>
          </p>
        ) : null}
        <div className="mt-6">
          <PanelFooter showBlurb />
        </div>
      </Card>
    </div>
  );
}
