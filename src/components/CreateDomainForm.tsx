"use client";

import { Alert, Button, Card, Input, Label } from "@/components/ui";
import { apiFetch, parseApiJson } from "@/lib/api-fetch";
import { useRouter } from "next/navigation";
import { useState } from "react";

export function CreateDomainForm({
  parentOptions,
  initialType = "top",
  premiumMultiTenant = false,
}: {
  parentOptions: string[];
  initialType?: "top" | "sub" | "alias";
  premiumMultiTenant?: boolean;
}) {
  const router = useRouter();
  const [type, setType] = useState<"top" | "sub" | "alias">(initialType);
  const [domain, setDomain] = useState("");
  const [pass, setPass] = useState("");
  const [user, setUser] = useState("");
  const [plan, setPlan] = useState("");
  const [parent, setParent] = useState(parentOptions[0] ?? "");
  const [createClientAccount, setCreateClientAccount] = useState(true);
  const [createPanelVhost, setCreatePanelVhost] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [clientCredentials, setClientCredentials] = useState<{
    username: string;
    password: string;
    panelUrl?: string;
  } | null>(null);
  const [unixPassword, setUnixPassword] = useState("");
  const [journalId, setJournalId] = useState("");
  const [dnsNote, setDnsNote] = useState("");
  const [hostingNote, setHostingNote] = useState("");
  const [premiumNote, setPremiumNote] = useState("");
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError("");
    setSuccess("");
    setClientCredentials(null);
    setUnixPassword("");
    setJournalId("");
    setDnsNote("");
    setHostingNote("");
    setPremiumNote("");
    try {
      const res = await apiFetch("/domains", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          domain,
          pass: pass || undefined,
          user: user || undefined,
          plan: plan || undefined,
          parent: type !== "top" ? parent : undefined,
          type,
          createClientAccount: type === "top" ? createClientAccount : false,
          createPanelVhost: type === "top" ? createPanelVhost : false,
        }),
      });
      const data = await parseApiJson<{
        error?: string;
        unixPassword?: string;
        journalId?: string;
        dnsNote?: string;
        hostingNote?: string;
        premiumNote?: string;
        clientAccount?: { username: string; password: string; panelUrl?: string };
        clientUsername?: string;
        clientPassword?: string;
        panelUrl?: string;
      }>(res);
      if (!res.ok) throw new Error(data.error ?? "Create failed.");
      if (data.clientAccount) {
        setClientCredentials(data.clientAccount);
      } else if (data.clientUsername && data.clientPassword) {
        setClientCredentials({
          username: data.clientUsername,
          password: data.clientPassword,
          panelUrl: data.panelUrl,
        });
      }
      if (data.unixPassword) {
        setUnixPassword(data.unixPassword);
      }
      if (typeof data.journalId === "string") {
        setJournalId(data.journalId);
      }
      if (typeof data.dnsNote === "string") {
        setDnsNote(data.dnsNote);
      }
      if (typeof data.hostingNote === "string") {
        setHostingNote(data.hostingNote);
      }
      if (typeof data.premiumNote === "string") {
        setPremiumNote(data.premiumNote);
      }
      setSuccess(`Domain ${domain} created.`);
      if (
        !data.clientAccount &&
        !data.unixPassword &&
        !data.journalId &&
        !data.dnsNote
      ) {
        setTimeout(() => {
          router.push(`/domains/${encodeURIComponent(domain)}`);
          router.refresh();
        }, 800);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <Card>
      <h1 className="text-2xl font-semibold text-white">New virtual server</h1>
      <p className="mt-1 text-sm text-panel-muted">
        Creates a unix account, web root, and nginx vhost on this server (native
        provisioning). Subdomains and aliases share the parent account when selected.
      </p>
      <form onSubmit={onSubmit} className="mt-8 space-y-4">
        {error && <Alert>{error}</Alert>}
        {success && <Alert variant="success">{success}</Alert>}
        {hostingNote && (
          <Alert variant="info">
            <p className="text-sm">{hostingNote}</p>
          </Alert>
        )}
        {dnsNote && (
          <Alert variant="info">
            <p className="font-medium text-white">DNS - next step</p>
            <p className="mt-2 text-sm">{dnsNote}</p>
            <p className="mt-2 text-xs text-panel-muted">
              Until DNS propagates, the site may already work on this server. Check
              Domains → Overview → Website health for local vs public status.
            </p>
          </Alert>
        )}
        {premiumNote && (
          <Alert>
            <p className="text-sm">{premiumNote}</p>
          </Alert>
        )}
        <div>
          <Label>Type</Label>
          <select
            className="mt-1 w-full rounded-lg border border-panel-border bg-panel-bg px-3 py-2 text-sm"
            value={type}
            onChange={(e) => setType(e.target.value as "top" | "sub" | "alias")}
          >
            <option value="top">Primary domain (virtual server)</option>
            <option value="sub">Subdomain</option>
            <option value="alias">Alias domain</option>
          </select>
        </div>
        {type !== "top" && (
          <div>
            <Label>Parent domain</Label>
            <select
              className="mt-1 w-full rounded-lg border border-panel-border bg-panel-bg px-3 py-2 text-sm"
              value={parent}
              onChange={(e) => setParent(e.target.value)}
            >
              {parentOptions.map((d) => (
                <option key={d} value={d}>
                  {d}
                </option>
              ))}
            </select>
          </div>
        )}
        <div>
          <Label htmlFor="domain">Domain name</Label>
          <Input
            id="domain"
            value={domain}
            onChange={(e) => setDomain(e.target.value)}
            placeholder={type === "sub" ? "shop.example.com" : "example.com"}
            required
          />
        </div>
        <div>
          <Label htmlFor="user">Unix user (optional)</Label>
          <Input
            id="user"
            value={user}
            onChange={(e) => setUser(e.target.value)}
            placeholder="Auto from domain name if empty"
          />
        </div>
        <div>
          <Label htmlFor="pass">Unix / hosting password (optional)</Label>
          <Input
            id="pass"
            type="password"
            value={pass}
            onChange={(e) => setPass(e.target.value)}
            autoComplete="new-password"
            placeholder="Leave empty to auto-generate"
          />
          <p className="mt-1 text-xs text-panel-muted">
            For the website/FTP system user on this server. Leave empty and one is
            generated and shown once after create. This is not the client panel login.
          </p>
        </div>
        <div>
          <Label htmlFor="plan">Plan (optional)</Label>
          <Input id="plan" value={plan} onChange={(e) => setPlan(e.target.value)} />
        </div>
        {type === "top" && premiumMultiTenant && (
          <div className="space-y-3 rounded-lg border border-panel-border bg-panel-bg/50 p-4">
            <p className="text-sm font-medium text-white">Client login (optional)</p>
            <p className="text-xs text-panel-muted">
              Most hosts use one panel URL for everyone (e.g. qadbak.com). You only need
              the options below for white-label <code className="text-xs">panel.[domain]</code> URLs.
            </p>
            <label className="flex cursor-pointer items-start gap-2 text-sm text-panel-muted">
              <input
                type="checkbox"
                className="mt-1"
                checked={createClientAccount}
                onChange={(e) => setCreateClientAccount(e.target.checked)}
              />
              <span>
                Create client account in <code className="text-xs">users.json</code>{" "}
                (they sign in on the main panel - password shown after create)
              </span>
            </label>
            <label className="flex cursor-pointer items-start gap-2 text-sm text-panel-muted">
              <input
                type="checkbox"
                className="mt-1"
                checked={createPanelVhost}
                onChange={(e) => setCreatePanelVhost(e.target.checked)}
                disabled={!createClientAccount}
              />
              <span>
                Also add <code className="text-xs">panel.[domain]</code> nginx vhost
                (optional white-label URL - off by default)
              </span>
            </label>
          </div>
        )}
        {type === "top" && !premiumMultiTenant && (
          <p className="text-sm text-panel-muted">
            Client panel accounts and <code className="text-xs">panel.[domain]</code>{" "}
            vhosts require Qadbak Premium  - {" "}
            <a href="/admin/license" className="text-panel-link hover:underline">
              activate a license
            </a>
            .
          </p>
        )}
        {unixPassword && (
          <Alert variant="success">
            <p className="font-medium text-white">
              Unix / FTP password (copy now - not shown again)
            </p>
            <p className="mt-2 text-sm">
              User: <strong>{user || domain.split(".")[0]}</strong>
              <br />
              Password: <strong>{unixPassword}</strong>
            </p>
          </Alert>
        )}
        {journalId && (
          <Alert variant="info">
            <p className="text-sm">
              <strong className="text-white">What just happened?</strong>{" "}
              See the exact nginx config, unix user creation, PHP-FPM pool and
              BIND zone we wrote for this domain.{" "}
              <a
                href={`/admin/journal?focus=${encodeURIComponent(journalId)}`}
                className="text-panel-link hover:underline"
              >
                Open in Journal →
              </a>
            </p>
          </Alert>
        )}
        {clientCredentials && (
          <Alert variant="success">
            <p className="font-medium text-white">Client panel login (copy now - not shown again)</p>
            <p className="mt-2 text-sm">
              Username: <strong>{clientCredentials.username}</strong>
              <br />
              Password: <strong>{clientCredentials.password}</strong>
              {clientCredentials.panelUrl && (
                <>
                  <br />
                  Panel URL:{" "}
                  <a
                    className="text-emerald-300 underline"
                    href={clientCredentials.panelUrl}
                    target="_blank"
                    rel="noreferrer"
                  >
                    {clientCredentials.panelUrl}
                  </a>
                </>
              )}
            </p>
            <Button
              type="button"
              className="mt-3"
              variant="secondary"
              onClick={() => {
                router.push(`/domains/${encodeURIComponent(domain)}`);
                router.refresh();
              }}
            >
              Continue to domain
            </Button>
          </Alert>
        )}
        {dnsNote && !clientCredentials && !unixPassword && (
          <Button
            type="button"
            variant="secondary"
            onClick={() => {
              router.push(`/domains/${encodeURIComponent(domain)}`);
              router.refresh();
            }}
          >
            Continue to domain
          </Button>
        )}
        <Button type="submit" disabled={loading}>
          {loading ? "Working…" : "Create domain"}
        </Button>
      </form>
    </Card>
  );
}
