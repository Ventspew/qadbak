"use client";

import { Alert, Button, Card, Input, Label } from "@/components/ui";
import type {
  PhpDirectory,
  PhpIniSetting,
  PhpVersion,
} from "@/lib/provisioner";
import { useDomainNavReset } from "@/hooks/useDomainNavReset";
import { useState } from "react";
import { DomainPageHeader } from "./DomainPageHeader";

export function PhpManager({
  domain,
  initialVersions,
  initialDirectories,
  initialIni,
  isAdmin,
  initialError,
}: {
  domain: string;
  initialVersions: PhpVersion[];
  initialDirectories: PhpDirectory[];
  initialIni: PhpIniSetting[];
  isAdmin: boolean;
  initialError: string;
}) {
  const enc = encodeURIComponent(domain);
  const [versions] = useState(initialVersions);
  const [directories, setDirectories] = useState(initialDirectories);
  const [ini, setIni] = useState(initialIni);
  const [error, setError] = useState(initialError);
  const [success, setSuccess] = useState("");
  const [loading, setLoading] = useState(false);
  const [dir, setDir] = useState("public_html");
  const [version, setVersion] = useState(initialVersions[0]?.version ?? "8.3");
  const [iniName, setIniName] = useState("");
  const [iniValue, setIniValue] = useState("");

  useDomainNavReset(domain, () => {
    setDirectories(initialDirectories);
    setIni(initialIni);
    setError(initialError);
    setSuccess("");
    setVersion(initialVersions[0]?.version ?? "8.3");
    setDir("public_html");
  });

  async function refresh() {
    const res = await fetch(`/api/domains/${enc}/php`);
    const data = await res.json();
    if (res.ok) {
      setDirectories(data.directories ?? []);
      setIni(data.ini ?? []);
    }
  }

  async function setDirectory(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError("");
    setSuccess("");
    try {
      const res = await fetch(`/api/domains/${enc}/php`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ dir, version }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Save failed.");
      setSuccess(`PHP-FPM pool for ${dir} is now ${version}.`);
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error.");
    } finally {
      setLoading(false);
    }
  }

  async function removeDirectory(targetDir: string) {
    setLoading(true);
    setError("");
    try {
      const res = await fetch(`/api/domains/${enc}/php`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ dir: targetDir }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Delete failed.");
      setSuccess("PHP directory mapping and extra FPM pool removed.");
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error.");
    } finally {
      setLoading(false);
    }
  }

  async function saveIni(e: React.FormEvent) {
    e.preventDefault();
    if (!iniName) return;
    setLoading(true);
    setError("");
    setSuccess("");
    try {
      const res = await fetch(`/api/domains/${enc}/php`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "ini",
          name: iniName,
          value: iniValue,
          version,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Save failed.");
      setSuccess(`php.ini: ${iniName} updated.`);
      setIniName("");
      setIniValue("");
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="space-y-6">
      <DomainPageHeader
        domain={domain}
        title="PHP"
        description="One PHP-FPM pool per directory. Extra folders get their own socket and nginx location."
      />
      {error && <Alert>{error}</Alert>}
      {success && <Alert variant="success">{success}</Alert>}

      <Card>
        <h2 className="text-lg font-medium text-white">PHP per directory</h2>
        <form onSubmit={setDirectory} className="mt-4 grid gap-4 sm:grid-cols-3">
          <div>
            <Label htmlFor="dir">Directory</Label>
            <Input id="dir" value={dir} onChange={(e) => setDir(e.target.value)} />
          </div>
          <div>
            <Label htmlFor="ver">Version</Label>
            <select
              id="ver"
              className="w-full rounded-lg border border-panel-border bg-panel-bg px-3 py-2 text-sm"
              value={version}
              onChange={(e) => setVersion(e.target.value)}
            >
              {versions.map((v) => (
                <option key={v.version} value={v.version}>
                  {v.version}
                </option>
              ))}
            </select>
          </div>
          <div className="flex items-end">
            <Button type="submit" disabled={loading}>
              Apply
            </Button>
          </div>
        </form>
        <table className="mt-6 w-full text-left text-sm">
          <thead className="text-panel-muted">
            <tr>
              <th className="py-2">Directory</th>
              <th className="py-2">Version</th>
              <th className="py-2">Mode</th>
              {isAdmin && <th className="py-2 text-right">Actions</th>}
            </tr>
          </thead>
          <tbody>
            {directories.map((d) => (
              <tr key={d.dir} className="border-t border-panel-border/50">
                <td className="py-3 text-white">{d.dir}</td>
                <td className="py-3">{d.version ?? " - "}</td>
                <td className="py-3 text-panel-muted">{d.mode ?? " - "}</td>
                {isAdmin && (
                  <td className="py-3 text-right">
                    <Button
                      variant="danger"
                      onClick={() => removeDirectory(d.dir)}
                      disabled={loading}
                    >
                      Delete
                    </Button>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </Card>

      <Card>
        <h2 className="text-lg font-medium text-white">php.ini setting</h2>
        <form onSubmit={saveIni} className="mt-4 grid gap-4 sm:grid-cols-3">
          <div>
            <Label htmlFor="ininame">Directive</Label>
            <Input
              id="ininame"
              value={iniName}
              onChange={(e) => setIniName(e.target.value)}
              placeholder="memory_limit"
            />
          </div>
          <div>
            <Label htmlFor="inival">Value</Label>
            <Input
              id="inival"
              value={iniValue}
              onChange={(e) => setIniValue(e.target.value)}
            />
          </div>
          <div className="flex items-end">
            <Button type="submit" disabled={loading || !isAdmin}>
              Save
            </Button>
          </div>
        </form>
        <ul className="mt-4 divide-y divide-panel-border text-sm">
          {ini.map((s) => (
            <li key={s.name} className="flex justify-between py-2">
              <span className="text-white">{s.name}</span>
              <span className="text-panel-muted">{s.value}</span>
            </li>
          ))}
        </ul>
      </Card>
    </div>
  );
}
