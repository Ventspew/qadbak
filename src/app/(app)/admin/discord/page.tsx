import { AdminDiscordPage } from "@/components/AdminDiscordPage";
import { requireAdminPage } from "@/lib/admin-api";

export const dynamic = "force-dynamic";

export default async function AdminDiscordRoute() {
  await requireAdminPage();
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-white">Discord bot</h1>
        <p className="mt-1 text-sm text-panel-muted">
          Invite a bot, assign tasks without code, and get Qadbak-wide DMs.
          Minecraft join/leave stays on the Minecraft app.
        </p>
      </div>
      <AdminDiscordPage />
    </div>
  );
}
