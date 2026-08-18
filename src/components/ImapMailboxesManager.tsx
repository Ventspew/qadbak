"use client";

import { Alert, Badge, Button, Card, Input, Label, Textarea } from "@/components/ui";
import type { ImapMailbox } from "@/lib/provisioner";
import {
  buildReferencesHeader,
  forwardBody,
  forwardSubject,
  parseAddressList,
  parseEmailAddress,
  quoteReplyBody,
  replySubject,
} from "@/lib/mail-reply";
import Link from "next/link";
import { useDomainNavReset } from "@/hooks/useDomainNavReset";
import { useCallback, useEffect, useRef, useState } from "react";
import { DomainPageHeader } from "./DomainPageHeader";

type MailUser = { user: string; email?: string; label?: string };

type ImapMessageRow = {
  id: string;
  subject: string;
  from?: string;
  to?: string;
  date?: string;
  size?: string;
};

type ImapMessageDetail = ImapMessageRow & {
  bodyText?: string;
  rawHeaders?: string;
  source?: string;
  messageId?: string;
  replyTo?: string;
  cc?: string;
  references?: string;
};

type ComposeMode = "new" | "reply" | "reply-all" | "forward";

export function ImapMailboxesManager({
  domain,
  initialMailboxes,
  initialError,
  isAdmin,
  initialUser = "",
  webmailMode = false,
}: {
  domain: string;
  initialMailboxes: ImapMailbox[];
  initialError: string;
  isAdmin: boolean;
  initialUser?: string;
  webmailMode?: boolean;
}) {
  const enc = encodeURIComponent(domain);
  const [mailboxes, setMailboxes] = useState(initialMailboxes);
  const [error, setError] = useState(initialError);
  const [users, setUsers] = useState<MailUser[]>([]);
  const [user, setUser] = useState(initialUser);
  const [searchQuery, setSearchQuery] = useState("");
  const [source, setSource] = useState<string | null>(null);
  const [authUser, setAuthUser] = useState<string | null>(null);
  const [copyFrom, setCopyFrom] = useState("INBOX");
  const [copyTo, setCopyTo] = useState("");
  const [loading, setLoading] = useState(false);

  const [selectedFolder, setSelectedFolder] = useState<string | null>(null);
  const [messages, setMessages] = useState<ImapMessageRow[]>([]);
  const [messagesSource, setMessagesSource] = useState<string | null>(null);
  const [messagesLoading, setMessagesLoading] = useState(false);
  const [selectedMessage, setSelectedMessage] = useState<ImapMessageDetail | null>(null);
  const [messageLoading, setMessageLoading] = useState(false);

  const [sendTo, setSendTo] = useState("");
  const [sendCc, setSendCc] = useState("");
  const [sendSubject, setSendSubject] = useState("");
  const [sendBody, setSendBody] = useState("");
  const [sendInReplyTo, setSendInReplyTo] = useState("");
  const [sendReferences, setSendReferences] = useState("");
  const [composeMode, setComposeMode] = useState<ComposeMode>("new");
  const [sendLoading, setSendLoading] = useState(false);
  const [sendSuccess, setSendSuccess] = useState("");
  const composeRef = useRef<HTMLDivElement>(null);
  const webmailInboxOpened = useRef(false);

  useDomainNavReset(domain, () => {
    setMailboxes(initialMailboxes);
    setError(initialError);
    setUsers([]);
    setUser(initialUser);
    setSearchQuery("");
    setSource(null);
    setAuthUser(null);
    setSelectedFolder(null);
    setMessages([]);
    setSelectedMessage(null);
    setSendTo("");
    setSendCc("");
    setSendSubject("");
    setSendBody("");
    setSendSuccess("");
    setComposeMode("new");
    webmailInboxOpened.current = false;
  });

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    setSelectedFolder(null);
    setMessages([]);
    setSelectedMessage(null);
    try {
      const q = user ? `?user=${encodeURIComponent(user)}` : "";
      const res = await fetch(`/api/domains/${enc}/mailboxes${q}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Load failed.");
      const boxes = (data.mailboxes ?? []) as ImapMailbox[];
      setMailboxes(boxes);
      if (Array.isArray(data.users) && data.users.length) {
        setUsers(data.users);
        if (!user && data.users[0]?.user) setUser(data.users[0].user);
      }
      setSource(data.source ?? null);
      setAuthUser(data.authUser ?? null);
      if (data.hint && !user) setError("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error.");
    } finally {
      setLoading(false);
    }
  }, [enc, user]);

  const loadMessages = useCallback(
    async (folder: string) => {
      if (!user) return;
      setSelectedFolder(folder);
      setMessagesLoading(true);
      setError("");
      setMessages([]);
      setSelectedMessage(null);
      try {
        const q = new URLSearchParams({ user, folder });
        const res = await fetch(
          `/api/domains/${enc}/mailboxes/messages?${q}`,
        );
        const data = await res.json();
        if (!res.ok) throw new Error(data.error ?? "Could not load messages.");
        setMessages(data.messages ?? []);
        setMessagesSource(data.source ?? null);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Error.");
      } finally {
        setMessagesLoading(false);
      }
    },
    [enc, user],
  );

  const openMessage = useCallback(
    async (messageId: string) => {
      if (!user || !selectedFolder) return;
      setMessageLoading(true);
      setError("");
      try {
        const q = new URLSearchParams({
          user,
          folder: selectedFolder,
        });
        const res = await fetch(
          `/api/domains/${enc}/mailboxes/messages/${encodeURIComponent(messageId)}?${q}`,
        );
        const data = await res.json();
        if (!res.ok) throw new Error(data.error ?? "Could not load message.");
        setSelectedMessage(data.message ?? null);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Error.");
      } finally {
        setMessageLoading(false);
      }
    },
    [enc, user, selectedFolder],
  );

  useEffect(() => {
    if (initialUser) setUser(initialUser);
  }, [initialUser]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (!webmailMode || !user || webmailInboxOpened.current) return;
    const boxes =
      mailboxes.length > 0 ? mailboxes : initialMailboxes;
    if (boxes.length === 0) return;
    const inbox =
      boxes.find((m) => m.folder?.toUpperCase() === "INBOX") ?? boxes[0];
    if (!inbox?.folder) return;
    webmailInboxOpened.current = true;
    void loadMessages(inbox.folder);
  }, [
    webmailMode,
    user,
    mailboxes,
    initialMailboxes,
    loadMessages,
  ]);

  const filteredMessages = searchQuery.trim()
    ? messages.filter((m) => {
        const q = searchQuery.toLowerCase();
        return (
          (m.subject ?? "").toLowerCase().includes(q) ||
          (m.from ?? "").toLowerCase().includes(q)
        );
      })
    : messages;

  const selfEmail = user ? `${user}@${domain}`.toLowerCase() : "";

  function resetCompose() {
    setComposeMode("new");
    setSendTo("");
    setSendCc("");
    setSendSubject("");
    setSendBody("");
    setSendInReplyTo("");
    setSendReferences("");
  }

  function startReply(mode: ComposeMode, msg: ImapMessageDetail) {
    const replyAddr = parseEmailAddress(msg.replyTo || msg.from || "");
    if (mode === "forward") {
      setComposeMode("forward");
      setSendTo("");
      setSendCc("");
      setSendSubject(forwardSubject(msg.subject || ""));
      setSendBody(
        forwardBody({
          from: msg.from,
          to: msg.to,
          date: msg.date,
          subject: msg.subject,
          bodyText: msg.bodyText,
        }),
      );
      setSendInReplyTo("");
      setSendReferences("");
    } else if (mode === "reply-all") {
      const others = new Set<string>([
        ...parseAddressList(msg.to),
        ...parseAddressList(msg.cc),
        ...parseAddressList(msg.from),
      ]);
      others.delete(selfEmail);
      if (replyAddr) others.delete(replyAddr);
      setComposeMode("reply-all");
      setSendTo(replyAddr);
      setSendCc([...others].join(", "));
      setSendSubject(replySubject(msg.subject || ""));
      setSendBody(
        quoteReplyBody({
          from: msg.from,
          date: msg.date,
          bodyText: msg.bodyText,
        }),
      );
      setSendInReplyTo(msg.messageId || "");
      setSendReferences(
        buildReferencesHeader(msg.references, msg.messageId) || "",
      );
    } else {
      setComposeMode("reply");
      setSendTo(replyAddr);
      setSendCc("");
      setSendSubject(replySubject(msg.subject || ""));
      setSendBody(
        quoteReplyBody({
          from: msg.from,
          date: msg.date,
          bodyText: msg.bodyText,
        }),
      );
      setSendInReplyTo(msg.messageId || "");
      setSendReferences(
        buildReferencesHeader(msg.references, msg.messageId) || "",
      );
    }
    setSendSuccess("");
    setError("");
    requestAnimationFrame(() => {
      composeRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  }

  async function sendMail(e: React.FormEvent) {
    e.preventDefault();
    if (!user || !sendTo) return;
    setSendLoading(true);
    setError("");
    setSendSuccess("");
    try {
      const res = await fetch(`/api/domains/${enc}/mailboxes/send`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          user,
          to: sendTo,
          cc: sendCc,
          subject: sendSubject,
          body: sendBody,
          inReplyTo: sendInReplyTo,
          references: sendReferences,
        }),
      });
      const raw = await res.text();
      let data: { error?: string; ok?: boolean } = {};
      try {
        data = raw ? (JSON.parse(raw) as { error?: string; ok?: boolean }) : {};
      } catch {
        const preview = raw.replace(/\s+/g, " ").slice(0, 120);
        throw new Error(
          res.ok
            ? "Invalid server response."
            : `Send failed (${res.status}): ${preview || res.statusText}`,
        );
      }
      if (!res.ok) throw new Error(data.error ?? "Send failed.");
      setSendSuccess(`Message sent to ${sendTo}.`);
      resetCompose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error.");
    } finally {
      setSendLoading(false);
    }
  }

  async function copy() {
    if (!copyFrom || !copyTo || !user) return;
    setLoading(true);
    setError("");
    try {
      const res = await fetch(`/api/domains/${enc}/mailboxes`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ from: copyFrom, to: copyTo, user }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Copy failed.");
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error.");
    } finally {
      setLoading(false);
    }
  }

  const sourceLabel =
    source === "doveadm"
      ? "Dovecot (doveadm)"
      : source === "maildir"
        ? "Maildir scan"
        : source ?? null;

  return (
    <div className="space-y-6">
      <DomainPageHeader
        domain={domain}
        title={webmailMode ? `Qmail - ${user || "mailbox"}` : "IMAP mailboxes"}
      />
      <p className="text-sm text-panel-muted">
        Browse folders and read mail via{" "}
        <a
          href="https://doc.dovecot.org/"
          className="text-panel-accent hover:underline"
          target="_blank"
          rel="noreferrer"
        >
          Dovecot
        </a>{" "}
        (Maildir on disk; doveadm when available).
      </p>
      {error && <Alert>{error}</Alert>}
      {sendSuccess && <Alert variant="success">{sendSuccess}</Alert>}
      <Card>
        <div className="flex flex-wrap items-end gap-3">
          <div>
            <Label>Mailbox user</Label>
            {users.length > 0 ? (
              <select
                className="mt-1 block w-48 rounded-lg border border-panel-border bg-panel-bg px-3 py-2 text-sm text-white"
                value={user}
                onChange={(e) => setUser(e.target.value)}
              >
                {users.map((u) => (
                  <option key={u.user} value={u.user}>
                    {u.label ?? u.email ?? u.user}
                  </option>
                ))}
              </select>
            ) : (
              <Input
                value={user}
                onChange={(e) => setUser(e.target.value)}
                className="mt-1 w-48"
                placeholder="info"
              />
            )}
          </div>
          <Button onClick={load} disabled={loading || !user}>
            {loading ? "Loading…" : "Load folders"}
          </Button>
          {user && webmailMode ? null : user ? (
            <Link
              href={`/domains/${enc}/mail/${encodeURIComponent(user)}`}
              className="inline-flex items-center rounded-lg border border-panel-border bg-panel-accent/10 px-3 py-2 text-sm font-medium text-white hover:bg-panel-accent/25"
            >
              Open Qmail
            </Link>
          ) : (
            <span className="text-xs text-panel-muted">
              Enter a mailbox user, then open Qmail
            </span>
          )}
          {sourceLabel && <Badge>{sourceLabel}</Badge>}
          {authUser && (
            <span className="text-xs text-panel-muted">
              Dovecot user: <code className="text-white">{authUser}</code>
            </span>
          )}
        </div>
        <p className="mt-4 text-xs text-panel-muted">
          Click a folder to list messages; click a message to read it.
        </p>
        <table className="mt-4 w-full text-left text-sm">
          <thead className="text-panel-muted">
            <tr>
              <th className="py-2">Folder</th>
              <th className="py-2">Messages</th>
              <th className="py-2">Size</th>
            </tr>
          </thead>
          <tbody>
            {mailboxes.map((m, i) => (
              <tr
                key={`${m.folder}-${i}`}
                className={`cursor-pointer border-t border-panel-border/50 hover:bg-panel-border/20 ${
                  selectedFolder === m.folder ? "bg-panel-border/30" : ""
                }`}
                onClick={() => void loadMessages(m.folder)}
              >
                <td className="py-3 text-white">{m.folder}</td>
                <td className="py-3">{m.messages ?? " - "}</td>
                <td className="py-3 text-panel-muted">{m.size ?? " - "}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {user && mailboxes.length === 0 && !loading && (
          <p className="py-6 text-center text-panel-muted">
            No folders found. Check Dovecot is running and mail exists for this user.
          </p>
        )}
      </Card>

      {selectedFolder && (
        <Card>
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-lg font-medium text-white">
              {selectedFolder}
            </h2>
            {messagesSource && <Badge>{messagesSource}</Badge>}
            {messagesLoading && (
              <span className="text-sm text-panel-muted">Loading…</span>
            )}
            <Input
              className="ml-auto max-w-xs"
              placeholder="Search subject or from…"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
          </div>
          <table className="mt-4 w-full text-left text-sm">
            <thead className="text-panel-muted">
              <tr>
                <th className="py-2">Subject</th>
                <th className="py-2">From</th>
                <th className="py-2">Date</th>
                <th className="py-2">Size</th>
              </tr>
            </thead>
            <tbody>
              {filteredMessages.map((msg) => (
                <tr
                  key={msg.id}
                  className={`cursor-pointer border-t border-panel-border/50 hover:bg-panel-border/20 ${
                    selectedMessage?.id === msg.id ? "bg-panel-border/30" : ""
                  }`}
                  onClick={() => void openMessage(msg.id)}
                >
                  <td className="max-w-xs truncate py-3 text-white">
                    {msg.subject || "(no subject)"}
                  </td>
                  <td className="max-w-[12rem] truncate py-3 text-panel-muted">
                    {msg.from || " - "}
                  </td>
                  <td className="py-3 text-panel-muted">{msg.date || " - "}</td>
                  <td className="py-3 text-panel-muted">{msg.size || " - "}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {!messagesLoading && messages.length === 0 && (
            <p className="py-6 text-center text-panel-muted">
              No messages in this folder.
            </p>
          )}
        </Card>
      )}

      {(selectedMessage || messageLoading) && (
        <Card>
          <h2 className="text-lg font-medium text-white">
            {messageLoading
              ? "Loading message…"
              : selectedMessage?.subject || "(no subject)"}
          </h2>
          {selectedMessage && !messageLoading && (
            <div className="mt-3 space-y-2 text-sm text-panel-muted">
              <div className="flex flex-wrap gap-2">
                <Button
                  type="button"
                  variant="secondary"
                  onClick={() => startReply("reply", selectedMessage)}
                >
                  Reply
                </Button>
                <Button
                  type="button"
                  variant="secondary"
                  onClick={() => startReply("reply-all", selectedMessage)}
                >
                  Reply all
                </Button>
                <Button
                  type="button"
                  variant="secondary"
                  onClick={() => startReply("forward", selectedMessage)}
                >
                  Forward
                </Button>
              </div>
              {selectedMessage.from && (
                <p>
                  <span className="text-panel-muted">From: </span>
                  <span className="text-white">{selectedMessage.from}</span>
                </p>
              )}
              {selectedMessage.to && (
                <p>
                  <span className="text-panel-muted">To: </span>
                  <span className="text-white">{selectedMessage.to}</span>
                </p>
              )}
              {selectedMessage.date && (
                <p>
                  <span className="text-panel-muted">Date: </span>
                  <span className="text-white">{selectedMessage.date}</span>
                </p>
              )}
              <pre className="mt-4 max-h-[28rem] overflow-auto whitespace-pre-wrap rounded-lg border border-panel-border bg-panel-bg p-4 text-sm text-white">
                {selectedMessage.bodyText?.trim() ||
                  "(No plain-text body - check headers below.)"}
              </pre>
              {selectedMessage.rawHeaders && (
                <details className="mt-2">
                  <summary className="cursor-pointer text-panel-accent">
                    Raw headers
                  </summary>
                  <pre className="mt-2 max-h-48 overflow-auto whitespace-pre-wrap text-xs text-panel-muted">
                    {selectedMessage.rawHeaders}
                  </pre>
                </details>
              )}
            </div>
          )}
        </Card>
      )}

      {user && (
        <div ref={composeRef}>
        <Card>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-lg font-medium text-white">
              {composeMode === "reply"
                ? "Reply"
                : composeMode === "reply-all"
                  ? "Reply all"
                  : composeMode === "forward"
                    ? "Forward"
                    : "Compose email"}
            </h2>
            {composeMode !== "new" && (
              <Button type="button" variant="ghost" onClick={resetCompose}>
                New message
              </Button>
            )}
          </div>
          <p className="mt-1 text-sm text-panel-muted">
            Sends via Postfix as {user}@{domain}. Replies include threading headers when
            the original message had a Message-ID.
          </p>
          <form onSubmit={sendMail} className="mt-4 grid gap-3">
            <div>
              <Label>To</Label>
              <Input
                className="mt-1"
                type="text"
                placeholder="recipient@example.com"
                value={sendTo}
                onChange={(e) => setSendTo(e.target.value)}
                required
              />
            </div>
            <div>
              <Label>Cc (optional)</Label>
              <Input
                className="mt-1"
                type="text"
                placeholder="cc1@example.com, cc2@example.com"
                value={sendCc}
                onChange={(e) => setSendCc(e.target.value)}
              />
            </div>
            <div>
              <Label>Subject</Label>
              <Input
                className="mt-1"
                value={sendSubject}
                onChange={(e) => setSendSubject(e.target.value)}
              />
            </div>
            <div>
              <Label>Message</Label>
              <Textarea
                className="mt-1"
                rows={5}
                value={sendBody}
                onChange={(e) => setSendBody(e.target.value)}
                required
              />
            </div>
            <Button type="submit" disabled={sendLoading || !sendTo}>
              {sendLoading ? "Sending…" : "Send"}
            </Button>
          </form>
        </Card>
        </div>
      )}

      {isAdmin && (
        <Card>
          <h2 className="text-lg font-medium text-white">Copy mailbox</h2>
          <p className="mt-1 text-sm text-panel-muted">
            Copy all messages between IMAP folders (e.g. INBOX → Archive) via doveadm.
          </p>
          <div className="mt-4 flex flex-wrap gap-2">
            <Input
              placeholder="From folder (INBOX)"
              value={copyFrom}
              onChange={(e) => setCopyFrom(e.target.value)}
            />
            <Input
              placeholder="To folder"
              value={copyTo}
              onChange={(e) => setCopyTo(e.target.value)}
            />
            <Button onClick={copy} disabled={loading || !user || !copyFrom || !copyTo}>
              Copy
            </Button>
          </div>
        </Card>
      )}
    </div>
  );
}
