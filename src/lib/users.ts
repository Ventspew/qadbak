import bcrypt from "bcryptjs";
import { copyFile, mkdir, readFile, stat } from "fs/promises";
import path from "path";
import type { PanelUser } from "./types";
import { writeJsonAtomic } from "./write-json-atomic";

const USERS_PATH = path.join(process.cwd(), "data", "users.json");
const EXAMPLE_PATH = path.join(process.cwd(), "data", "users.example.json");
const USERS_MODE = 0o600;

export const WEAK_PASSWORDS = new Set(["changeme", "password", "admin123", "password123"]);

let cache: PanelUser[] | null = null;
let cacheMtimeMs = 0;

async function ensureUsersFile(): Promise<void> {
  try {
    await readFile(USERS_PATH, "utf8");
    return;
  } catch {
    // fall through
  }
  await mkdir(path.dirname(USERS_PATH), { recursive: true });
  try {
    await copyFile(EXAMPLE_PATH, USERS_PATH);
  } catch {
    const hash = await bcrypt.hash("changeme", 12);
    const seed: PanelUser[] = [
      {
        id: "admin-1",
        username: "admin",
        passwordHash: hash,
        role: "admin",
        domains: [],
      },
      {
        id: "client-1",
        username: "client",
        passwordHash: hash,
        role: "client",
        domains: ["example.com"],
      },
    ];
    await writeJsonAtomic(USERS_PATH, seed, USERS_MODE);
  }
}

export function invalidateUsersCache(): void {
  cache = null;
  cacheMtimeMs = 0;
}

export async function saveUsers(users: PanelUser[]): Promise<void> {
  await ensureUsersFile();
  await writeJsonAtomic(USERS_PATH, users, USERS_MODE);
  invalidateUsersCache();
}

export function isWeakPassword(password: string): boolean {
  return WEAK_PASSWORDS.has(password.trim().toLowerCase());
}

/** Block default passwords on production login (E2E sets QADBAK_ALLOW_WEAK_PASSWORDS=true). */
export function isWeakPasswordLoginBlocked(password: string): boolean {
  if (process.env.NODE_ENV !== "production") return false;
  if (process.env.QADBAK_ALLOW_WEAK_PASSWORDS === "true") return false;
  return isWeakPassword(password);
}

export async function loadUsers(): Promise<PanelUser[]> {
  await ensureUsersFile();
  const { mtimeMs } = await stat(USERS_PATH);
  if (cache && mtimeMs === cacheMtimeMs) return cache;
  const raw = await readFile(USERS_PATH, "utf8");
  cache = JSON.parse(raw) as PanelUser[];
  cacheMtimeMs = mtimeMs;
  return cache;
}

export async function findUserByUsername(
  username: string,
): Promise<PanelUser | undefined> {
  const users = await loadUsers();
  return users.find(
    (u) => u.username.toLowerCase() === username.toLowerCase(),
  );
}

export async function verifyPassword(
  user: PanelUser,
  password: string,
): Promise<boolean> {
  return bcrypt.compare(password, user.passwordHash);
}

export async function findUserById(id: string): Promise<PanelUser | undefined> {
  const users = await loadUsers();
  return users.find((u) => u.id === id);
}

export async function setUserTotpSecret(
  userId: string,
  secret: string | null,
): Promise<void> {
  const users = await loadUsers();
  const idx = users.findIndex((u) => u.id === userId);
  if (idx < 0) throw new Error("User not found.");
  if (secret) users[idx]!.totpSecret = secret;
  else delete users[idx]!.totpSecret;
  await saveUsers(users);
}

