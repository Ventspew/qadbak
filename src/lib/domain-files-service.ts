import {
  breadcrumbsFor,
  isDirWritable,
  isPanelFilesMode,
  listDomainFiles,
  type DomainFilesListing,
} from "./domain-files";
import {
  mapRequestedFilesDir,
  resolveDomainFilesContext,
} from "./domain-files-context";
import {
  deleteDomainFileLive,
  listDomainFilesLive,
  liveFilesEnabled,
  mkdirDomainLive,
  probeLiveFilesystem,
  readDomainFileLive,
  writeDomainFileLive,
} from "./domain-files-live";
import type { Role } from "./types";
import { createDomainLegacyLoginLink } from "./hosting-remote";
import { sanitizeUserFacingMessage } from "./user-facing-errors";

export async function resolveDomainFilesListing(
  domain: string,
  dir: string,
  actor: { role: Role; domains: string[] },
): Promise<{ listing: DomainFilesListing; error: string }> {
  const ctx = await resolveDomainFilesContext(domain, actor);
  const cwd = mapRequestedFilesDir(ctx, dir);
  const homeLabel = ctx.jailed ? domain : "Home";
  const base = {
    home: ctx.filesRoot,
    cwd,
    breadcrumbs: breadcrumbsFor(cwd, homeLabel),
    writable: isDirWritable(cwd),
    docRoot: ctx.defaultDir,
    jailed: ctx.jailed,
    quickPaths: ctx.quickPaths,
  };

  if (isPanelFilesMode()) {
    return { listing: { ...listDomainFiles(domain, cwd), ...base }, error: "" };
  }

  if (liveFilesEnabled()) {
    try {
      const entries = await listDomainFilesLive(domain, cwd, actor);
      return {
        listing: { ...base, mode: "qadbak", entries },
        error: "",
      };
    } catch (nativeErr) {
      const hint =
        nativeErr instanceof Error ? nativeErr.message : "Native files unavailable";
      let fileManagerUrl: string | undefined;
      try {
        fileManagerUrl = await createDomainLegacyLoginLink(domain, actor, {
          redirectUrl: "/filemin/index.cgi",
        });
      } catch {
        return {
          listing: { ...base, mode: "legacy" },
          error: sanitizeUserFacingMessage(
            `${hint}. Run on the server: sudo bash /opt/qadbak/scripts/configure-domain-fs-sudo.sh then pm2 restart qadbak. Test: sudo -u qadbak sudo -n /opt/qadbak/scripts/run-domain-fs-helper.sh list /home/UNIX_USER`,
          ),
        };
      }
      return {
        listing: { ...base, mode: "legacy", fileManagerUrl },
        error: "",
      };
    }
  }

  let fileManagerUrl: string | undefined;
  let error = "";
  try {
    fileManagerUrl = await createDomainLegacyLoginLink(domain, actor, {
      redirectUrl: "/filemin/index.cgi",
    });
  } catch (e) {
    error = sanitizeUserFacingMessage(
      e instanceof Error ? e.message : "Could not load file manager.",
    );
  }

  return {
    listing: {
      ...base,
      mode: "legacy",
      fileManagerUrl,
    },
    error,
  };
}

/** True when live native files are configured and responding (never caches a failed probe). */
export async function liveFilesActive(): Promise<boolean> {
  if (!liveFilesEnabled()) return false;
  return probeLiveFilesystem();
}

export {
  liveFilesEnabled,
  extractArchiveLive,
  createArchiveLive,
} from "./domain-files-live";

export {
  readDomainFileLive,
  writeDomainFileLive,
  mkdirDomainLive,
  deleteDomainFileLive,
  uploadDomainFileLive,
  uploadDomainFileFromTempLive,
  moveDomainPathLive,
} from "./domain-files-live";
