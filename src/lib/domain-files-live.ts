import type { DomainFileEntry, DomainFileContent } from "./domain-files";
import { probeDomainFsSudo, runDomainFsInstallUpload, runDomainFsSudo } from "./domain-fs-sudo";
import {
  enrichEntry,
  isDirWritable,
  isTextFileName,
  languageForFile,
  mimeForFile,
  assertSafePanelPath,
  normalizeDir,
  resolveMoveDestination,
} from "./domain-files";
import {
  persistCanonicalWebRoot,
  resolveDomainFilesContext,
  type DomainFilesContext,
} from "./domain-files-context";
import { absUnderRoot, isAbsInsideRoot } from "./domain-docroot";
import { PanelError } from "./errors";
import type { HostedDomain } from "./types";
import type { Role } from "./types";

let liveFsProbe: boolean | null = null;

export function liveFilesEnabled(): boolean {
  return (
    process.env.QADBAK_LEGACY_API_MOCK !== "true" &&
    process.env.QADBAK_LIVE_FILES !== "false"
  );
}

async function runHelper(
  cmd: string,
  absPath: string,
  payload?: Record<string, unknown>,
  opts?: { timeoutMs?: number },
): Promise<Record<string, unknown>> {
  const args = [cmd, absPath];
  if (payload) args.push(JSON.stringify(payload));

  const stdout = await runDomainFsSudo(args, {
    timeout: opts?.timeoutMs ?? 30_000,
    maxBuffer: 8 * 1024 * 1024,
  });

  const line = stdout.trim().split("\n").pop() ?? "";
  const parsed = JSON.parse(line) as Record<string, unknown>;
  if (!parsed.ok) {
    throw new PanelError(String(parsed.error ?? "Filesystem command failed."));
  }
  markLiveFilesystemReady();
  return parsed;
}

/** Mark native FS as working after any successful helper call. */
export function markLiveFilesystemReady(): void {
  liveFsProbe = true;
}

export async function probeLiveFilesystem(): Promise<boolean> {
  if (!liveFilesEnabled()) return false;
  if (liveFsProbe === true) return true;
  const ok = await probeDomainFsSudo();
  if (ok) liveFsProbe = true;
  return ok;
}

async function filesContext(
  domain: HostedDomain | string,
  actor: { role: Role; domains: string[] },
): Promise<DomainFilesContext> {
  const name = typeof domain === "string" ? domain : domain.name;
  return resolveDomainFilesContext(name, actor);
}

function absDirFromPanel(ctx: DomainFilesContext, dir: string): string {
  const cwd = normalizeDir(dir);
  const abs = absUnderRoot(ctx.filesRoot, cwd);
  if (!isAbsInsideRoot(ctx.filesRoot, abs)) {
    throw new PanelError("Path is outside this domain's file tree.");
  }
  return abs;
}

function absFileFromPanel(ctx: DomainFilesContext, panelPath: string): string {
  const rel = panelPath.replace(/^\/+/, "");
  const abs = absUnderRoot(ctx.filesRoot, rel);
  if (!isAbsInsideRoot(ctx.filesRoot, abs)) {
    throw new PanelError("Path is outside this domain's file tree.");
  }
  return abs;
}

async function ensureFilesTree(ctx: DomainFilesContext): Promise<void> {
  if (ctx.filesRoot !== ctx.home) {
    try {
      await runHelper("mkdir", ctx.filesRoot);
    } catch {
      /* exists */
    }
  }
  if (ctx.webRoot !== ctx.filesRoot) {
    try {
      await runHelper("mkdir", ctx.webRoot);
    } catch {
      /* exists */
    }
  }
  if (ctx.migrateFrom && ctx.migrateFrom !== ctx.webRoot) {
    try {
      await runHelper("copy-tree", ctx.migrateFrom, { destAbs: ctx.webRoot });
    } catch {
      /* source missing */
    }
    try {
      await persistCanonicalWebRoot(ctx.domain, ctx.webRoot);
    } catch {
      /* panel can still list the canonical tree */
    }
  }
}

export async function listDomainFilesLive(
  domain: HostedDomain | string,
  dir: string,
  actor: { role: Role; domains: string[] },
): Promise<DomainFileEntry[]> {
  const ctx = await filesContext(domain, actor);
  await ensureFilesTree(ctx);
  const cwd = normalizeDir(assertSafePanelPath(dir));
  const abs = absDirFromPanel(ctx, cwd);
  const data = await runHelper("list", abs);
  const raw = (data.entries ?? []) as Array<{
    name: string;
    path?: string;
    type: string;
    sizeBytes?: number;
    modified?: string;
  }>;
  return raw.map((e) => {
    const panelPath = cwd ? `${cwd}/${e.name}` : e.name;
    return enrichEntry({
      name: e.name,
      path: panelPath.replace(/\/+/g, "/"),
      type: e.type === "dir" ? "dir" : "file",
      sizeBytes: e.sizeBytes,
      modified: e.modified,
      editable:
        e.type !== "dir" &&
        isTextFileName(e.name) &&
        isDirWritable(cwd),
      downloadable: e.type !== "dir",
      deletable: e.type !== "dir" && isDirWritable(cwd),
    });
  });
}

export async function readDomainFileLive(
  domain: HostedDomain | string,
  panelPath: string,
  actor: { role: Role; domains: string[] },
): Promise<DomainFileContent> {
  const safePath = assertSafePanelPath(panelPath);
  const ctx = await filesContext(domain, actor);
  const abs = absFileFromPanel(ctx, safePath);
  const data = await runHelper("read", abs);
  const name = safePath.split("/").pop() ?? safePath;
  const parent = safePath.includes("/")
    ? safePath.replace(/\/[^/]+$/, "")
    : "";
  const encoding = data.encoding === "base64" ? "base64" : "text";
  return {
    content: String(data.content ?? ""),
    mime: mimeForFile(name),
    language: languageForFile(name),
    readOnly: !isDirWritable(parent),
    encoding,
  };
}

export async function writeDomainFileLive(
  domain: HostedDomain | string,
  panelPath: string,
  content: string,
  actor: { role: Role; domains: string[] },
): Promise<void> {
  const safePath = assertSafePanelPath(panelPath);
  const ctx = await filesContext(domain, actor);
  const abs = absFileFromPanel(ctx, safePath);
  if (!isTextFileName(safePath.split("/").pop() ?? "")) {
    throw new PanelError("You cannot edit this file type as text.");
  }
  const parent = safePath.includes("/")
    ? safePath.replace(/\/[^/]+$/, "")
    : "";
  if (!isDirWritable(parent)) {
    throw new PanelError("This directory is read-only.");
  }
  await runHelper("write", abs, { content });
}

export async function mkdirDomainLive(
  domain: HostedDomain | string,
  parent: string,
  name: string,
  actor: { role: Role; domains: string[] },
): Promise<string> {
  const parentNorm = normalizeDir(parent);
  if (!isDirWritable(parentNorm)) {
    throw new PanelError("This directory is read-only.");
  }
  const ctx = await filesContext(domain, actor);
  const base = absDirFromPanel(ctx, parentNorm);
  const safe = name.replace(/[/\\]/g, "").trim();
  if (!safe || safe === "." || safe === "..") {
    throw new PanelError("Invalid directory name.");
  }
  const abs = `${base}/${safe}`;
  await runHelper("mkdir", abs);
  return parentNorm ? `${parentNorm}/${safe}` : safe;
}

export async function uploadDomainFileFromTempLive(
  domain: HostedDomain | string,
  panelPath: string,
  tempPath: string,
  maxBytes: number | null,
  actor: { role: Role; domains: string[] },
  options?: { overwrite?: boolean; fileBytes?: number },
): Promise<number> {
  const safePath = assertSafePanelPath(panelPath);
  const parent = safePath.includes("/")
    ? safePath.replace(/\/[^/]+$/, "")
    : "";
  if (!isDirWritable(parent)) {
    throw new PanelError("This directory is read-only.");
  }
  const ctx = await filesContext(domain, actor);
  const abs = absFileFromPanel(ctx, safePath);
  const { sizeBytes } = await runDomainFsInstallUpload(abs, tempPath, maxBytes, options);
  markLiveFilesystemReady();
  return sizeBytes;
}

export async function uploadDomainFileLive(
  domain: HostedDomain | string,
  panelPath: string,
  data: Uint8Array,
  actor: { role: Role; domains: string[] },
  maxBytes?: number,
): Promise<void> {
  const cap = maxBytes ?? 10 * 1024 * 1024;
  if (data.byteLength > cap) {
    throw new PanelError(`File exceeds upload limit (${cap} bytes).`);
  }
  const safePath = assertSafePanelPath(panelPath);
  const parent = safePath.includes("/")
    ? safePath.replace(/\/[^/]+$/, "")
    : "";
  if (!isDirWritable(parent)) {
    throw new PanelError("This directory is read-only.");
  }
  const ctx = await filesContext(domain, actor);
  const abs = absFileFromPanel(ctx, safePath);
  const base64 = Buffer.from(data).toString("base64");
  await runHelper("write-bytes", abs, { base64, maxBytes: cap });
}

export async function moveDomainPathLive(
  domain: HostedDomain | string,
  sourcePath: string,
  destDir: string,
  newName: string | undefined,
  actor: { role: Role; domains: string[] },
  options?: { overwrite?: boolean },
): Promise<string> {
  const srcNorm = assertSafePanelPath(sourcePath);
  const destPanelPath = assertSafePanelPath(
    resolveMoveDestination(srcNorm, assertSafePanelPath(destDir), newName),
  );
  const srcParent = srcNorm.includes("/") ? srcNorm.replace(/\/[^/]+$/, "") : "";
  const destParent = normalizeDir(destDir);

  if (!isDirWritable(srcParent)) {
    throw new PanelError("This directory is read-only.");
  }
  if (!isDirWritable(destParent)) {
    throw new PanelError("Destination folder is read-only.");
  }
  if (destPanelPath.startsWith(`${srcNorm}/`)) {
    throw new PanelError("Cannot move a folder into itself or a subfolder.");
  }

  const ctx = await filesContext(domain, actor);
  const absSrc = absFileFromPanel(ctx, srcNorm);
  const absDest = absFileFromPanel(ctx, destPanelPath);
  await runHelper("move", absSrc, {
    destAbs: absDest,
    overwrite: options?.overwrite === true,
  });
  return destPanelPath;
}

export async function deleteDomainFileLive(
  domain: HostedDomain | string,
  panelPath: string,
  actor: { role: Role; domains: string[] },
): Promise<void> {
  const safePath = assertSafePanelPath(panelPath);
  const parent = safePath.includes("/")
    ? safePath.replace(/\/[^/]+$/, "")
    : "";
  if (!isDirWritable(parent)) {
    throw new PanelError("This path is read-only.");
  }
  const ctx = await filesContext(domain, actor);
  const abs = absFileFromPanel(ctx, safePath);
  await runHelper("unlink", abs);
}

export async function extractArchiveLive(
  domain: HostedDomain | string,
  archivePath: string,
  destDir: string,
  actor: { role: Role; domains: string[] },
): Promise<{ destDir: string; format: string }> {
  const safeArchive = assertSafePanelPath(archivePath);
  const parent = safeArchive.includes("/")
    ? safeArchive.replace(/\/[^/]+$/, "")
    : "";
  if (!isDirWritable(parent)) {
    throw new PanelError("This directory is read-only.");
  }
  const ctx = await filesContext(domain, actor);
  const absArchive = absFileFromPanel(ctx, safeArchive);
  const destNorm = normalizeDir(assertSafePanelPath(destDir));
  const payload: Record<string, unknown> = {};
  if (destNorm) {
    payload.destAbs = absDirFromPanel(ctx, destNorm);
  } else {
    const base = safeArchive.split("/").pop() ?? "archive";
    payload.destName = base.replace(/\.(tar\.gz|tgz|zip|tar)$/i, "");
  }
  const data = await runHelper("archive-extract", absArchive, payload, {
    timeoutMs: 120_000,
  });
  const destName = String(data.destName ?? payload.destName ?? "extracted");
  const panelDest = parent ? `${parent}/${destName}` : destName;
  return {
    destDir: destNorm || panelDest,
    format: String(data.format ?? ""),
  };
}

export async function createArchiveLive(
  domain: HostedDomain | string,
  parent: string,
  opts: {
    format: "zip" | "tar.gz";
    name: string;
    items?: string[];
  },
  actor: { role: Role; domains: string[] },
): Promise<{ path: string; sizeBytes: number; format: string }> {
  const parentNorm = normalizeDir(parent);
  if (!isDirWritable(parentNorm)) {
    throw new PanelError("This directory is read-only.");
  }
  const ctx = await filesContext(domain, actor);
  const absParent = absDirFromPanel(ctx, parentNorm);
  const data = await runHelper(
    "archive-create",
    absParent,
    {
      format: opts.format,
      name: opts.name,
      items: opts.items ?? [],
    },
    { timeoutMs: 120_000 },
  );
  const fileName = String(data.name ?? opts.name);
  const panelPath = parentNorm ? `${parentNorm}/${fileName}` : fileName;
  return {
    path: panelPath,
    sizeBytes: Number(data.sizeBytes ?? 0),
    format: String(data.format ?? opts.format),
  };
}
