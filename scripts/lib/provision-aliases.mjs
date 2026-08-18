import {
  emit,
  fail,
  resolveDomainUser,
  readDomainConfigJson,
  writeDomainConfigJson,
  assertNotAliasDomain,
} from "./provisioning-common.mjs";
import {
  discoverMailLayout,
  appendMapEntry,
  removeMapEntry,
  postmapReloadAll,
  QADBAK_POSTFIX_VIRTUAL,
} from "./mail-layout.mjs";
import { RESERVED_MAILBOX_LOCALS } from "./mail-reserved.mjs";

function normFrom(domain, from) {
  const f = String(from || "").trim();
  if (!f) fail("Alias from address required");
  return f.includes("@") ? f.toLowerCase() : `${f.toLowerCase()}@${domain}`;
}

export async function aliasList(domain) {
  await assertNotAliasDomain(domain, "aliases");
  await resolveDomainUser(domain);
  const aliases = await readDomainConfigJson(domain, "aliases.json", []);
  emit({ ok: true, aliases, source: "qadbak-domain-config" });
}

export async function aliasCreate(domain, from, to) {
  await assertNotAliasDomain(domain, "aliases");
  const { user, home } = await resolveDomainUser(domain);
  const address = normFrom(domain, from);
  const dest = String(to || "").trim();
  const local = address.split("@")[0];
  if (RESERVED_MAILBOX_LOCALS.has(local)) {
    fail(
      `Alias local "${local}" is reserved (it collides with a panel mail page).`,
    );
  }
  const aliases = await readDomainConfigJson(domain, "aliases.json", []);
  if (aliases.some((a) => a.from.toLowerCase() === address)) {
    fail(`Alias already exists: ${address}`);
  }
  aliases.push({ from: address, to: dest });
  await writeDomainConfigJson(domain, "aliases.json", aliases);

  const layout = await discoverMailLayout(domain, user, home);
  const mapPath = layout.aliasMap || QADBAK_POSTFIX_VIRTUAL;
  await appendMapEntry(mapPath, address, dest);
  await postmapReloadAll();
  emit({ ok: true, from: address, to: dest });
}

export async function aliasDelete(domain, from) {
  await assertNotAliasDomain(domain, "aliases");
  const { user, home } = await resolveDomainUser(domain);
  const address = normFrom(domain, from);
  let aliases = await readDomainConfigJson(domain, "aliases.json", []);
  aliases = aliases.filter((a) => a.from.toLowerCase() !== address);
  await writeDomainConfigJson(domain, "aliases.json", aliases);

  const layout = await discoverMailLayout(domain, user, home);
  const mapPath = layout.aliasMap || QADBAK_POSTFIX_VIRTUAL;
  await removeMapEntry(mapPath, address);
  await postmapReloadAll();
  emit({ ok: true });
}
