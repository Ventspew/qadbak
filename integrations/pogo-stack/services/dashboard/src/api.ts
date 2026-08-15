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

export type AdminUser = {
  username: string;
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
    });
  } catch {
    throw new Error("Kan de API niet bereiken. Controleer of de stack draait.");
  }
  if (res.status === 401 && path !== "/api/auth/login" && path !== "/api/auth/me") {
    throw new Error("Niet ingelogd");
  }
  if (!res.ok) {
    throw new Error(await readError(res));
  }
  if (res.status === 204) return null;
  const contentType = res.headers.get("content-type") || "";
  if (!contentType.includes("application/json")) return null;
  return res.json();
}

export async function login(username: string, password: string): Promise<AdminUser> {
  return apiFetch("/api/auth/login", {
    method: "POST",
    body: JSON.stringify({ username, password }),
  }) as Promise<AdminUser>;
}

export async function logout(): Promise<void> {
  await apiFetch("/api/auth/logout", { method: "POST" });
}

export async function fetchMe(): Promise<AdminUser | null> {
  try {
    const res = await fetch("/api/auth/me", { credentials: "same-origin", headers: { Accept: "application/json" } });
    if (!res.ok) return null;
    return (await res.json()) as AdminUser;
  } catch {
    return null;
  }
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

export type RotomWorker = {
  id?: string;
  platform?: string;
  is_connected?: boolean;
  is_in_use?: boolean;
};

export type RotomDevice = {
  id: string;
  origin?: string;
  public_ip?: string;
  version?: string;
  worker_count?: number;
  worker_in_use_count?: number;
  is_connected?: boolean;
  can_be_used?: boolean;
  enabled?: boolean;
  last_seen_at_ms?: number;
  workers?: RotomWorker[];
};

export type DeviceAction = "restart" | "reboot" | "disable" | "enable" | "disconnect" | "delete";

export function deviceKind(device: RotomDevice): "iOS" | "Android" | "Redroid" | "Device" {
  const id = device.id.toLowerCase();
  const platform = device.workers?.find((w) => w.platform)?.platform?.toLowerCase() ?? "";
  if (platform === "ios" || id.startsWith("ios-") || id.startsWith("iphone-") || id.startsWith("ipad-")) {
    return "iOS";
  }
  if (id.startsWith("redroid-")) return "Redroid";
  if (platform === "android" || id.startsWith("android-") || id.startsWith("pixel-") || id.startsWith("atv-")) {
    return "Android";
  }
  return "Device";
}

export async function fetchRotomDevices(): Promise<{ devices: RotomDevice[]; error?: string }> {
  try {
    const data = (await apiFetch("/api/devices")) as { devices?: RotomDevice[] };
    return { devices: data.devices ?? [] };
  } catch (err) {
    return {
      devices: [],
      error: err instanceof Error ? err.message : "Rotom is niet bereikbaar",
    };
  }
}

export function runDeviceAction(deviceId: string, action: DeviceAction) {
  return apiFetch(`/api/devices/${encodeURIComponent(deviceId)}/action/${action}`, {
    method: "PUT",
  });
}

export function serviceLinks(): ServiceLink[] {
  return [
    { name: "ReactMap", url: "/map/", description: "Kaart" },
    { name: "Koji", url: "/koji/", description: "Geofences" },
    { name: "Rotom", url: "/rotom/", description: "Device controller" },
  ];
}
