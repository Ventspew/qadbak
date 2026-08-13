import { useCallback, useEffect, useState } from "react";
import {
  createAccount,
  fetchAccounts,
  fetchStats,
  releaseAccount,
  serviceLinks,
  type Account,
  type AccountStats,
} from "./api";

function badge(account: Account) {
  if (account.banned || account.shadowbanned) return <span className="badge bad">Banned</span>;
  if (account.captcha) return <span className="badge warn">Captcha</span>;
  if (account.warning) return <span className="badge warn">Warning</span>;
  if (account.in_use) return <span className="badge warn">In use</span>;
  return <span className="badge ok">Available</span>;
}

export default function App() {
  const [stats, setStats] = useState<AccountStats | null>(null);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
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
      const [nextStats, nextAccounts] = await Promise.all([fetchStats(), fetchAccounts()]);
      setStats(nextStats);
      setAccounts(nextAccounts);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load data");
    } finally {
      setLoading(false);
    }
  }, []);

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
      setError(err instanceof Error ? err.message : "Could not create account");
    }
  }

  async function onRelease(id: number) {
    setError("");
    try {
      await releaseAccount(id);
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not release account");
    }
  }

  return (
    <div className="layout">
      <div className="hero">
        <div>
          <h1>PoGo Stack Dashboard</h1>
          <p>Accounts, services, and links for your Qadbak-hosted stack.</p>
        </div>
        <button type="button" onClick={() => void refresh()} disabled={loading}>
          Refresh
        </button>
      </div>

      <div className="grid">
        <div className="card">
          <h3>Total accounts</h3>
          <div className="value">{stats?.total ?? "—"}</div>
        </div>
        <div className="card">
          <h3>Available</h3>
          <div className="value">{stats?.available ?? "—"}</div>
        </div>
        <div className="card">
          <h3>In use</h3>
          <div className="value">{stats?.in_use ?? "—"}</div>
        </div>
        <div className="card">
          <h3>Banned</h3>
          <div className="value">{stats?.banned ?? "—"}</div>
        </div>
      </div>

      <div className="panel">
        <div className="panel-header">
          <h2>Stack services</h2>
        </div>
        <div className="links">
          {serviceLinks().map((link) => (
            <a key={link.name} href={link.url} target="_blank" rel="noreferrer">
              {link.name}
            </a>
          ))}
        </div>
      </div>

      <div className="panel">
        <div className="panel-header">
          <h2>Add account</h2>
        </div>
        <form onSubmit={onCreate}>
          <div className="form-grid">
            <select
              value={form.auth_service}
              onChange={(e) => setForm((f) => ({ ...f, auth_service: e.target.value }))}
            >
              <option value="ptc">PTC</option>
              <option value="google">Google</option>
            </select>
            <input
              placeholder="Username"
              value={form.username}
              onChange={(e) => setForm((f) => ({ ...f, username: e.target.value }))}
              required
            />
            <input
              placeholder="Password"
              type="password"
              value={form.password}
              onChange={(e) => setForm((f) => ({ ...f, password: e.target.value }))}
              required
            />
            <input
              placeholder="Notes (optional)"
              value={form.notes}
              onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
            />
          </div>
          <button type="submit">Add account</button>
        </form>
      </div>

      <div className="panel">
        <div className="panel-header">
          <h2>Accounts</h2>
          <span className="badge idle">{accounts.length} rows</span>
        </div>
        {error ? <p className="error">{error}</p> : null}
        <table>
          <thead>
            <tr>
              <th>User</th>
              <th>Level</th>
              <th>Team</th>
              <th>Status</th>
              <th>System</th>
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
  );
}
