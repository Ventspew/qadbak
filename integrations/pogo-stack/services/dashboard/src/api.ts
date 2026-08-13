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

async function readError(res: Response): Promise<string> {
  const text = await res.text();
  try {
    const data = JSON.parse(text) as {
      detail?: string | Array<{ msg?: string; loc?: unknown }>;
      error?: string;
    };
    if (typeof data.detail === "string") return data.detail;
    if (Array.isArray(data.detail)) {
      return data.detail.map((d) => d.msg || JSON.stringify(d)).join("; ");
    }
    if (data.error) return data.error;
  } catch {
    /* not JSON */
  }
  return text || res.statusText || `HTTP ${res.status}`;
}

async function apiFetch(path: string, init?: RequestInit) {
  let res: Response;
  try {
    res = await fetch(path, {
      ...init,
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        ...(init?.headers ?? {}),
      },
    });
  } catch {
    throw new Error(
      "Could not reach Account API (failed to fetch). Check that account-api is up and /api/accounts is proxied.",
    );
  }
  if (!res.ok) {
    throw new Error(await readError(res));
  }
  if (res.status === 204) return null;
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
