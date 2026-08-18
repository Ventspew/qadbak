import { Card } from "@/components/ui";
import { PanelFooter } from "@/components/PanelFooter";
import { APP_NAME, APP_TAGLINE, DEFAULT_LOGO_PATH } from "@/lib/brand";
import Link from "next/link";

export const dynamic = "force-dynamic";

/** Public dead-end: the operator bot is not inviteable from here. */
export default function PublicDiscordPage() {
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
          src={DEFAULT_LOGO_PATH}
          alt=""
          className="mx-auto mb-4 h-12 w-12"
        />
        <h1 className="text-2xl font-semibold text-panel-text">
          {APP_NAME} Discord
        </h1>
        <p className="mt-1 text-sm text-panel-muted">{APP_TAGLINE}</p>
        <p className="mt-4 text-sm text-panel-muted">
          The panel operator bot is not publicly inviteable. Host admins invite it
          after signing in, under Server → Discord.
        </p>
        <p className="mt-3 text-sm text-panel-muted">
          Each website that installed the Discord Bot app has its own bot at{" "}
          <code className="text-slate-300">bot.thatdomain</code>. That page may
          only invite <strong>that customer&apos;s</strong> Discord application —
          never the official Qadbak bot.
        </p>
        <p className="mt-4 text-center text-sm">
          <Link href="/login" className="text-panel-link hover:underline">
            Panel login
          </Link>
        </p>
        <div className="mt-6">
          <PanelFooter showBlurb />
        </div>
      </Card>
    </div>
  );
}
