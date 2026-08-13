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
  if (text.trim().startsWith("<!")) {
    return `API returned HTML (${res.status}) instead of JSON — hard-refresh the page (Ctrl/Cmd+Shift+R).`;
  }
  return text || res.statusText || `HTTP ${res.status}`;
}

async function apiFetch(path: string, init?: RequestInit) {
  const method = (init?.method || "GET").toUpperCase();
  const headers: Record<string, string> = {
    Accept: "application/json",
    ...((init?.headers as Record<string, string>) ?? {}),
  };
  if (method !== "GET" && method !== "HEAD") {
    headers["Content-Type"] = "application/json";
  }

  let res: Response;
  try {
    res = await fetch(path, {
      ...init,
      method,
      headers,
      credentials: "same-origin",
      cache: "no-store",
    });
  } catch (err) {
    const why = err instanceof Error ? err.message : String(err);
    throw new Error(
      `Could not reach Account API (${why}). Hard-refresh this page. If it keeps failing: curl -sS https://pogo.inveil.net/api/health`,
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

/** ReactMap/Koji need their own hostnames — path proxies cause white screens. */
function mappingHosts() {
  if (typeof window === "undefined") {
    return { map: "/map/", koji: "/koji/" };
  }
  const host = window.location.hostname;
  const parent = host.startsWith("pogo.") ? host.slice("pogo.".length) : host;
  if (!parent || parent === host) {
    return { map: "/map/", koji: "/koji/" };
  }
  return {
    map: `${window.location.protocol}//map.${parent}/`,
    koji: `${window.location.protocol}//koji.${parent}/`,
  };
}

export function serviceLinks(): ServiceLink[] {
  const hosts = mappingHosts();
  return [
    { name: "ReactMap", url: hosts.map, description: "Map frontend" },
    { name: "Koji", url: hosts.koji, description: "Geofence manager" },
    { name: "Account API docs", url: "/api/docs", description: "OpenAPI docs" },
  ];
}
