import type { HostedDomain } from "./types";
import { PanelError } from "./errors";
import {
  detectArchiveFormat,
  isArchiveFileName,
} from "./domain-files-archives";

export interface DomainFileEntry {
  name: string;
  path: string;
  type: "file" | "dir";
  size?: string;
  sizeBytes?: number;
  modified?: string;
  editable?: boolean;
  downloadable?: boolean;
  /** False only for read-only dirs (logs, Maildir). */
  deletable?: boolean;
  /** Move/rename within the account home. */
  movable?: boolean;
  /** ZIP / TAR archive — extract via panel. */
  archive?: boolean;
  archiveFormat?: ReturnType<typeof detectArchiveFormat>;
}

export interface DomainFilesListing {
  mode: "qadbak" | "legacy";
  home: string;
  cwd: string;
  breadcrumbs: { label: string; path: string }[];
  entries?: DomainFileEntry[];
  fileManagerUrl?: string;
  writable?: boolean;
  /** Relative document root inside `home` (usually public_html). */
  docRoot?: string;
  /** True when Files is scoped to this domain, not the whole unix home. */
  jailed?: boolean;
  quickPaths?: { id: string; label: string; description: string }[];
}

export interface DomainFileContent {
  content: string;
  mime: string;
  language: string;
  readOnly: boolean;
  encoding: "text" | "base64";
}

const READ_ONLY_DIR_PREFIXES = ["logs", "Maildir"];

const TEXT_EXTENSIONS = new Set([
  "html",
  "htm",
  "css",
  "js",
  "mjs",
  "json",
  "txt",
  "md",
  "xml",
  "svg",
  "php",
  "cgi",
  "sh",
  "py",
  "yml",
  "yaml",
  "env",
  "htaccess",
  "conf",
  "ini",
  "log",
]);

const LANG_BY_EXT: Record<string, string> = {
  html: "html",
  htm: "html",
  css: "css",
  js: "javascript",
  mjs: "javascript",
  json: "json",
  md: "markdown",
  xml: "xml",
  svg: "xml",
  php: "php",
  cgi: "shell",
  sh: "shell",
  py: "python",
  yml: "yaml",
  yaml: "yaml",
  txt: "plaintext",
  log: "plaintext",
};

const MOCK_TREE: Record<string, DomainFileEntry[]> = Object.create(null) as Record<
  string,
  DomainFileEntry[]
>;
Object.assign(MOCK_TREE, {
  "": [
    { name: "public_html", path: "public_html", type: "dir" },
    { name: "cgi-bin", path: "cgi-bin", type: "dir" },
    { name: "logs", path: "logs", type: "dir", editable: false },
    { name: "Maildir", path: "Maildir", type: "dir", editable: false },
  ],
  public_html: [
    {
      name: "index.html",
      path: "public_html/index.html",
      type: "file",
      sizeBytes: 2100,
      modified: "2026-05-18",
      editable: true,
      downloadable: true,
    },
    {
      name: "robots.txt",
      path: "public_html/robots.txt",
      type: "file",
      sizeBytes: 120,
      modified: "2026-01-10",
      editable: true,
      downloadable: true,
    },
    {
      name: ".htaccess",
      path: "public_html/.htaccess",
      type: "file",
      sizeBytes: 340,
      modified: "2026-03-02",
      editable: true,
      downloadable: true,
    },
    { name: "css", path: "public_html/css", type: "dir" },
    { name: "images", path: "public_html/images", type: "dir" },
  ],
  "public_html/css": [
    {
      name: "style.css",
      path: "public_html/css/style.css",
      type: "file",
      sizeBytes: 4500,
      modified: "2026-05-10",
      editable: true,
      downloadable: true,
    },
  ],
  "public_html/images": [
    {
      name: "logo.svg",
      path: "public_html/images/logo.svg",
      type: "file",
      sizeBytes: 8000,
      modified: "2026-04-01",
      editable: true,
      downloadable: true,
    },
  ],
  "cgi-bin": [
    {
      name: "hello.cgi",
      path: "cgi-bin/hello.cgi",
      type: "file",
      sizeBytes: 512,
      modified: "2025-11-20",
      editable: true,
      downloadable: true,
    },
  ],
  logs: [
    {
      name: "access_log",
      path: "logs/access_log",
      type: "file",
      sizeBytes: 128000,
      modified: "2026-05-20",
      editable: false,
      downloadable: true,
    },
    {
      name: "error_log",
      path: "logs/error_log",
      type: "file",
      sizeBytes: 12000,
      modified: "2026-05-20",
      editable: false,
      downloadable: true,
    },
  ],
});

const MOCK_TEXT: Record<string, string> = {
  "public_html/index.html": `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>Welcome</title>
  <link rel="stylesheet" href="/css/style.css">
</head>
<body>
  <h1>Website</h1>
  <p>Manage this file in Qadbak.</p>
</body>
</html>`,
  "public_html/robots.txt": "User-agent: *\nDisallow:\n",
  "public_html/.htaccess": "RewriteEngine On\n",
  "public_html/css/style.css": "body {\n  font-family: system-ui, sans-serif;\n  margin: 2rem;\n  color: #e2e8f0;\n  background: #0f172a;\n}\n",
  "public_html/images/logo.svg":
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 40"><text y="28" font-size="18">Logo</text></svg>\n',
  "cgi-bin/hello.cgi":
    "#!/bin/sh\necho \"Content-Type: text/plain\"\necho\necho Hello\n",
  "logs/access_log":
    `[${new Date().toISOString()}] GET / HTTP/1.1 200\n192.0.2.1 - - "GET /index.html" 200\n`,
  "logs/error_log": `[${new Date().toISOString()}] [error] mock error log\n`,
};

/** base64 payload for binary mock files */
const MOCK_BINARY: Record<string, { mime: string; base64: string }> = {};

export function domainUnixUser(domain: HostedDomain | string): string {
  if (typeof domain === "string") {
    return domain.split(".")[0];
  }
  return domain.user ?? domain.name.split(".")[0];
}

export function domainHomePath(domain: HostedDomain | string): string {
  return `/home/${domainUnixUser(domain)}`;
}

export function normalizeDir(dir: string): string {
  return dir.split("/").filter((part) => part.length > 0 && part !== ".").join("/");
}

function assertSafeTreeKey(key: string): string {
  if (key === "__proto__" || key === "constructor" || key === "prototype") {
    throw new PanelError("Invalid path.");
  }
  return key;
}

function mockTreeEntries(key: string): DomainFileEntry[] {
  const safe = assertSafeTreeKey(key);
  if (!Object.prototype.hasOwnProperty.call(MOCK_TREE, safe)) {
    MOCK_TREE[safe] = [];
  }
  return MOCK_TREE[safe]!;
}

/** Reject path traversal in panel-relative paths (live file manager). */
export function assertSafePanelPath(panelPath: string): string {
  const rel = panelPath.replace(/^\/+/, "");
  const parts = rel.split("/").filter((p) => p.length > 0);
  if (parts.some((p) => p === "..")) {
    throw new PanelError("Invalid path.");
  }
  return parts.join("/");
}

function safeFileName(name: string): string {
  const base = name.replace(/[/\\]/g, "").trim();
  if (!base || base === "." || base === "..") {
    throw new PanelError("Invalid file name.");
  }
  return base;
}

function fileExtension(name: string): string {
  if (name.startsWith(".")) {
    const parts = name.slice(1).split(".");
    return parts.length > 1 ? parts.pop()!.toLowerCase() : name.slice(1).toLowerCase();
  }
  const idx = name.lastIndexOf(".");
  return idx >= 0 ? name.slice(idx + 1).toLowerCase() : "";
}

export function isTextFileName(name: string): boolean {
  const ext = fileExtension(name);
  if (!ext) return false;
  if (name === ".htaccess" || name.startsWith(".env")) return true;
  return TEXT_EXTENSIONS.has(ext);
}

export function languageForFile(name: string): string {
  if (name === ".htaccess") return "plaintext";
  const ext = fileExtension(name);
  return LANG_BY_EXT[ext] ?? "plaintext";
}

export function mimeForFile(name: string): string {
  const ext = fileExtension(name);
  const map: Record<string, string> = {
    html: "text/html",
    htm: "text/html",
    css: "text/css",
    js: "text/javascript",
    json: "application/json",
    svg: "image/svg+xml",
    png: "image/png",
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
    gif: "image/gif",
    webp: "image/webp",
    pdf: "application/pdf",
    zip: "application/zip",
    txt: "text/plain",
    php: "application/x-php",
    mp4: "video/mp4",
    webm: "video/webm",
    ogv: "video/ogg",
    m4v: "video/mp4",
    mov: "video/quicktime",
  };
  return map[ext] ?? "application/octet-stream";
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

export function breadcrumbsFor(
  cwd: string,
  homeLabel = "Home",
): DomainFilesListing["breadcrumbs"] {
  const crumbs: DomainFilesListing["breadcrumbs"] = [{ label: homeLabel, path: "" }];
  if (!cwd) return crumbs;
  const parts = cwd.split("/");
  let acc = "";
  for (const part of parts) {
    acc = acc ? `${acc}/${part}` : part;
    crumbs.push({ label: part, path: acc });
  }
  return crumbs;
}

export function isDirWritable(cwd: string): boolean {
  const norm = normalizeDir(cwd);
  return !READ_ONLY_DIR_PREFIXES.some(
    (p) => norm === p || norm.startsWith(`${p}/`),
  );
}

function assertWritableDir(cwd: string): void {
  if (!isDirWritable(cwd)) {
    throw new PanelError("This directory is read-only.");
  }
}

export function enrichEntry(entry: DomainFileEntry): DomainFileEntry {
  const size =
    entry.size ??
    (entry.sizeBytes !== undefined ? formatBytes(entry.sizeBytes) : undefined);
  const archive =
    entry.archive ?? (entry.type === "file" && isArchiveFileName(entry.name));
  const parentDir = entry.path.replace(/\/[^/]+$/, "");
  return {
    ...entry,
    size,
    archive,
    archiveFormat:
      entry.archiveFormat ??
      (archive ? detectArchiveFormat(entry.name) : undefined),
    downloadable: entry.downloadable ?? entry.type === "file",
    editable:
      entry.editable ??
      (entry.type === "file" &&
        !archive &&
        isTextFileName(entry.name) &&
        isDirWritable(parentDir)),
    deletable:
      entry.deletable ??
      (entry.type === "file" && isDirWritable(parentDir)),
    movable: entry.movable ?? isDirWritable(parentDir),
  };
}

function touchEntry(path: string, sizeBytes: number, text = true): void {
  const parent = path.includes("/") ? path.replace(/\/[^/]+$/, "") : "";
  const name = path.split("/").pop() ?? path;
  const bucket = mockTreeEntries(parent);
  const idx = bucket.findIndex((e) => e.path === path);
  const entry: DomainFileEntry = enrichEntry({
    name,
    path,
    type: "file",
    sizeBytes,
    modified: today(),
    editable: text && isTextFileName(name),
    downloadable: true,
  });
  if (idx >= 0) bucket[idx] = entry;
  else bucket.push(entry);
}

export function isPanelFilesMode(): boolean {
  return process.env.QADBAK_LEGACY_API_MOCK === "true";
}

export function listDomainFiles(
  domain: HostedDomain | string,
  dir: string,
): DomainFilesListing {
  const home = domainHomePath(domain);
  const cwd = normalizeDir(dir);
  const base = {
    home,
    cwd,
    breadcrumbs: breadcrumbsFor(cwd),
    writable: isDirWritable(cwd),
  };

  if (!isPanelFilesMode()) {
    return { ...base, mode: "legacy" };
  }

  const entries = (MOCK_TREE[cwd] ?? []).map((e) => enrichEntry({ ...e }));
  return { ...base, mode: "qadbak", entries };
}

export function getDomainFile(path: string): DomainFileContent {
  if (!isPanelFilesMode()) {
    throw new PanelError(
      "File content is only available in Qadbak with QADBAK_LEGACY_API_MOCK=true.",
    );
  }
  const name = path.split("/").pop() ?? path;
  const binary = MOCK_BINARY[path];
  if (binary) {
    return {
      content: binary.base64,
      mime: binary.mime,
      language: "plaintext",
      readOnly: !isDirWritable(path.replace(/\/[^/]+$/, "")),
      encoding: "base64",
    };
  }
  const text = MOCK_TEXT[path];
  if (text === undefined) {
    throw new PanelError("File not found.");
  }
  const parent = path.includes("/") ? path.replace(/\/[^/]+$/, "") : "";
  const entry = MOCK_TREE[parent]?.find((e) => e.path === path);
  const readOnly = entry?.editable === false;
  return {
    content: text,
    mime: mimeForFile(name),
    language: languageForFile(name),
    readOnly,
    encoding: "text",
  };
}

export function saveDomainFileContent(path: string, content: string): void {
  if (!isPanelFilesMode()) {
    throw new PanelError(
      "Saving in Qadbak is not available on the live server.",
    );
  }
  const parent = path.includes("/") ? path.replace(/\/[^/]+$/, "") : "";
  assertWritableDir(parent);
  const name = path.split("/").pop() ?? path;
  if (!isTextFileName(name)) {
    throw new PanelError("You cannot edit this file type as text.");
  }
  MOCK_TEXT[path] = content;
  delete MOCK_BINARY[path];
  touchEntry(path, new TextEncoder().encode(content).length);
}

export type DomainFileWriteOptions = {
  /** When true (default for upload), replace an existing file at the same path. */
  overwrite?: boolean;
};

function mockFileExists(path: string): boolean {
  return MOCK_TEXT[path] !== undefined || MOCK_BINARY[path] !== undefined;
}

function clearMockFile(path: string): void {
  delete MOCK_TEXT[path];
  delete MOCK_BINARY[path];
}

export function createDomainFile(
  parent: string,
  name: string,
  content = "",
  options?: DomainFileWriteOptions,
): string {
  if (!isPanelFilesMode()) {
    throw new PanelError("Creating files is not available on the live server.");
  }
  const parentNorm = normalizeDir(parent);
  assertWritableDir(parentNorm);
  const safe = safeFileName(name);
  if (!isTextFileName(safe)) {
    throw new PanelError("You can only create text files here. Upload other types.");
  }
  const path = parentNorm ? `${parentNorm}/${safe}` : safe;
  const overwrite = options?.overwrite !== false;
  if (mockFileExists(path) && !overwrite) {
    throw new PanelError("File already exists.");
  }
  if (mockFileExists(path)) clearMockFile(path);
  MOCK_TEXT[path] = content;
  touchEntry(path, new TextEncoder().encode(content).length);
  return path;
}

export function uploadDomainFile(
  parent: string,
  name: string,
  data: Uint8Array,
  options?: DomainFileWriteOptions,
): string {
  if (!isPanelFilesMode()) {
    throw new PanelError("Upload is not available on the live server.");
  }
  const parentNorm = normalizeDir(parent);
  assertWritableDir(parentNorm);
  const safe = safeFileName(name);
  const path = parentNorm ? `${parentNorm}/${safe}` : safe;
  const overwrite = options?.overwrite !== false;
  if (mockFileExists(path) && !overwrite) {
    throw new PanelError(`File ${safe} already exists. Enable overwrite or rename.`);
  }
  if (mockFileExists(path)) clearMockFile(path);

  const textLike = isTextFileName(safe);
  if (textLike) {
    const decoder = new TextDecoder("utf-8", { fatal: false });
    MOCK_TEXT[path] = decoder.decode(data);
    touchEntry(path, data.length);
    return path;
  }

  MOCK_BINARY[path] = {
    mime: mimeForFile(safe),
    base64: Buffer.from(data).toString("base64"),
  };
  touchEntry(path, data.length, false);
  return path;
}

export function getDomainFileDownload(
  path: string,
): { body: Uint8Array; mime: string; filename: string } {
  if (!isPanelFilesMode()) {
    throw new PanelError("Download is not available on the live server.");
  }
  const name = path.split("/").pop() ?? "download";
  const binary = MOCK_BINARY[path];
  if (binary) {
    return {
      body: new Uint8Array(Buffer.from(binary.base64, "base64")),
      mime: binary.mime,
      filename: name,
    };
  }
  const text = MOCK_TEXT[path];
  if (text === undefined) {
    throw new PanelError("File not found.");
  }
  return {
    body: new TextEncoder().encode(text),
    mime: mimeForFile(name),
    filename: name,
  };
}

function assertMoveAllowed(sourcePath: string, destPath: string): void {
  if (sourcePath === destPath) {
    throw new PanelError("Source and destination are the same.");
  }
  if (destPath.startsWith(`${sourcePath}/`)) {
    throw new PanelError("Cannot move a folder into itself or a subfolder.");
  }
}

function rekeyMockPathPrefix(oldPrefix: string, newPrefix: string): void {
  const remap = (p: string) =>
    p === oldPrefix ? newPrefix : p.startsWith(`${oldPrefix}/`) ? newPrefix + p.slice(oldPrefix.length) : p;

  for (const key of [...Object.keys(MOCK_TREE)]) {
    if (key !== oldPrefix && !key.startsWith(`${oldPrefix}/`)) continue;
    const newKey = remap(key);
    MOCK_TREE[newKey] = (MOCK_TREE[key] ?? []).map((e) =>
      enrichEntry({ ...e, path: remap(e.path) }),
    );
    if (newKey !== key) delete MOCK_TREE[key];
  }

  for (const key of Object.keys(MOCK_TEXT)) {
    if (key === oldPrefix || key.startsWith(`${oldPrefix}/`)) {
      const nk = remap(key);
      MOCK_TEXT[nk] = MOCK_TEXT[key];
      delete MOCK_TEXT[key];
    }
  }
  for (const key of Object.keys(MOCK_BINARY)) {
    if (key === oldPrefix || key.startsWith(`${oldPrefix}/`)) {
      const nk = remap(key);
      MOCK_BINARY[nk] = MOCK_BINARY[key];
      delete MOCK_BINARY[key];
    }
  }
}

export function resolveMoveDestination(
  sourcePath: string,
  destDir: string,
  newName?: string,
): string {
  const safeName = (newName ?? sourcePath.split("/").pop() ?? "")
    .replace(/[/\\]/g, "")
    .trim();
  if (!safeName || safeName === "." || safeName === "..") {
    throw new PanelError("Invalid name.");
  }
  const destNorm = normalizeDir(destDir);
  return destNorm ? `${destNorm}/${safeName}` : safeName;
}

export function moveDomainPath(
  sourcePath: string,
  destDir: string,
  newName?: string,
  options?: DomainFileWriteOptions,
): string {
  if (!isPanelFilesMode()) {
    throw new PanelError("Move is not available on the live server.");
  }
  const srcNorm = sourcePath.replace(/^\/+/, "");
  const destPath = resolveMoveDestination(srcNorm, destDir, newName);
  const srcParent = srcNorm.includes("/") ? srcNorm.replace(/\/[^/]+$/, "") : "";
  const destParent = normalizeDir(destDir);
  assertWritableDir(srcParent);
  assertWritableDir(destParent);
  assertMoveAllowed(srcNorm, destPath);

  const list = MOCK_TREE[srcParent];
  const idx = list?.findIndex((e) => e.path === srcNorm) ?? -1;
  if (!list || idx < 0) throw new PanelError("File or folder not found.");
  const entry = list[idx]!;
  if (entry.editable === false) {
    throw new PanelError("This item is read-only and cannot be moved.");
  }
  const finalName = destPath.split("/").pop() ?? entry.name;
  const overwrite = options?.overwrite === true;
  const destBucket = mockTreeEntries(destParent);
  const existing = destBucket.find((e) => e.name === finalName);
  if (existing) {
    if (!overwrite) {
      throw new PanelError(
        "An item with that name already exists in the destination folder. Enable replace or choose another name.",
      );
    }
    if (existing.type !== entry.type) {
      throw new PanelError("Cannot replace a file with a folder (or the reverse).");
    }
    if (existing.editable === false) {
      throw new PanelError("The existing destination item is read-only and cannot be replaced.");
    }
    deleteDomainFilePath(existing.path);
  }

  list.splice(idx, 1);
  const moved: DomainFileEntry = enrichEntry({
    ...entry,
    name: finalName,
    path: destPath,
  });
  destBucket.push(moved);

  if (entry.type === "dir") {
    rekeyMockPathPrefix(srcNorm, destPath);
  } else if (MOCK_TEXT[srcNorm] !== undefined) {
    MOCK_TEXT[destPath] = MOCK_TEXT[srcNorm];
    delete MOCK_TEXT[srcNorm];
  } else if (MOCK_BINARY[srcNorm]) {
    MOCK_BINARY[destPath] = MOCK_BINARY[srcNorm];
    delete MOCK_BINARY[srcNorm];
  }

  return destPath;
}

export function deleteDomainFilePath(path: string): void {
  if (!isPanelFilesMode()) {
    throw new PanelError("Deleting in Qadbak is not available on the live server.");
  }
  const parent = path.includes("/") ? path.replace(/\/[^/]+$/, "") : "";
  const entry = MOCK_TREE[parent]?.find((e) => e.path === path);
  if (entry?.editable === false) {
    throw new PanelError("This file is read-only and cannot be deleted.");
  }
  assertWritableDir(parent);
  delete MOCK_TEXT[path];
  delete MOCK_BINARY[path];
  for (const key of Object.keys(MOCK_TREE)) {
    MOCK_TREE[key] = MOCK_TREE[key].filter(
      (e) => e.path !== path && !e.path.startsWith(`${path}/`),
    );
  }
}

export function createDomainDirectory(parent: string, name: string): string {
  if (!isPanelFilesMode()) {
    throw new PanelError("Creating directories in Qadbak is not available on the live server.");
  }
  const parentNorm = normalizeDir(parent);
  assertWritableDir(parentNorm);
  const safe = safeFileName(name);
  const path = parentNorm ? `${parentNorm}/${safe}` : safe;
  const parentBucket = mockTreeEntries(parentNorm);
  if (parentBucket.some((e) => e.name === safe)) {
    throw new PanelError("Directory already exists.");
  }
  parentBucket.push({ name: safe, path, type: "dir" });
  mockTreeEntries(path);
  return path;
}

export const DOMAIN_FILE_QUICK_PATHS = [
  { id: "public_html", label: "public_html", description: "Website (document root)" },
  { id: "cgi-bin", label: "cgi-bin", description: "CGI-scripts" },
  { id: "logs", label: "logs", description: "Log files (read-only)" },
] as const;
