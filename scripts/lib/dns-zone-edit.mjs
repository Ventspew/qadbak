/**
 * Pure BIND zone text edits (upsert/delete/SOA serial). Used by provision-dns.mjs.
 */

const SINGLE_VALUE_TYPES = new Set(["A", "AAAA", "CNAME"]);

export function canonDnsName(name, origin) {
  let n = String(name || "@")
    .trim()
    .replace(/\.$/, "")
    .toLowerCase();
  const o = String(origin || "")
    .trim()
    .replace(/\.$/, "")
    .toLowerCase();
  if (!n || n === "@" || (o && n === o)) return "@";
  if (o && n.endsWith(`.${o}`)) n = n.slice(0, -(o.length + 1));
  return n || "@";
}

export function nextSoaSerial(old) {
  const n = Number(old);
  const now = new Date();
  const ymd =
    now.getUTCFullYear() * 10000 +
    (now.getUTCMonth() + 1) * 100 +
    now.getUTCDate();
  const ymdnn = ymd * 100;
  if (Number.isFinite(n) && n >= 2020010100 && n <= 2099123199) {
    return Math.max(n + 1, ymdnn);
  }
  if (Number.isFinite(n) && n > 0) return n + 1;
  return ymdnn || 1;
}

/** Bump the first SOA serial in zone text. Leaves the rest of the file intact. */
export function bumpSoaSerial(text) {
  const src = String(text || "");
  const soaIdx = src.search(/\bSOA\b/i);
  if (soaIdx < 0) return src;
  const after = src.slice(soaIdx);
  const inline = after.match(/^(SOA\s+\S+\s+\S+\s+\(?\s*)(\d+)/i);
  if (inline) {
    const next = String(nextSoaSerial(inline[2]));
    return src.slice(0, soaIdx) + after.replace(inline[0], `${inline[1]}${next}`);
  }
  const multiline = after.match(/^(SOA[^\n]*\n[ \t]*)(\d+)/i);
  if (multiline) {
    const next = String(nextSoaSerial(multiline[2]));
    return src.slice(0, soaIdx) + after.replace(multiline[0], `${multiline[1]}${next}`);
  }
  return src;
}

export function parseZone(text, origin) {
  const records = [];
  for (const raw of normalizeZoneText(text).split("\n")) {
    const rec = parseNormalizedLine(raw, origin);
    if (rec) records.push(rec);
  }
  return records;
}

function normalizeZoneText(text) {
  const out = [];
  let soaLine = null;
  for (const raw of String(text || "").split("\n")) {
    const line = raw.split(";")[0].trim();
    if (!line) continue;
    if (soaLine !== null) {
      soaLine += ` ${line}`;
      if (line.includes(")")) {
        out.push(soaLine);
        soaLine = null;
      }
      continue;
    }
    if (/\bSOA\b/i.test(line) && line.includes("(") && !line.includes(")")) {
      soaLine = line;
      continue;
    }
    out.push(line);
  }
  if (soaLine) out.push(soaLine);
  return out.join("\n");
}

function parseNormalizedLine(line, origin) {
  const trimmed = String(line || "").trim();
  if (!trimmed || trimmed.startsWith("$")) return null;
  const parts = trimmed.split(/\s+/).filter(Boolean);
  if (parts.length < 3) return null;
  let i = 0;
  let name = "@";
  if (parts[0] === "@") {
    i = 1;
  } else if (!/^\d+$/.test(parts[0]) && !/^IN$/i.test(parts[0])) {
    name = canonDnsName(parts[0], origin);
    i = 1;
  }
  if (/^\d+$/.test(parts[i])) i++;
  if (/^IN$/i.test(parts[i])) i++;
  const type = parts[i++]?.toUpperCase();
  if (!type) return null;
  let value = parts.slice(i).join(" ").replace(/\.$/, "");
  if (type === "SOA") {
    value = value
      .replace(/^\(+/, "")
      .replace(/\)+$/, "")
      .replace(/\s+/g, " ")
      .trim();
  }
  let priority;
  if (type === "MX" || type === "SRV") {
    const m = value.match(/^(\d+)\s+(.+)$/);
    if (m) {
      priority = m[1];
      value = m[2];
    }
  }
  return { name, type, value, ttl: undefined, priority };
}

export function parseOneLine(raw, origin) {
  const stripped = String(raw || "").trim();
  if (!stripped || stripped.startsWith(";") || stripped.startsWith("$")) return null;
  const noComment = stripped.includes('"') ? stripped : stripped.split(";")[0].trim();
  return parseNormalizedLine(noComment, origin);
}

export function formatRecordLine(_origin, rec) {
  const name = rec.name === "@" ? "@" : rec.name;
  const ttl = rec.ttl ? `${rec.ttl} ` : "";
  const pri =
    rec.priority && (rec.type === "MX" || rec.type === "SRV") ? `${rec.priority} ` : "";
  return `${name} ${ttl}IN ${rec.type} ${pri}${rec.value}\n`;
}

function valuesEqual(type, a, b) {
  const left = String(a || "").trim().replace(/\.$/, "");
  const right = String(b || "").trim().replace(/\.$/, "");
  if (type === "TXT") return left === right;
  return left.toLowerCase() === right.toLowerCase();
}

function sameNameType(parsed, rec, origin) {
  return (
    parsed.type === String(rec.type || "").toUpperCase() &&
    canonDnsName(parsed.name, origin) === canonDnsName(rec.name, origin)
  );
}

/** Replace A/AAAA/CNAME for the same name; other types upsert on name+type+value. */
export function upsertZoneText(text, rec, origin) {
  const type = String(rec.type || "").toUpperCase();
  const lines = String(text || "").split("\n");
  const keep = [];
  let replaced = false;
  for (const line of lines) {
    const parsed = parseOneLine(line, origin);
    if (!parsed || parsed.type === "SOA") {
      keep.push(line);
      continue;
    }
    if (!sameNameType(parsed, rec, origin)) {
      keep.push(line);
      continue;
    }
    if (SINGLE_VALUE_TYPES.has(type)) {
      if (!replaced) {
        keep.push(formatRecordLine(origin, rec).trimEnd());
        replaced = true;
      }
      continue;
    }
    if (
      valuesEqual(type, parsed.value, rec.value) &&
      String(parsed.priority || "") === String(rec.priority || "")
    ) {
      if (!replaced) {
        keep.push(formatRecordLine(origin, rec).trimEnd());
        replaced = true;
      }
      continue;
    }
    keep.push(line);
  }
  if (!replaced) keep.push(formatRecordLine(origin, rec).trimEnd());
  let out = keep.join("\n");
  if (!out.endsWith("\n")) out += "\n";
  return bumpSoaSerial(out);
}

/** Remove the first exact name+type+value match. */
export function deleteZoneText(text, rec, origin) {
  const type = String(rec.type || "").toUpperCase();
  const lines = String(text || "").split("\n");
  const keep = [];
  let removed = false;
  for (const line of lines) {
    const parsed = parseOneLine(line, origin);
    if (
      !removed &&
      parsed &&
      sameNameType(parsed, rec, origin) &&
      valuesEqual(type, parsed.value, rec.value) &&
      String(parsed.priority || "") === String(rec.priority || "")
    ) {
      removed = true;
      continue;
    }
    keep.push(line);
  }
  let out = keep.join("\n");
  if (!out.endsWith("\n")) out += "\n";
  return removed ? bumpSoaSerial(out) : bumpSoaSerial(String(text || ""));
}

/** Relative labels of `blog.example.com` inside the `example.com` zone → `blog`. */
export function subLabelForParent(domain, parent) {
  const d = String(domain || "")
    .trim()
    .replace(/\.$/, "")
    .toLowerCase();
  const p = String(parent || "")
    .trim()
    .replace(/\.$/, "")
    .toLowerCase();
  if (!d || !p || d === p) return "";
  if (d.endsWith(`.${p}`)) return d.slice(0, -(p.length + 1));
  return "";
}

/** Map a UI name (`@` / `www`) onto the parent-zone label (`blog` / `www.blog`). */
export function mapNameToParentZone(name, label) {
  const n = String(name || "@")
    .trim()
    .replace(/\.$/, "")
    .toLowerCase();
  const lab = String(label || "")
    .trim()
    .toLowerCase();
  if (!lab) return n || "@";
  if (!n || n === "@") return lab;
  if (n === lab || n.endsWith(`.${lab}`)) return n;
  return `${n}.${lab}`;
}

/** Inverse of mapNameToParentZone. Returns null when the record is not this sub. */
export function mapNameFromParentZone(name, label) {
  const n = String(name || "@")
    .trim()
    .replace(/\.$/, "")
    .toLowerCase();
  const lab = String(label || "")
    .trim()
    .toLowerCase();
  if (!lab) return n || "@";
  if (n === lab) return "@";
  if (n.endsWith(`.${lab}`)) return n.slice(0, -(lab.length + 1)) || "@";
  return null;
}
