/**
 * App-install orchestrator.
 *
 * Wraps a single template.install() call in a Journal entry so the user
 * sees one record "Installed WordPress on foo.com" containing every
 * underlying step (db-create, file download, wp-config write, chown).
 */

import { beginJournal } from "@/lib/journal";
import {
  consumeLastJournalSteps,
  runWithJournalStore,
} from "@/lib/provisioner/native-exec";
import { getTemplate } from "./registry";
import type { AppInstallContext, AppInstallResult, AppTemplate } from "./types";

export class AppValidationError extends Error {
  constructor(msg: string) {
    super(msg);
    this.name = "AppValidationError";
  }
}

export class AppNotFoundError extends Error {
  constructor(id: string) {
    super(`Unknown app template "${id}".`);
    this.name = "AppNotFoundError";
  }
}

const ALLOWED_FIELD_PATTERNS = new Set([
  "^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$",
  "^[a-zA-Z0-9_]{1,32}$",
]);

function isValidEmail(value: string): boolean {
  if (value.length > 254 || value.includes(" ")) return false;
  const at = value.indexOf("@");
  if (at <= 0 || at >= value.length - 1) return false;
  const domain = value.slice(at + 1);
  if (!domain.includes(".") || domain.startsWith(".") || domain.endsWith(".")) {
    return false;
  }
  return true;
}

function isValidDomainName(value: string): boolean {
  if (value.length < 3 || value.length > 253 || !value.includes(".")) return false;
  const labels = value.split(".");
  for (const label of labels) {
    if (!label || label.length > 63) return false;
    if (label.startsWith("-") || label.endsWith("-")) return false;
    for (const ch of label) {
      const lower = ch.toLowerCase();
      const ok =
        (lower >= "a" && lower <= "z") ||
        (ch >= "0" && ch <= "9") ||
        ch === "-";
      if (!ok) return false;
    }
  }
  return true;
}

function isValidSubdomainLabel(value: string): boolean {
  if (value.length < 1 || value.length > 63) return false;
  if (value.startsWith("-") || value.endsWith("-")) return false;
  for (const ch of value) {
    const lower = ch.toLowerCase();
    const ok = (lower >= "a" && lower <= "z") || (ch >= "0" && ch <= "9") || ch === "-";
    if (!ok) return false;
  }
  return true;
}

function isValidDbIdentifier(value: string): boolean {
  if (value.length < 1 || value.length > 32) return false;
  for (const ch of value) {
    const ok =
      (ch >= "a" && ch <= "z") ||
      (ch >= "A" && ch <= "Z") ||
      (ch >= "0" && ch <= "9") ||
      ch === "_";
    if (!ok) return false;
  }
  return true;
}

function matchesAllowedPattern(pattern: string, value: string): boolean {
  if (pattern === "^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$") {
    return isValidSubdomainLabel(value);
  }
  if (pattern === "^[a-zA-Z0-9_]{1,32}$") {
    return isValidDbIdentifier(value);
  }
  return false;
}

function validate(template: AppTemplate, input: Record<string, unknown>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const field of template.inputs) {
    if (field.type === "boolean") {
      const raw = input[field.name];
      out[field.name] =
        raw === true || raw === "true" || raw === "1" ? "true" : "false";
      continue;
    }

    if (field.type === "select") {
      const raw = input[field.name];
      const value =
        typeof raw === "string" && raw.trim()
          ? raw.trim()
          : field.defaultValue ?? field.options[0]?.value ?? "";
      const allowed = new Set(field.options.map((option) => option.value));
      if (!value) {
        if (field.required) {
          throw new AppValidationError(`Missing required field "${field.label}".`);
        }
        continue;
      }
      if (!allowed.has(value)) {
        throw new AppValidationError(
          `"${field.label}" must be one of: ${[...allowed].join(", ")}.`,
        );
      }
      out[field.name] = value;
      continue;
    }

    const raw = input[field.name];
    const value = typeof raw === "string" ? raw.trim() : "";
    if (!value) {
      if (field.required) {
        throw new AppValidationError(`Missing required field "${field.label}".`);
      }
      if ("defaultValue" in field && field.defaultValue) {
        out[field.name] = field.defaultValue;
      }
      continue;
    }
    if (field.type === "domain") {
      if (!isValidDomainName(value)) {
        throw new AppValidationError(`"${field.label}" must look like a domain.`);
      }
    } else if (field.type === "email") {
      if (!isValidEmail(value)) {
        throw new AppValidationError(`"${field.label}" must be a valid email.`);
      }
    } else if ("pattern" in field && field.pattern) {
      if (!ALLOWED_FIELD_PATTERNS.has(field.pattern)) {
        throw new AppValidationError(`"${field.label}" has an unsupported validation pattern.`);
      }
      if (!matchesAllowedPattern(field.pattern, value)) {
        throw new AppValidationError(
          `"${field.label}" does not match the required format (${field.pattern}).`,
        );
      }
    }
    out[field.name] = value;
  }
  return out;
}

export async function runAppInstall(opts: {
  templateId: string;
  rawInput: Record<string, unknown>;
  session: AppInstallContext["session"];
}): Promise<AppInstallResult> {
  return runWithJournalStore(async () => {
    const template = await getTemplate(opts.templateId);
    if (!template) throw new AppNotFoundError(opts.templateId);

    const input = validate(template, opts.rawInput);

    const journal = beginJournal({
      action: `app.install.${template.id}`,
      summary: `Install ${template.label} on ${input.domain ?? "(unknown)"}`,
      session: opts.session,
      target: input.domain ? { domain: input.domain } : undefined,
      metadata: { templateId: template.id, fields: Object.keys(input) },
    });
    consumeLastJournalSteps();
    journal.infoStep(
      `Validated input for ${template.label} — fields: ${Object.keys(input).join(", ")}`,
    );

    try {
      const partial = await template.install({ input, session: opts.session });
      journal.captureFromHelper(consumeLastJournalSteps());
      journal.infoStep(
        `${template.label} installed on ${partial.domain}. Wizard URL: ${partial.primaryUrl}`,
      );
      const finished = await journal.finish(true);
      return {
        ...partial,
        appId: template.id,
        journalId: finished.id,
      };
    } catch (err) {
      journal.captureFromHelper(consumeLastJournalSteps());
      await journal.finish(false, err instanceof Error ? err.message : String(err));
      throw err;
    }
  });
}
