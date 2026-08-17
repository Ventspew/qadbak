import { auditLog } from "@/lib/audit";
import { handleApiError, jsonError, jsonOk } from "@/lib/api";
import { requireDomainApi } from "@/lib/domain-api";
import { runProvisioningHelper } from "@/lib/provisioner/native-exec";
import { normalizeTelegramBotRecipes } from "@/lib/telegram-bot-tasks";

type Params = { params: Promise<{ domain: string }> };

export async function GET(_req: Request, { params }: Params) {
  try {
    const { domain } = await requireDomainApi((await params).domain);
    const raw = await runProvisioningHelper("telegram-bot-get-tasks", domain);
    return jsonOk(raw);
  } catch (err) {
    return handleApiError(err);
  }
}

export async function POST(request: Request, { params }: Params) {
  try {
    const { session, domain } = await requireDomainApi((await params).domain);
    const body = (await request.json()) as { action?: string; botName?: string; tasks?: unknown };
    if (body.action && body.action !== "save-tasks") {
      return jsonError("Unknown action.", 400);
    }
    const recipes = normalizeTelegramBotRecipes({
      botName: body.botName,
      tasks: body.tasks,
    });
    const raw = await runProvisioningHelper(
      "telegram-bot-save-tasks",
      domain,
      JSON.stringify(recipes),
    );
    await auditLog(session.username, "telegram-bot-save-tasks", domain);
    return jsonOk(raw);
  } catch (err) {
    return handleApiError(err);
  }
}
