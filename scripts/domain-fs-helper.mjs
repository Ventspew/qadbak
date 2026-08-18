#!/usr/bin/env node
/**
 * Root-only filesystem helper for Qadbak live file manager.
 * Invoked as: sudo node domain-fs-helper.mjs <cmd> <absolute-path> [payload-json]
 * Paths must stay under /home/.
 */
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { safeExtractArchive } from "./lib/safe-archive-extract.mjs";

const execFileAsync = promisify(execFile);

const MAX_READ_BYTES = 5 * 1024 * 1024;
const MAX_WRITE_BYTES = 10 * 1024 * 1024;
const MAX_PANEL_UPLOAD_BYTES = 100 * 1024 ** 3;
const MAX_ARCHIVE_BYTES = 250 * 1024 * 1024;

/** Keep in sync with TEXT_EXTENSIONS in src/lib/domain-files.ts */
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

function fileExtension(name) {
  if (name === ".htaccess" || name.startsWith(".env")) return "htaccess";
  if (name.startsWith(".")) {
    const parts = name.slice(1).split(".");
    return parts.length > 1 ? parts.pop().toLowerCase() : name.slice(1).toLowerCase();
  }
  const idx = name.lastIndexOf(".");
  return idx >= 0 ? name.slice(idx + 1).toLowerCase() : "";
}

function isTextByPath(filePath) {
  const base = path.basename(filePath);
  if (base === ".htaccess" || base.startsWith(".env")) return true;
  const ext = fileExtension(base);
  return ext !== "" && TEXT_EXTENSIONS.has(ext);
}

function fail(message, code = 1) {
  emit({ ok: false, error: message });
  process.exit(code);
}

function emit(obj) {
  process.stdout.write(`${JSON.stringify(obj)}\n`);
}

async function assertHomePath(target) {
  if (!target || typeof target !== "string") fail("Path required.");
  const abs = path.resolve(target);
  if (abs !== "/home" && !abs.startsWith("/home/")) {
    fail("Path must be under /home/.");
  }

  const existing = await fs.realpath(abs).catch(() => null);
  if (existing) {
    if (existing !== "/home" && !existing.startsWith("/home/")) {
      fail("Path must be under /home/.");
    }
    return existing;
  }

  // Target may not exist yet (e.g. extract/mkdir destination).
  const parentResolved = await fs.realpath(path.dirname(abs)).catch(() => null);
  if (
    !parentResolved ||
    (parentResolved !== "/home" && !parentResolved.startsWith("/home/"))
  ) {
    fail("Path must be under /home/.");
  }
  const base = path.basename(abs);
  if (!base || base === "." || base === "..") fail("Invalid path.");
  return path.join(parentResolved, base);
}

function homeUnixUser(resolvedPath) {
  const m = String(resolvedPath).match(/^\/home\/([^/]+)\//);
  return m ? m[1] : null;
}

async function chownToHomeUser(targetPath) {
  const resolved = await fs.realpath(targetPath).catch(() => targetPath);
  const user = homeUnixUser(resolved);
  if (!user) return;
  try {
    await execFileAsync("chown", [`${user}:${user}`, resolved]);
  } catch {
    /* non-fatal */
  }
}

async function chownTree(targetPath) {
  const resolved = await fs.realpath(targetPath).catch(() => targetPath);
  const user = homeUnixUser(resolved);
  if (!user) return;
  try {
    await execFileAsync("chown", ["-R", `${user}:${user}`, resolved]);
  } catch {
    /* non-fatal */
  }
}

function archiveKind(filePath) {
  const n = path.basename(filePath).toLowerCase();
  if (n.endsWith(".zip")) return "zip";
  if (n.endsWith(".tar.gz") || n.endsWith(".tgz")) return "tar.gz";
  if (n.endsWith(".tar")) return "tar";
  return null;
}

function safeBaseName(name) {
  const safe = String(name ?? "")
    .replace(/[/\\]/g, "")
    .trim();
  if (!safe || safe === "." || safe === "..") fail("Invalid name.");
  return safe;
}

async function archiveExtract(absArchive, payload) {
  const resolved = await assertHomePath(absArchive);
  const st = await fs.stat(resolved);
  if (!st.isFile()) fail("Not a file.");
  if (st.size > MAX_ARCHIVE_BYTES) fail("Archive too large to extract in panel.");
  const kind = archiveKind(resolved);
  if (!kind) fail("Unsupported archive. Use .zip, .tar, .tar.gz or .tgz.");

  let dest = payload.destAbs
    ? await assertHomePath(payload.destAbs)
    : path.join(
        path.dirname(resolved),
        safeBaseName(
          payload.destName ??
            path.basename(resolved).replace(/\.(tar\.gz|tgz|zip|tar)$/i, ""),
        ),
      );

  await fs.mkdir(dest, { recursive: true });

  await safeExtractArchive(kind, resolved, dest);

  await chownTree(dest);
  emit({
    ok: true,
    destAbs: dest,
    destName: path.basename(dest),
    format: kind,
  });
}

async function archiveCreate(absParent, payload) {
  const parent = await assertHomePath(absParent);
  const st = await fs.stat(parent);
  if (!st.isDirectory()) fail("Parent is not a directory.");

  const format = payload.format === "zip" ? "zip" : "tar.gz";
  const outName = safeBaseName(payload.name);
  if (!/\.(zip|tar\.gz|tgz)$/i.test(outName)) {
    fail(format === "zip" ? "Output name must end with .zip" : "Output must end with .tar.gz");
  }
  const outAbs = path.join(parent, outName);
  await assertHomePath(outAbs);

  let items = Array.isArray(payload.items)
    ? payload.items.map((x) => safeBaseName(x))
    : [];
  if (items.length === 0) {
    const names = await fs.readdir(parent);
    items = names.filter((n) => n !== outName && !n.startsWith("."));
  }
  if (items.length === 0) fail("Nothing to compress.");

  if (format === "zip") {
    await execFileAsync("zip", ["-r", "-q", outAbs, ...items], { cwd: parent });
  } else {
    await execFileAsync("tar", ["-czf", outAbs, ...items], { cwd: parent });
  }

  await chownToHomeUser(outAbs);
  const outSt = await fs.stat(outAbs);
  emit({
    ok: true,
    name: outName,
    sizeBytes: outSt.size,
    format,
    itemCount: items.length,
  });
}

async function listDir(absPath) {
  const resolved = await assertHomePath(absPath);
  const names = await fs.readdir(resolved);
  const entries = [];
  for (const name of names) {
    if (name === "." || name === "..") continue;
    const full = path.join(resolved, name);
    let st;
    try {
      st = await fs.lstat(full);
    } catch {
      continue;
    }
    entries.push({
      name,
      type: st.isDirectory() ? "dir" : "file",
      sizeBytes: st.isFile() ? st.size : undefined,
      modified: st.mtime.toISOString().slice(0, 10),
    });
  }
  entries.sort((a, b) => {
    if (a.type !== b.type) return a.type === "dir" ? -1 : 1;
    return a.name.localeCompare(b.name);
  });
  emit({ ok: true, entries });
}

async function readFile(absPath) {
  const resolved = await assertHomePath(absPath);
  const st = await fs.stat(resolved);
  if (!st.isFile()) fail("Not a file.");
  if (st.size > MAX_READ_BYTES) fail("File too large to read in panel.");
  const buf = await fs.readFile(resolved);
  if (isTextByPath(resolved)) {
    emit({
      ok: true,
      sizeBytes: st.size,
      encoding: "text",
      content: buf.toString("latin1"),
    });
    return;
  }
  const hasNull = buf.includes(0);
  const isText = !hasNull;
  emit({
    ok: true,
    sizeBytes: st.size,
    encoding: isText ? "text" : "base64",
    content: isText ? buf.toString("utf8") : buf.toString("base64"),
  });
}

async function streamFile(absPath, payload) {
  const resolved = await assertHomePath(absPath);
  const st = await fs.stat(resolved);
  if (!st.isFile()) fail("Not a file.");
  const size = st.size;
  const start = Math.max(0, Number(payload.start ?? 0));
  let end = payload.end !== undefined ? Number(payload.end) : size - 1;
  if (!Number.isFinite(start) || start < 0 || start >= size) fail("Range not satisfiable.");
  if (!Number.isFinite(end) || end >= size) end = size - 1;
  if (end < start) fail("Range not satisfiable.");

  const fh = await fs.open(resolved, "r");
  try {
    const chunk = Buffer.alloc(256 * 1024);
    let pos = start;
    while (pos <= end) {
      const toRead = Math.min(chunk.length, end - pos + 1);
      const { bytesRead } = await fh.read(chunk, 0, toRead, pos);
      if (bytesRead <= 0) break;
      process.stdout.write(chunk.subarray(0, bytesRead));
      pos += bytesRead;
    }
  } finally {
    await fh.close();
  }
  process.exit(0);
}

async function writeFile(absPath, content) {
  const parent = path.dirname(absPath);
  await assertHomePath(parent);
  const encoding = isTextByPath(absPath) ? "latin1" : "utf8";
  const bytes = Buffer.from(content, encoding);
  if (bytes.length > MAX_WRITE_BYTES) fail("File too large.");
  await fs.writeFile(absPath, bytes, { flag: "w" });
  await chownToHomeUser(absPath);
  emit({ ok: true });
}

async function mkdirPath(absPath) {
  const abs = path.resolve(absPath);
  if (abs !== "/home" && !abs.startsWith("/home/")) {
    fail("Path must be under /home/.");
  }
  const user = homeUnixUser(`${abs}/`);
  if (!user) fail("Path must be under /home/<user>/.");
  await assertHomePath(`/home/${user}`);
  await fs.mkdir(abs, { recursive: true });
  await chownTree(abs);
  emit({ ok: true });
}

async function unlinkPath(absPath) {
  const resolved = await assertHomePath(absPath);
  const st = await fs.lstat(resolved);
  if (st.isDirectory()) {
    await fs.rm(resolved, { recursive: true, force: true });
  } else {
    await fs.unlink(resolved);
  }
}

async function removePath(absPath) {
  await unlinkPath(absPath);
  emit({ ok: true });
}

function isPathInside(parent, child) {
  return child === parent || child.startsWith(`${parent}${path.sep}`);
}

async function copyTree(srcAbs, destAbs) {
  destAbs = String(destAbs ?? "");
  if (!destAbs) fail("destAbs required.");
  const src = await assertHomePath(srcAbs);
  const destResolved = path.resolve(destAbs);
  if (destResolved !== "/home" && !destResolved.startsWith("/home/")) {
    fail("Path must be under /home/.");
  }
  const srcUser = homeUnixUser(`${src}/`);
  const destUser = homeUnixUser(`${destResolved}/`);
  if (!srcUser || srcUser !== destUser) fail("Copy must stay in the same home.");
  await fs.mkdir(destResolved, { recursive: true });
  const dest = await assertHomePath(destResolved);
  if (src === dest) {
    emit({ ok: true, copied: false });
    return;
  }
  if (isPathInside(src, dest)) fail("Cannot copy a folder into itself.");
  await execFileAsync("cp", ["-a", `${src}/.`, dest]);
  await chownTree(dest);
  emit({ ok: true, copied: true });
}

async function movePath(srcAbs, payload) {
  const destAbs = String(payload.destAbs ?? "");
  const overwrite = payload.overwrite === true;
  if (!destAbs) fail("destAbs required.");

  const src = await assertHomePath(srcAbs);
  const dest = await assertHomePath(destAbs);
  if (src === dest) fail("Source and destination are the same.");

  const srcSt = await fs.stat(src);
  if (srcSt.isDirectory() && isPathInside(src, dest)) {
    fail("Cannot move a folder into itself or a subfolder.");
  }

  let destSt = null;
  try {
    destSt = await fs.stat(dest);
  } catch (e) {
    if (e && typeof e === "object" && "code" in e && e.code !== "ENOENT") {
      throw e;
    }
  }
  if (destSt) {
    if (!overwrite) {
      fail("Destination already exists. Enable replace or choose another name.");
    }
    const srcIsDir = srcSt.isDirectory();
    const destIsDir = destSt.isDirectory();
    if (srcIsDir !== destIsDir) {
      fail("Cannot replace a file with a folder (or the reverse).");
    }
    await unlinkPath(dest);
  }

  const destParent = path.dirname(dest);
  await assertHomePath(destParent);
  try {
    await fs.access(destParent);
  } catch {
    fail("Destination folder does not exist.");
  }

  await fs.rename(src, dest);
  destSt = await fs.stat(dest);
  if (destSt.isDirectory()) {
    await chownTree(dest);
  } else {
    await chownToHomeUser(dest);
  }
  emit({ ok: true, destAbs: dest });
}

async function installUpload(absDest, payload) {
  const tempPath = String(payload.tempPath ?? "");
  const unlimited = payload.unlimited === true;
  const maxBytes = Number(payload.maxBytes ?? 0);
  const overwrite = payload.overwrite !== false;
  if (!tempPath) {
    fail("tempPath required.");
  }
  if (!unlimited) {
    if (!Number.isFinite(maxBytes) || maxBytes <= 0) {
      fail("maxBytes required.");
    }
    if (maxBytes > MAX_PANEL_UPLOAD_BYTES) {
      fail("Upload limit exceeds panel maximum.");
    }
  }

  const tmpRoot = await fs.realpath(os.tmpdir());
  const resolvedTemp = await fs.realpath(tempPath).catch(() => null);
  if (!resolvedTemp || !resolvedTemp.startsWith(`${tmpRoot}${path.sep}`)) {
    fail("Invalid temp path.");
  }
  const base = path.basename(resolvedTemp);
  if (!base.startsWith("qadbak-upload-")) {
    fail("Invalid temp file.");
  }

  const st = await fs.stat(resolvedTemp);
  if (!st.isFile()) fail("Not a file.");
  if (!unlimited && st.size > maxBytes) {
    fail(`File exceeds upload limit (${maxBytes} bytes).`);
  }

  const parent = path.dirname(absDest);
  await assertHomePath(parent);
  const dest = await assertHomePath(absDest);
  if (!overwrite) {
    try {
      await fs.stat(dest);
      fail("File already exists.");
    } catch (e) {
      if (e && typeof e === "object" && "code" in e && e.code !== "ENOENT") {
        throw e;
      }
    }
  }
  await fs.copyFile(resolvedTemp, dest);
  await chownToHomeUser(absDest);
  await fs.unlink(resolvedTemp).catch(() => {});
  emit({ ok: true, sizeBytes: st.size });
}

async function main() {
  const [cmd, target, payloadRaw] = process.argv.slice(2);
  if (!cmd || !target) fail("Usage: domain-fs-helper.mjs <cmd> <path> [json]");

  switch (cmd) {
    case "list":
      await listDir(target);
      break;
    case "read":
      await readFile(target);
      break;
    case "stream": {
      const payload = payloadRaw ? JSON.parse(payloadRaw) : {};
      await streamFile(target, payload);
      break;
    }
    case "write": {
      const payload = payloadRaw ? JSON.parse(payloadRaw) : {};
      if (payload.content === undefined) fail("content required");
      await writeFile(target, String(payload.content));
      break;
    }
    case "mkdir":
      await mkdirPath(target);
      break;
    case "copy-tree": {
      const payload = payloadRaw ? JSON.parse(payloadRaw) : {};
      await copyTree(target, payload.destAbs);
      break;
    }
    case "unlink":
      await removePath(target);
      break;
    case "move": {
      const payload = payloadRaw ? JSON.parse(payloadRaw) : {};
      await movePath(target, payload);
      break;
    }
    case "crontab-list": {
      const user = target;
      if (!/^[a-z0-9_-]+$/.test(user)) fail("Invalid unix user.");
      try {
        const { stdout } = await execFileAsync("crontab", ["-l", "-u", user], {
          encoding: "utf8",
          maxBuffer: 1024 * 1024,
        });
        const lines = stdout
          .split(/\r?\n/)
          .map((l) => l.trim())
          .filter((l) => l && !l.startsWith("#"));
        emit({ ok: true, lines });
      } catch (e) {
        if (String(e).includes("no crontab")) {
          emit({ ok: true, lines: [] });
        } else {
          fail(e instanceof Error ? e.message : String(e));
        }
      }
      break;
    }
    case "write-bytes": {
      const payload = payloadRaw ? JSON.parse(payloadRaw) : {};
      if (!payload.base64) fail("base64 required");
      const parent = path.dirname(target);
      await assertHomePath(parent);
      const buf = Buffer.from(String(payload.base64), "base64");
      const cap = Number(payload.maxBytes ?? MAX_WRITE_BYTES);
      if (!Number.isFinite(cap) || cap <= 0 || cap > MAX_PANEL_UPLOAD_BYTES) {
        fail("Invalid maxBytes.");
      }
      if (buf.length > cap) fail("File too large.");
      await fs.writeFile(target, buf);
      await chownToHomeUser(target);
      emit({ ok: true, sizeBytes: buf.length });
      break;
    }
    case "archive-extract": {
      const payload = payloadRaw ? JSON.parse(payloadRaw) : {};
      await archiveExtract(target, payload);
      break;
    }
    case "archive-create": {
      const payload = payloadRaw ? JSON.parse(payloadRaw) : {};
      await archiveCreate(target, payload);
      break;
    }
    case "install-upload": {
      const payload = payloadRaw ? JSON.parse(payloadRaw) : {};
      await installUpload(target, payload);
      break;
    }
    default:
      fail(`Unknown command: ${cmd}`);
  }
}

main().catch((e) => fail(e instanceof Error ? e.message : String(e)));
