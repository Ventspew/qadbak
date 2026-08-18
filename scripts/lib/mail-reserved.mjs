/** Locals that collide with Next.js mail tabs under /domains/[domain]/mail/*. */
export const RESERVED_MAILBOX_LOCALS = new Set([
  "accounts",
  "newsletter",
  "settings",
  "logs",
  "imap",
  "mail",
]);
