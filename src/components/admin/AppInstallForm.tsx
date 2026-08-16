"use client";

import { useEffect, useState } from "react";
import type { AppInstallResult, AppTemplateSummary } from "@/lib/apps";
import { apiPath } from "@/lib/install-salt";
import { Alert, Badge, Button, Card, Input, Label } from "@/components/ui";

const GATEWAY_HINT =
  "Panel unreachable (HTTP 502 HTML). Install may still be running in the background. Wait, refresh this page, or run: sudo -u qadbak pm2 list && tail -n 80 /opt/qadbak/data/provisioning-helper.log";

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

function isGatewayHtml(status: number, text: string) {
  const trimmed = text.trim();
  return (
    !trimmed ||
    trimmed.startsWith("<") ||
    status === 502 ||
    status === 503 ||
    status === 504
  );
}

async function readApiJson<T>(
  doFetch: () => Promise<Response>,
  { retries = 8, retryHtml = true } = {},
): Promise<{ res: Response; data: T }> {
  let lastErr: Error | null = null;
  for (let i = 0; i < retries; i += 1) {
    try {
      const res = await doFetch();
      const text = await res.text();
      if (isGatewayHtml(res.status, text) && (!text.trim() || text.trim().startsWith("<"))) {
        lastErr = new Error(GATEWAY_HINT);
        if (!retryHtml) throw lastErr;
        await sleep(Math.min(15_000, 2000 * (i + 1)));
        continue;
      }
      try {
        return { res, data: JSON.parse(text.trim()) as T };
      } catch {
        throw new Error(text.trim().slice(0, 300) || `HTTP ${res.status}`);
      }
    } catch (e) {
      if (e instanceof TypeError) {
        lastErr = new Error(GATEWAY_HINT);
        await sleep(Math.min(15_000, 2000 * (i + 1)));
        continue;
      }
      throw e;
    }
  }
  throw lastErr ?? new Error(GATEWAY_HINT);
}

async function pollInstallJob(
  jobId: string,
  onStatus?: (message: string) => void,
): Promise<AppInstallResult> {
  const started = Date.now();
  const maxMs = 2_700_000;
  while (Date.now() - started < maxMs) {
    await sleep(2000);
    const { res, data } = await readApiJson<{
      job?: {
        status: string;
        error?: string;
        lastMessage?: string;
        result?: AppInstallResult;
      };
      error?: string;
    }>(() =>
      fetch(apiPath(`/admin/apps/install-status?id=${encodeURIComponent(jobId)}`), {
        credentials: "same-origin",
        cache: "no-store",
      }),
    );
    if (!res.ok || data.error) {
      if (res.status === 502 || res.status === 503 || res.status === 504) {
        onStatus?.("Panel briefly unreachable — retrying status…");
        continue;
      }
      throw new Error(data.error ?? `HTTP ${res.status}`);
    }
    if (data.job?.lastMessage) onStatus?.(data.job.lastMessage);
    if (data.job?.status === "ok" && data.job.result) return data.job.result;
    if (data.job?.status === "error") {
      throw new Error(data.job.error || "Install failed.");
    }
    onStatus?.(data.job?.lastMessage || "Installing in background…");
  }
  throw new Error(
    "Install is still running. Check Journal or /opt/qadbak/data/provisioning-helper.log",
  );
}

function jobStorageKey(templateId: string) {
  return `qadbak-app-install-job:${templateId}`;
}

export function AppInstallForm({ template }: { template: AppTemplateSummary }) {
  const [values, setValues] = useState<Record<string, string>>(() => {
    const out: Record<string, string> = {};
    for (const f of template.inputs) {
      if ("defaultValue" in f && f.defaultValue) {
        out[f.name] = f.defaultValue;
      }
      if (f.type === "boolean" && !out[f.name]) {
        out[f.name] = "false";
      }
    }
    return out;
  });
  const [loading, setLoading] = useState(false);
  const [progress, setProgress] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<AppInstallResult | null>(null);

  async function followJob(jobId: string) {
    sessionStorage.setItem(jobStorageKey(template.id), jobId);
    setProgress("Install started in background…");
    const installed = await pollInstallJob(jobId, setProgress);
    sessionStorage.removeItem(jobStorageKey(template.id));
    setResult(installed);
  }

  useEffect(() => {
    const existing = sessionStorage.getItem(jobStorageKey(template.id));
    if (!existing) return;
    setLoading(true);
    setError(null);
    followJob(existing)
      .catch((e) => setError(e instanceof Error ? e.message : String(e)))
      .finally(() => setLoading(false));
    // Resume a job that survived a 502 / page refresh.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [template.id]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    setResult(null);
    setProgress("Starting install…");
    try {
      const { res, data } = await readApiJson<{
        result?: AppInstallResult;
        jobId?: string;
        pending?: boolean;
        error?: string;
      }>(() =>
        fetch(apiPath("/admin/apps/install"), {
          method: "POST",
          credentials: "same-origin",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ templateId: template.id, input: values }),
        }),
      );
      if (!res.ok || data.error) {
        throw new Error(data.error ?? `HTTP ${res.status}`);
      }
      if (data.jobId) {
        await followJob(data.jobId);
        return;
      }
      if (data.result) setResult(data.result);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }

  if (result) {
    return <AppInstallSuccess template={template} result={result} />;
  }

  return (
    <Card>
      <form onSubmit={submit} className="space-y-4">
        {error ? <Alert variant="error">{error}</Alert> : null}
        {loading && progress ? (
          <p className="text-sm text-panel-muted">{progress}</p>
        ) : null}
        {template.inputs.map((field) => (
          <div key={field.name}>
            <Label htmlFor={`f-${field.name}`}>
              {field.label}
              {"required" in field && field.required ? (
                <span className="ml-1 text-red-400">*</span>
              ) : null}
            </Label>
            {field.type === "boolean" ? (
              <label className="mt-2 flex items-center gap-2 text-sm text-panel-muted">
                <input
                  id={`f-${field.name}`}
                  type="checkbox"
                  checked={values[field.name] === "true"}
                  onChange={(e) =>
                    setValues((v) => ({
                      ...v,
                      [field.name]: e.target.checked ? "true" : "false",
                    }))
                  }
                />
                Enable
              </label>
            ) : field.type === "select" ? (
              <select
                id={`f-${field.name}`}
                className="qadbak-field focus:border-panel-link focus:outline-none focus:ring-1 focus:ring-panel-link"
                value={values[field.name] ?? field.defaultValue ?? field.options[0]?.value ?? ""}
                required={"required" in field ? field.required : false}
                onChange={(e) =>
                  setValues((v) => ({ ...v, [field.name]: e.target.value }))
                }
              >
                {field.options.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            ) : (
              <Input
                id={`f-${field.name}`}
                type={
                  field.type === "password"
                    ? "password"
                    : field.type === "email"
                      ? "email"
                      : "text"
                }
                value={values[field.name] ?? ""}
                placeholder={
                  "placeholder" in field ? field.placeholder : undefined
                }
                required={"required" in field ? field.required : false}
                onChange={(e) =>
                  setValues((v) => ({ ...v, [field.name]: e.target.value }))
                }
              />
            )}
            {"help" in field && field.help ? (
              <p className="mt-1 text-xs text-panel-muted">{field.help}</p>
            ) : null}
          </div>
        ))}
        <div className="flex items-center gap-3 pt-2">
          <Button type="submit" disabled={loading}>
            {loading
              ? `Installing ${template.label}…`
              : `Install ${template.label}`}
          </Button>
          {template.etaSeconds ? (
            <span className="text-xs text-panel-muted">
              Usually ~{Math.ceil(template.etaSeconds / 60)} min · runs in the
              background so the panel stays up
            </span>
          ) : null}
        </div>
      </form>
    </Card>
  );
}

function AppInstallSuccess({
  template,
  result,
}: {
  template: AppTemplateSummary;
  result: AppInstallResult;
}) {
  return (
    <div className="space-y-4">
      <Alert variant="success">
        <p className="text-base font-medium text-white">
          {template.label} installed on {result.domain}.
        </p>
        {result.postInstall ? (
          <p className="mt-2 text-sm">{result.postInstall}</p>
        ) : null}
      </Alert>

      <Card className="space-y-3">
        <header className="flex items-center justify-between gap-2">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-panel-muted">
            Finish setup
          </h2>
          <Badge tone="success">Ready</Badge>
        </header>
        <a
          href={result.primaryUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="block break-all text-base text-panel-link hover:underline"
        >
          {result.primaryUrl}
        </a>
        {result.secondaryUrl ? (
          <p className="text-xs text-panel-muted">
            After the wizard:{" "}
            <a
              href={result.secondaryUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="text-panel-link hover:underline"
            >
              {result.secondaryUrl}
            </a>
          </p>
        ) : null}
      </Card>

      <Card className="space-y-3">
        <header className="flex items-center justify-between gap-2">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-panel-muted">
            Credentials · copy now (shown once)
          </h2>
          <Badge tone="warning">Secrets</Badge>
        </header>
        <table className="w-full text-sm">
          <tbody>
            {result.credentials.map((c) => (
              <tr key={c.label} className="border-b border-panel-border/40 last:border-b-0">
                <td className="py-2 pr-3 text-panel-muted">{c.label}</td>
                <td className="py-2">
                  <CopyableValue value={c.value} isSecret={c.isSecret} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>

      <Card className="border-dashed border-panel-border/80 bg-panel-card/30">
        <p className="text-sm text-panel-muted">
          <strong className="text-white">What just happened?</strong>{" "}
          Open the journal entry for the full step-by-step log: database
          creation, file download, wp-config generation, ownership.{" "}
          <a
            href={`/admin/journal?focus=${encodeURIComponent(result.journalId)}`}
            className="text-panel-link hover:underline"
          >
            Open in Journal →
          </a>
        </p>
      </Card>
    </div>
  );
}

function CopyableValue({ value, isSecret }: { value: string; isSecret: boolean }) {
  const [copied, setCopied] = useState(false);
  const [shown, setShown] = useState(!isSecret);
  function copy() {
    navigator.clipboard.writeText(value).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  }
  return (
    <div className="flex items-center gap-2">
      <code className="flex-1 break-all rounded bg-black/40 px-2 py-1 text-xs text-emerald-200">
        {shown ? value : "•".repeat(Math.min(value.length, 24))}
      </code>
      {isSecret ? (
        <button
          type="button"
          className="text-xs text-panel-muted hover:text-white"
          onClick={() => setShown((s) => !s)}
        >
          {shown ? "Hide" : "Show"}
        </button>
      ) : null}
      <Button variant="secondary" onClick={copy}>
        {copied ? "Copied" : "Copy"}
      </Button>
    </div>
  );
}
