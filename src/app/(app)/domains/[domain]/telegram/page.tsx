import { TelegramBotManager } from "@/components/TelegramBotManager";
import { requireDomainAccess } from "@/lib/domain-api";
import { runProvisioningHelper } from "@/lib/provisioner/native-exec";
import {
  defaultTelegramBotTasks,
  normalizeTelegramBotRecipes,
  type TelegramBotRecipes,
} from "@/lib/telegram-bot-tasks";

type Props = { params: Promise<{ domain: string }> };

export type TelegramBotPagePayload = {
  installed: boolean;
  parentDomain?: string;
  subdomain?: string;
  publicUrl?: string;
  botName?: string;
  botUsername?: string;
  containerStatus?: string;
  inviteUrl?: string;
  recipes: TelegramBotRecipes;
  commands?: Array<{ command: string; description: string }>;
};

export default async function TelegramBotPage({ params }: Props) {
  const { domain } = await requireDomainAccess((await params).domain);
  let payload: TelegramBotPagePayload = {
    installed: false,
    recipes: { botName: "Qadbak", tasks: defaultTelegramBotTasks() },
  };
  let error = "";
  try {
    const raw = await runProvisioningHelper("telegram-bot-get-tasks", domain);
    payload = {
      installed: Boolean(raw.installed),
      parentDomain: raw.parentDomain as string | undefined,
      subdomain: raw.subdomain as string | undefined,
      publicUrl: raw.publicUrl as string | undefined,
      botName: raw.botName as string | undefined,
      botUsername: raw.botUsername as string | undefined,
      containerStatus: raw.containerStatus as string | undefined,
      inviteUrl: raw.inviteUrl as string | undefined,
      recipes: normalizeTelegramBotRecipes(raw.recipes),
      commands: Array.isArray(raw.commands)
        ? (raw.commands as Array<{ command: string; description: string }>)
        : [],
    };
  } catch (e) {
    error = e instanceof Error ? e.message : "Could not load Telegram bot.";
  }

  return (
    <TelegramBotManager
      domain={domain}
      initial={payload}
      initialError={error}
    />
  );
}
