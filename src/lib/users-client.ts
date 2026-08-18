import "server-only";
import bcrypt from "bcryptjs";
import type { PanelUser } from "./types";
import { validatePanelPassword } from "./password-policy";
import { loadUsers, saveUsers } from "./users";
import { requirePremiumFeature } from "./premium/guard";

const BCRYPT_ROUNDS = 12;

/**
 * Multi-tenant client account helpers.
 *
 * Provisioning entry points (create / mutate) are gated by the Premium
 * `multi-tenant-clients` feature. The read-only lookups remain unguarded
 * so the core panel can still display existing accounts on a downgrade.
 */

export async function findClientForDomain(
  domain: string,
): Promise<PanelUser | undefined> {
  const d = domain.trim().toLowerCase();
  const users = await loadUsers();
  return users.find(
    (u) =>
      u.role === "client" &&
      (u.domains ?? []).some((x) => x.toLowerCase() === d),
  );
}

export async function createClientUser(opts: {
  username: string;
  password: string;
  domains: string[];
}): Promise<PanelUser> {
  await requirePremiumFeature("multi-tenant-clients");
  const users = await loadUsers();
  const name = opts.username.trim();
  const key = name.toLowerCase();
  if (!key) throw new Error("Client username is required.");
  const existing = users.find((u) => u.username.toLowerCase() === key);
  if (existing) {
    if (existing.role !== "client") {
      throw new Error(`Username already used by an administrator: ${name}`);
    }
    throw new Error(`Panel client already exists: ${name}`);
  }
  const pwErr = validatePanelPassword(opts.password);
  if (pwErr) throw new Error(pwErr);
  const hash = await bcrypt.hash(opts.password, BCRYPT_ROUNDS);
  const user: PanelUser = {
    id: `client-${Date.now()}`,
    username: name,
    passwordHash: hash,
    role: "client",
    domains: [...opts.domains],
  };
  users.push(user);
  await saveUsers(users);
  return user;
}

export async function setClientPassword(
  username: string,
  password: string,
): Promise<PanelUser> {
  await requirePremiumFeature("multi-tenant-clients");
  const users = await loadUsers();
  const name = username.trim();
  const target = users.find(
    (u) => u.username.toLowerCase() === name.toLowerCase(),
  );
  if (!target) throw new Error(`Panel user not found: ${username}`);
  if (target.role !== "client") {
    throw new Error(`User is not a client account: ${username}`);
  }
  target.passwordHash = await bcrypt.hash(password, BCRYPT_ROUNDS);
  await saveUsers(users);
  return target;
}

export async function assignDomainToClient(
  username: string,
  domain: string,
): Promise<void> {
  await requirePremiumFeature("multi-tenant-clients");
  const users = await loadUsers();
  const d = domain.trim().toLowerCase();
  if (!d) throw new Error("Domain is required.");
  for (const u of users) {
    if (!u.domains) u.domains = [];
    u.domains = u.domains.filter((x) => x.toLowerCase() !== d);
  }
  const target = users.find(
    (u) => u.username.toLowerCase() === username.trim().toLowerCase(),
  );
  if (!target) throw new Error(`Panel user not found: ${username}`);
  if (target.role !== "client") {
    throw new Error(`User is not a client account: ${username}`);
  }
  if (!target.domains.some((x) => x.toLowerCase() === d)) {
    target.domains.push(d);
  }
  await saveUsers(users);
}
