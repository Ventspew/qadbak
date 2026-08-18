"use client";

import {
  Alert,
  Button,
  Card,
  ConfirmDialog,
  Input,
  Label,
} from "@/components/ui";
import { formatMailboxUsedMb } from "@/lib/format-quota";
import type { HostedMailbox } from "@/lib/types";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useDomainNavReset } from "@/hooks/useDomainNavReset";
import { useState } from "react";

export function EmailManager({
  domain,
  initialUsers,
  initialError,
  isAdmin = false,
}: {
  domain: string;
  initialUsers: HostedMailbox[];
  initialError: string;
  isAdmin?: boolean;
}) {
  const router = useRouter();
  const enc = encodeURIComponent(domain);
  const [users, setUsers] = useState(initialUsers);
  const [error, setError] = useState(initialError);
  const [success, setSuccess] = useState("");
  const [showCreate, setShowCreate] = useState(false);
  const [newUser, setNewUser] = useState("");
  const [newPass, setNewPass] = useState("");
  const [newReal, setNewReal] = useState("");
  const [loading, setLoading] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null);
  const [confirmTyped, setConfirmTyped] = useState("");
  const [resetUser, setResetUser] = useState<string | null>(null);
  const [resetPass, setResetPass] = useState("");
  const [quotaUser, setQuotaUser] = useState<string | null>(null);
  const [quotaMb, setQuotaMb] = useState("");
  const [mailHost, setMailHost] = useState("");

  useDomainNavReset(domain, () => {
    setUsers(initialUsers);
    setError(initialError);
    setSuccess("");
    setDeleteTarget(null);
    setResetUser(null);
    setResetPass("");
    setShowCreate(false);
    setConfirmTyped("");
    setMailHost("");
    void (async () => {
      try {
        const res = await fetch(`/api/domains/${encodeURIComponent(domain)}/mail-dns`);
        const data = await res.json();
        if (res.ok && data.hints?.mailHost) {
          setMailHost(String(data.hints.mailHost));
        }
      } catch {
        /* optional */
      }
    })();
  });

  async function refresh() {
    const res = await fetch(`/api/domains/${enc}/users`);
    const data = await res.json();
    if (res.ok) setUsers(data.users);
  }

  async function createMailbox(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError("");
    setSuccess("");
    try {
      const res = await fetch(`/api/domains/${enc}/users`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          user: newUser,
          pass: newPass,
          real: newReal || undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Create failed.");
      setSuccess(`Mailbox ${newUser}@${domain} created.`);
      setShowCreate(false);
      setNewUser("");
      setNewPass("");
      setNewReal("");
      await refresh();
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error.");
    } finally {
      setLoading(false);
    }
  }

  async function resetPassword() {
    if (!resetUser || !resetPass) return;
    setLoading(true);
    setError("");
    setSuccess("");
    try {
      const res = await fetch(`/api/domains/${enc}/users`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ user: resetUser, pass: resetPass }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Update failed.");
      setSuccess(`Password for ${resetUser} updated.`);
      setResetUser(null);
      setResetPass("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error.");
    } finally {
      setLoading(false);
    }
  }

  async function confirmDelete() {
    if (!deleteTarget) return;
    setLoading(true);
    setError("");
    setSuccess("");
    try {
      const res = await fetch(`/api/domains/${enc}/users`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ user: deleteTarget }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Delete failed.");
      setSuccess(`Mailbox ${deleteTarget} deleted.`);
      setDeleteTarget(null);
      setConfirmTyped("");
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error.");
    } finally {
      setLoading(false);
    }
  }

  async function saveQuota() {
    if (!quotaUser || !quotaMb) return;
    setLoading(true);
    setError("");
    setSuccess("");
    try {
      const res = await fetch(`/api/domains/${enc}/users`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ user: quotaUser, quotaMb: parseInt(quotaMb, 10) }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Quota update failed.");
      setSuccess(
        `Quota for ${quotaUser} set to ${quotaMb} MB (enforced by Dovecot).`,
      );
      setQuotaUser(null);
      setQuotaMb("");
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <p className="text-sm text-panel-muted">
          <Link
            href={`/domains/${enc}`}
            className="hover:text-white"
          >
            ← {domain}
          </Link>
        </p>
        <h1 className="mt-2 text-2xl font-semibold text-white">Mail accounts</h1>
        <p className="mt-1 text-sm text-panel-muted">
          Mailboxes for {domain}. Quota values are enforced by Dovecot (IMAP
          and LMTP reject mail when the mailbox is full).
          {isAdmin ? (
            <>
              {" "}
              Use the{" "}
              <Link href={`/domains/${enc}/mail/imap`} className="text-panel-accent hover:underline">
                IMAP
              </Link>{" "}
              tab or <strong className="text-white">Qmail</strong> per mailbox to read and send mail.
            </>
          ) : (
            <>
              {" "}
              Open <strong className="text-white">Qmail</strong> on a mailbox to read and send mail.
            </>
          )}{" "}
          For external clients: IMAP port 993, SMTP submission port 587 (same mailbox password).
        </p>
      </div>

      {error && <Alert>{error}</Alert>}
      {success && <Alert variant="success">{success}</Alert>}

      <p className="text-sm text-panel-muted">
        <Link href={`/domains/${enc}/security`} className="text-panel-link hover:underline">
          Spam filter (domain)
        </Link>
        {" · "}
        DNS for mail on this server or an external provider (Google, Microsoft, …):{" "}
        <Link
          href={`/domains/${enc}/mail/settings`}
          className="text-panel-link hover:underline"
        >
          Mail → Settings
        </Link>
        {mailHost ? (
          <>
            {" "}
            · mail host <code className="text-white">{mailHost}</code>
          </>
        ) : null}
      </p>

      <div className="flex justify-end">
        <Button onClick={() => setShowCreate(!showCreate)}>
          {showCreate ? "Cancel" : "New mailbox"}
        </Button>
      </div>

      {showCreate && (
        <Card>
          <h2 className="text-lg font-medium text-white">Create mailbox</h2>
          <form onSubmit={createMailbox} className="mt-4 grid gap-4 sm:grid-cols-2">
            <div>
              <Label htmlFor="user">Username (local part)</Label>
              <Input
                id="user"
                value={newUser}
                onChange={(e) => setNewUser(e.target.value)}
                placeholder="info"
                required
              />
            </div>
            <div>
              <Label htmlFor="pass">Password</Label>
              <Input
                id="pass"
                type="password"
                value={newPass}
                onChange={(e) => setNewPass(e.target.value)}
                required
              />
            </div>
            <div className="sm:col-span-2">
              <Label htmlFor="real">Display name (optional)</Label>
              <Input
                id="real"
                value={newReal}
                onChange={(e) => setNewReal(e.target.value)}
              />
            </div>
            <Button type="submit" disabled={loading}>
              {loading ? "Working…" : "Create"}
            </Button>
          </form>
        </Card>
      )}

      <Card className="overflow-hidden p-0">
        <table className="w-full text-left text-sm">
          <thead className="border-b border-panel-border bg-panel-bg/50 text-panel-muted">
            <tr>
              <th className="px-6 py-3">Mailbox</th>
              <th className="px-6 py-3">Name</th>
              <th className="px-6 py-3">Usage / limit (MB)</th>
              <th className="px-6 py-3 text-right">Actions</th>
            </tr>
          </thead>
          <tbody>
            {users.map((u) => {
              const name = u.user ?? "";
              return (
                <tr key={name} className="border-b border-panel-border/50">
                  <td className="px-6 py-4 text-white">
                    {name}@{domain}
                  </td>
                  <td className="px-6 py-4 text-panel-muted">{u.real ?? " - "}</td>
                  <td className="px-6 py-4 font-mono text-panel-muted tabular-nums">
                    {formatMailboxUsedMb(u)}
                    {(u as HostedMailbox & { quotaLimitMb?: number }).quotaLimitMb
                      ? ` / ${(u as HostedMailbox & { quotaLimitMb?: number }).quotaLimitMb}`
                      : ""}
                  </td>
                  <td className="px-6 py-4 text-right space-x-2">
                    <Button
                      variant="secondary"
                      onClick={() => {
                        setQuotaUser(name);
                        setQuotaMb(
                          String(
                            (u as HostedMailbox & { quotaLimitMb?: number }).quotaLimitMb ?? "",
                          ),
                        );
                      }}
                    >
                      Quota
                    </Button>
                    <Link
                      href={`/domains/${enc}/mail/${encodeURIComponent(name)}`}
                      className="inline-flex items-center rounded-lg border border-panel-border px-3 py-1.5 text-sm text-panel-link hover:bg-panel-border/30"
                    >
                      Qmail
                    </Link>
                    <Button
                      variant="secondary"
                      onClick={() => {
                        setResetUser(name);
                        setResetPass("");
                      }}
                    >
                      Password
                    </Button>
                    <Button variant="danger" onClick={() => setDeleteTarget(name)}>
                      Delete
                    </Button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {users.length === 0 && (
          <p className="px-6 py-8 text-center text-panel-muted">
            No mailboxes found.
          </p>
        )}
      </Card>

      {quotaUser && (
        <Card>
          <h2 className="text-lg font-medium text-white">
            Mailbox quota - {quotaUser}@{domain}
          </h2>
          <p className="mt-1 text-xs text-panel-muted">
            Dovecot rejects IMAP and LMTP when the mailbox is over this limit.
          </p>
          <div className="mt-4 flex max-w-md gap-2">
            <Input
              type="number"
              min={1}
              placeholder="Limit in MB"
              value={quotaMb}
              onChange={(e) => setQuotaMb(e.target.value)}
            />
            <Button onClick={saveQuota} disabled={loading || !quotaMb}>
              Save
            </Button>
            <Button variant="ghost" onClick={() => setQuotaUser(null)}>
              Cancel
            </Button>
          </div>
        </Card>
      )}

      {resetUser && (
        <Card>
          <h2 className="text-lg font-medium text-white">
            Change password - {resetUser}
          </h2>
          <div className="mt-4 flex max-w-md gap-2">
            <Input
              type="password"
              placeholder="New password"
              value={resetPass}
              onChange={(e) => setResetPass(e.target.value)}
            />
            <Button onClick={resetPassword} disabled={loading || !resetPass}>
              Save
            </Button>
            <Button variant="ghost" onClick={() => setResetUser(null)}>
              Cancel
            </Button>
          </div>
        </Card>
      )}

      <ConfirmDialog
        open={!!deleteTarget}
        title="Delete mailbox"
        description={`You are about to permanently delete ${deleteTarget}@${domain}.`}
        confirmLabel="Delete"
        confirmValue={deleteTarget ?? ""}
        typedValue={confirmTyped}
        onTypedChange={setConfirmTyped}
        onConfirm={confirmDelete}
        onCancel={() => {
          setDeleteTarget(null);
          setConfirmTyped("");
        }}
        loading={loading}
      />
    </div>
  );
}
