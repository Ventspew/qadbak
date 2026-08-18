import { fail, readDomainConfigJson } from "./provisioning-common.mjs";

export async function assertCountCap(domain, key, currentCount) {
  const limits = await readDomainConfigJson(domain, "limits.json", {});
  const cap = Number(limits?.[key]);
  if (!Number.isFinite(cap) || cap <= 0) return;
  if (Number(currentCount) >= cap) {
    fail(`${key} limit reached (${cap}).`);
  }
}
