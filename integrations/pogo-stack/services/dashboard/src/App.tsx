import { useCallback, useEffect, useState } from "react";
import {
  createAccount,
  deviceKind,
  fetchAccounts,
  fetchMe,
  fetchRotomDevices,
  fetchStats,
  login,
  logout,
  releaseAccount,
  runDeviceAction,
  serviceLinks,
  type Account,
  type AccountStats,
  type AdminUser,
  type DeviceAction,
  type RotomDevice,
} from "./api";

type Tab = "overzicht" | "telefoons" | "accounts";

function badge(account: Account) {
  if (account.banned || account.shadowbanned) return <span className="badge bad">Banned</span>;
  if (account.captcha) return <span className="badge warn">Captcha</span>;
  if (account.warning) return <span className="badge warn">Warning</span>;
  if (account.in_use) return <span className="badge warn">In gebruik</span>;
  return <span className="badge ok">Beschikbaar</span>;
}

function deviceBadge(device: RotomDevice) {
  if (!device.enabled) return <span className="badge idle">Uit</span>;
  if (device.is_connected) return <span className="badge ok">Online</span>;
  return <span className="badge idle">Offline</span>;
}

function kindClass(device: RotomDevice) {
  const kind = deviceKind(device);
  if (kind === "iOS") return "ios";
  if (kind === "Redroid") return "idle";
  return "ok";
}

function formatSeen(ms?: number) {
  if (!ms) return "—";
  const delta = Date.now() - ms;
  if (delta < 60_000) return "zojuist";
  if (delta < 3_600_000) return `${Math.floor(delta / 60_000)}m geleden`;
  if (delta < 86_400_000) return `${Math.floor(delta / 3_600_000)}u geleden`;
  return new Date(ms).toLocaleString();
}

function LoginScreen({ onLoggedIn }: { onLoggedIn: (user: AdminUser) => void }) {
  const [username, setUsername] = useState("admin");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setBusy(true);
    try {
      const user = await login(username.trim(), password);
      onLoggedIn(user);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Inloggen mislukt");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="login-shell">
      <form className="login-card" onSubmit={onSubmit}>
        <p className="login-kicker">PoGo Stack</p>
        <h1>Inloggen</h1>
        <p className="hint">Beheer accounts, Android- en iPhones vanaf één plek.</p>
        <label>
          Gebruikersnaam
          <input
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            autoComplete="username"
            required
          />
        </label>
        <label>
          Wachtwoord
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="current-password"
            required
          />
        </label>
        {error ? <p className="error">{error}</p> : null}
        <button type="submit" disabled={busy}>
          {busy ? "Bezig…" : "Inloggen"}
        </button>
      </form>
    </div>
  );
}

export default function App() {
  const [user, setUser] = useState<AdminUser | null>(null);
  const [boot, setBoot] = useState(true);

  useEffect(() => {
    void fetchMe().then((next) => {
      setUser(next);
      setBoot(false);
    });
  }, []);

  if (boot) {
    return (
      <div className="login-shell">
        <p className="hint">Laden…</p>
      </div>
    );
  }

  if (!user) {
    return (
      <LoginScreen
        onLoggedIn={(next) => {
          setUser(next);
          if (window.location.pathname === "/login") {
            window.history.replaceState(null, "", "/");
          }
        }}
      />
    );
  }

  return (
    <Dashboard
      user={user}
      onLogout={() => {
        setUser(null);
      }}
    />
  );
}

function Dashboard({ user, onLogout }: { user: AdminUser; onLogout: () => void }) {
  const [tab, setTab] = useState<Tab>("telefoons");
  const [stats, setStats] = useState<AccountStats | null>(null);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [devices, setDevices] = useState<RotomDevice[]>([]);
  const [devicesError, setDevicesError] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState("");
  const [form, setForm] = useState({
    auth_service: "ptc",
    username: "",
    password: "",
    notes: "",
  });

  const refresh = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const [nextStats, nextAccounts, rotom] = await Promise.all([
        fetchStats(),
        fetchAccounts(),
        fetchRotomDevices(),
      ]);
      setStats(nextStats);
      setAccounts(nextAccounts);
      setDevices(rotom.devices);
      setDevicesError(rotom.error ?? "");
    } catch (err) {
      const message = err instanceof Error ? err.message : "Laden mislukt";
      if (message === "Niet ingelogd") {
        onLogout();
        return;
      }
      setError(message);
    } finally {
      setLoading(false);
    }
  }, [onLogout]);

  useEffect(() => {
    void refresh();
    const timer = window.setInterval(() => void refresh(), 15000);
    return () => window.clearInterval(timer);
  }, [refresh]);

  async function onCreate(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    try {
      await createAccount({
        auth_service: form.auth_service as "ptc" | "google",
        username: form.username.trim(),
        password: form.password,
        notes: form.notes.trim() || undefined,
      });
      setForm({ auth_service: "ptc", username: "", password: "", notes: "" });
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Account opslaan mislukt");
    }
  }

  async function onRelease(id: number) {
    setError("");
    try {
      await releaseAccount(id);
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Release mislukt");
    }
  }

  async function onDeviceAction(device: RotomDevice, action: DeviceAction) {
    const labels: Record<DeviceAction, string> = {
      restart: "app herstarten",
      reboot: "telefoon rebooten",
      disable: "uitschakelen",
      enable: "inschakelen",
      disconnect: "verbinding verbreken",
      delete: "verwijderen uit Rotom",
    };
    if (!window.confirm(`${device.id} ${labels[action]}?`)) return;
    setBusyId(`${device.id}:${action}`);
    setDevicesError("");
    try {
      await runDeviceAction(device.id, action);
      await refresh();
    } catch (err) {
      setDevicesError(err instanceof Error ? err.message : "Actie mislukt");
    } finally {
      setBusyId("");
    }
  }

  async function onLogoutClick() {
    await logout().catch(() => undefined);
    onLogout();
  }

  const online = devices.filter((d) => d.is_connected).length;

  return (
    <div className="layout">
      <div className="hero">
        <div>
          <h1>PoGo Stack</h1>
          <p>
            Ingelogd als <strong>{user.username}</strong>. Beheer telefoons, accounts en de mapping-stack.
          </p>
        </div>
        <div className="hero-actions">
          <button type="button" className="secondary" onClick={() => void refresh()} disabled={loading}>
            Vernieuwen
          </button>
          <button type="button" className="secondary" onClick={() => void onLogoutClick()}>
            Uitloggen
          </button>
        </div>
      </div>

      <nav className="tabs">
        {(
          [
            ["overzicht", "Overzicht"],
            ["telefoons", "Telefoons"],
            ["accounts", "Accounts"],
          ] as const
        ).map(([id, label]) => (
          <button
            key={id}
            type="button"
            className={tab === id ? "tab active" : "tab"}
            onClick={() => setTab(id)}
          >
            {label}
            {id === "telefoons" ? <span className="tab-count">{online}</span> : null}
            {id === "accounts" ? <span className="tab-count">{stats?.total ?? 0}</span> : null}
          </button>
        ))}
      </nav>

      {tab === "overzicht" ? (
        <>
          <div className="grid">
            <div className="card">
              <h3>Telefoons online</h3>
              <div className="value">
                {online}/{devices.length}
              </div>
            </div>
            <div className="card">
              <h3>Accounts beschikbaar</h3>
              <div className="value">{stats?.available ?? "—"}</div>
            </div>
            <div className="card">
              <h3>In gebruik</h3>
              <div className="value">{stats?.in_use ?? "—"}</div>
            </div>
            <div className="card">
              <h3>Banned</h3>
              <div className="value">{stats?.banned ?? "—"}</div>
            </div>
          </div>
          <div className="panel">
            <div className="panel-header">
              <h2>Stack</h2>
            </div>
            <div className="links">
              {serviceLinks().map((link) => (
                <a key={link.name} href={link.url}>
                  {link.name}
                </a>
              ))}
            </div>
            <p className="hint">Kaart, Koji en Rotom vereisen dezelfde login.</p>
          </div>
        </>
      ) : null}

      {tab === "telefoons" ? (
        <div className="panel">
          <div className="panel-header">
            <h2>Telefoons</h2>
            <span className="badge idle">{online} online</span>
          </div>
          <p className="hint">
            Android (Cosmog) en jailbreak-iPhones (Exeggcute) delen dezelfde Rotom-pool. Herstart of
            reboot vanaf hier; nieuwe toestellen koppel je eenmalig met{" "}
            <code>provision-android.sh</code> of <code>provision-ios.sh</code>.
          </p>
          {devicesError ? <p className="error">{devicesError}</p> : null}
          {!devicesError && devices.length === 0 ? (
            <p className="hint">Nog geen workers verbonden. Koppel een telefoon en ververs.</p>
          ) : null}
          {devices.length ? (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Toestel</th>
                    <th>Soort</th>
                    <th>Status</th>
                    <th>Workers</th>
                    <th>Herkomen</th>
                    <th>Laatst gezien</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {devices.map((device) => (
                    <tr key={device.id}>
                      <td>{device.id}</td>
                      <td>
                        <span className={`badge ${kindClass(device)}`}>{deviceKind(device)}</span>
                      </td>
                      <td>{deviceBadge(device)}</td>
                      <td>
                        {device.worker_in_use_count ?? 0}/{device.worker_count ?? 0}
                      </td>
                      <td>{device.origin ?? device.public_ip ?? "—"}</td>
                      <td>{formatSeen(device.last_seen_at_ms)}</td>
                      <td>
                        <div className="row-actions">
                          <button
                            type="button"
                            className="secondary"
                            disabled={busyId.startsWith(device.id) || !device.is_connected}
                            onClick={() => void onDeviceAction(device, "restart")}
                          >
                            Herstart
                          </button>
                          <button
                            type="button"
                            className="secondary"
                            disabled={busyId.startsWith(device.id) || !device.is_connected}
                            onClick={() => void onDeviceAction(device, "reboot")}
                          >
                            Reboot
                          </button>
                          {device.enabled ? (
                            <button
                              type="button"
                              className="secondary"
                              disabled={!!busyId}
                              onClick={() => void onDeviceAction(device, "disable")}
                            >
                              Uit
                            </button>
                          ) : (
                            <button
                              type="button"
                              className="secondary"
                              disabled={!!busyId}
                              onClick={() => void onDeviceAction(device, "enable")}
                            >
                              Aan
                            </button>
                          )}
                          <button
                            type="button"
                            className="secondary"
                            disabled={busyId.startsWith(device.id) || !device.is_connected}
                            onClick={() => void onDeviceAction(device, "disconnect")}
                          >
                            Disconnect
                          </button>
                          {!device.is_connected ? (
                            <button
                              type="button"
                              className="danger"
                              disabled={!!busyId}
                              onClick={() => void onDeviceAction(device, "delete")}
                            >
                              Weg
                            </button>
                          ) : null}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}
        </div>
      ) : null}

      {tab === "accounts" ? (
        <>
          <div className="panel">
            <div className="panel-header">
              <h2>Account toevoegen</h2>
            </div>
            <p className="hint">PTC- of Google-inlog voor de scanner-workers. Dit is geen OAuth.</p>
            <form onSubmit={onCreate}>
              <div className="form-grid">
                <select
                  value={form.auth_service}
                  onChange={(e) => setForm((f) => ({ ...f, auth_service: e.target.value }))}
                  aria-label="Auth service"
                >
                  <option value="ptc">Pokémon Trainer Club (PTC)</option>
                  <option value="google">Google-account</option>
                </select>
                <input
                  placeholder={form.auth_service === "google" ? "Google e-mail" : "PTC-gebruikersnaam"}
                  value={form.username}
                  onChange={(e) => setForm((f) => ({ ...f, username: e.target.value }))}
                  required
                  autoComplete="username"
                />
                <input
                  placeholder="Wachtwoord"
                  type="password"
                  value={form.password}
                  onChange={(e) => setForm((f) => ({ ...f, password: e.target.value }))}
                  required
                  autoComplete="new-password"
                />
                <input
                  placeholder="Notitie (optioneel)"
                  value={form.notes}
                  onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
                />
              </div>
              {error ? <p className="error">{error}</p> : null}
              <button type="submit">Opslaan in pool</button>
            </form>
          </div>

          <div className="panel">
            <div className="panel-header">
              <h2>Accountpool</h2>
              <span className="badge idle">{accounts.length} rijen</span>
            </div>
            {error && !accounts.length ? <p className="error">{error}</p> : null}
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>User</th>
                    <th>Level</th>
                    <th>Team</th>
                    <th>Status</th>
                    <th>Systeem</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {accounts.map((account) => (
                    <tr key={account.id}>
                      <td>{account.username}</td>
                      <td>{account.level}</td>
                      <td>{account.team}</td>
                      <td>{badge(account)}</td>
                      <td>{account.system_id ?? "—"}</td>
                      <td>
                        {account.in_use ? (
                          <button type="button" className="secondary" onClick={() => void onRelease(account.id)}>
                            Release
                          </button>
                        ) : null}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </>
      ) : null}
    </div>
  );
}
