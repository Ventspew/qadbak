import { BackupsManager } from "@/components/BackupsManager";
import { requireDomainPageNotAlias } from "@/lib/domain-api";
import { getProvisioner } from "@/lib/provisioner";
import { isPremiumFeatureEnabled } from "@/lib/premium/server";
import { nativeFeatureEnabled } from "@/lib/provisioner/native-features";
import { isIndependentMode } from "@/lib/provisioner/native-stub";

type Props = { params: Promise<{ domain: string }> };

export default async function BackupsPage({ params }: Props) {
  const { session, domain } = await requireDomainPageNotAlias((await params).domain);
  let scheduled: Awaited<ReturnType<ReturnType<typeof getProvisioner>["listScheduledBackups"]>> = [];
  let error = "";
  try {
    scheduled = await getProvisioner().listScheduledBackups(domain, session);
  } catch (e) {
    error = e instanceof Error ? e.message : "Could not load backups.";
  }
  const nativeMode = nativeFeatureEnabled("backup") || isIndependentMode();

  const isAdmin = session.role === "admin";
  const offsitePremium = await isPremiumFeatureEnabled("offsite-backup");

  return (
    <BackupsManager
      domain={domain}
      initialScheduled={scheduled}
      canBackup={isAdmin}
      canRestore={isAdmin}
      canPartialRestore={nativeMode && isAdmin}
      offsitePremium={offsitePremium}
      canUpload={isAdmin && nativeMode}
      nativeMode={nativeMode}
      isAdmin={isAdmin}
      initialError={error}
    />
  );
}
