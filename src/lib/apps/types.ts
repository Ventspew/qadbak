/**
 * Intent-based app installer (Fase 5).
 *
 * An AppTemplate captures the high-level intent of "install <app> on
 * <domain>" — domain + DB + files + config + DNS hints, orchestrated as
 * a single Journal entry. The user describes WHAT they want (a
 * WordPress site for client X) instead of clicking through ten
 * separate primitives.
 */

/** UI form field rendered by /admin/apps/[id]/install. */
export type AppFormField =
  | {
      name: string;
      label: string;
      type: "text" | "email" | "password";
      placeholder?: string;
      help?: string;
      required?: boolean;
      defaultValue?: string;
      pattern?: string;
    }
  | {
      name: string;
      label: string;
      type: "domain";
      help?: string;
      required?: boolean;
    }
  | {
      name: string;
      label: string;
      type: "boolean";
      help?: string;
      defaultValue?: string;
    }
  | {
      name: string;
      label: string;
      type: "select";
      options: Array<{ value: string; label: string }>;
      help?: string;
      required?: boolean;
      defaultValue?: string;
    };

/** Output the user sees on the success screen. Shown ONCE. */
export interface AppInstallResult {
  appId: string;
  domain: string;
  /** Where the user should go to finish setup (e.g. WP install wizard). */
  primaryUrl: string;
  /** Secondary URL, e.g. wp-admin after wizard completes. */
  secondaryUrl?: string;
  /** Credentials to copy-paste somewhere safe. */
  credentials: Array<{
    label: string;
    value: string;
    isSecret: boolean;
  }>;
  /** Short post-install instructions (1-3 sentences). */
  postInstall?: string;
  /** ID of the journal entry capturing the install — for deep linking. */
  journalId: string;
}

/** Context passed to template.install(). */
export interface AppInstallContext {
  /** Already-validated input from the form. */
  input: Record<string, string>;
  /** The session of the admin running the install. */
  session: { username: string; role: "admin" | "client"; id?: string; userId?: string };
}

export interface AppTemplate {
  id: string;
  label: string;
  /** 1-2 sentence pitch shown on the apps grid card. */
  tagline: string;
  /** Emoji or short text shown as the card icon. */
  icon: string;
  /** Longer description shown on the install page. */
  description: string;
  /** Estimated wall-clock install time, shown to the user. */
  etaSeconds?: number;
  /** Form fields the install page will render. */
  inputs: AppFormField[];
  /**
   * Orchestrate the install. Should throw on any unrecoverable error;
   * the wrapper will mark the journal entry failed.
   */
  install(ctx: AppInstallContext): Promise<Omit<AppInstallResult, "appId" | "journalId">>;
}

/** Summary listing item returned by GET /api/admin/apps. */
export interface AppTemplateSummary {
  id: string;
  label: string;
  tagline: string;
  icon: string;
  description: string;
  etaSeconds?: number;
  inputs: AppFormField[];
  category?: string;
  minPhp?: string;
  requiresDb?: boolean;
  featured?: boolean;
}
