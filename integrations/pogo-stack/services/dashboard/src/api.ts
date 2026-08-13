export type AccountStats = {
  total: number;
  available: number;
  in_use: number;
  banned: number;
  shadowbanned: number;
  warning: number;
};

export type Account = {
  id: number;
  auth_service: string;
  username: string;
  level: number;
  team: string;
  in_use: boolean;
  system_id: string | null;
  banned: boolean;
  shadowbanned: boolean;
  warning: boolean;
  captcha: boolean;
  notes: string | null;
  updated_at: string;
};

const apiKey = import.meta.env.VITE_API_KEY ?? "";

async function apiFetch(path: string, init?: RequestInit) {
  const res = await fetch(path, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(apiKey ? { "X-API-Key": apiKey } : {}),
      ...(init?.headers ?? {}),
    },
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(text || res.statusText);
  }
  return res.json();
}

export function fetchStats() {
  return apiFetch("/api/accounts/stats") as Promise<AccountStats>;
}

export function fetchAccounts() {
  return apiFetch("/api/accounts") as Promise<Account[]>;
}

export function createAccount(payload: {
  auth_service: "ptc" | "google";
  username: string;
  password: string;
  notes?: string;
}) {
  return apiFetch("/api/accounts", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function releaseAccount(accountId: number) {
  return apiFetch("/api/accounts/release", {
    method: "POST",
    body: JSON.stringify({ account_id: accountId }),
  });
}

export type ServiceLink = {
  name: string;
  url: string;
  description: string;
};

export function serviceLinks(): ServiceLink[] {
  return [
    { name: "ReactMap", url: "/map/", description: "Map frontend" },
    { name: "Koji", url: "/koji/", description: "Geofence manager" },
    { name: "Account API docs", url: "/api/docs", description: "OpenAPI docs" },
  ];
}
