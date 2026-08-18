import {
  emit,
  fail,
  readDomainConfigJson,
  writeDomainConfigJson,
  QADBAK_DIR,
} from "./provisioning-common.mjs";
import { syncDovecotQuota } from "./dovecot-quota.mjs";

function invoiceHtml(inv, domain) {
  const issued = new Date(inv.createdAt || Date.now()).toLocaleDateString("nl-NL");
  return `<!DOCTYPE html>
<html lang="nl">
<head><meta charset="utf-8"/><title>Factuur ${inv.id}</title>
<style>
body{font-family:system-ui,sans-serif;max-width:720px;margin:2rem auto;color:#111}
h1{font-size:1.5rem}table{width:100%;border-collapse:collapse;margin-top:1.5rem}
td,th{border:1px solid #ddd;padding:.5rem .75rem;text-align:left}
.total{font-weight:700}
</style></head>
<body>
<h1>Factuur</h1>
<p><strong>${domain}</strong><br/>Factuurnr: ${inv.id}<br/>Datum: ${issued}</p>
<table>
<tr><th>Omschrijving</th><th>Bedrag</th></tr>
<tr><td>${inv.description}</td><td>€ ${Number(inv.amount).toFixed(2)}</td></tr>
<tr class="total"><td>Totaal</td><td>€ ${Number(inv.amount).toFixed(2)} ${inv.currency || "EUR"}</td></tr>
</table>
${inv.clientEmail ? `<p>Factuur voor: ${inv.clientEmail}</p>` : ""}
<p style="margin-top:2rem;color:#666;font-size:.85rem">Gegenereerd door Qadbak</p>
</body></html>`;
}

export async function invoicePdfGenerate(domain, payloadJson) {
  const payload = typeof payloadJson === "string" ? JSON.parse(payloadJson) : payloadJson;
  const invoiceId = String(payload.invoiceId || "").trim();
  if (!invoiceId) fail("invoiceId required");
  const data = await readDomainConfigJson(domain, "billing-invoices.json", { invoices: [] });
  const inv = (data.invoices ?? []).find((i) => i.id === invoiceId);
  if (!inv) fail("Invoice not found");
  const html = invoiceHtml(inv, domain);
  const dir = path.join(QADBAK_DIR, "data", "domain-config", domain, "invoices");
  await mkdir(dir, { recursive: true });
  const file = path.join(dir, `${invoiceId}.html`);
  await writeFile(file, html, "utf8");
  inv.pdfPath = file;
  inv.pdfGeneratedAt = new Date().toISOString();
  await writeDomainConfigJson(domain, "billing-invoices.json", data);
  emit({ ok: true, invoiceId, html, path: file });
}

export async function invoicePaymentLink(domain, payloadJson) {
  const payload = typeof payloadJson === "string" ? JSON.parse(payloadJson) : payloadJson;
  const invoiceId = String(payload.invoiceId || "").trim();
  if (!invoiceId) fail("invoiceId required");
  const data = await readDomainConfigJson(domain, "billing-invoices.json", { invoices: [] });
  const inv = (data.invoices ?? []).find((i) => i.id === invoiceId);
  if (!inv) fail("Invoice not found");
  const amount = Number(inv.amount);
  const currency = String(inv.currency || "EUR").toUpperCase();
  const description = `${inv.description} (${domain})`;
  const redirectUrl =
    process.env.QADBAK_BILLING_RETURN_URL?.trim() ||
    `https://${process.env.QADBAK_PUBLIC_HOST || "qadbak.com"}/domains/${encodeURIComponent(domain)}/tools`;

  const mollieKey = process.env.MOLLIE_API_KEY?.trim();
  if (mollieKey) {
    const res = await fetch("https://api.mollie.com/v2/payments", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${mollieKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        amount: { currency, value: amount.toFixed(2) },
        description,
        redirectUrl,
        metadata: { domain, invoiceId },
      }),
    });
    const body = await res.json();
    if (!res.ok) fail(body.detail || body.title || "Mollie payment failed");
    inv.paymentUrl = body._links?.checkout?.href;
    inv.paymentProvider = "mollie";
    inv.paymentId = body.id;
    await writeDomainConfigJson(domain, "billing-invoices.json", data);
    emit({ ok: true, paymentUrl: inv.paymentUrl, provider: "mollie" });
    return;
  }

  const stripeKey = process.env.STRIPE_SECRET_KEY?.trim();
  if (stripeKey) {
    const params = new URLSearchParams();
    params.set("mode", "payment");
    params.set("success_url", redirectUrl);
    params.set("cancel_url", redirectUrl);
    params.set("line_items[0][price_data][currency]", currency.toLowerCase());
    params.set("line_items[0][price_data][unit_amount]", String(Math.round(amount * 100)));
    params.set("line_items[0][price_data][product_data][name]", description);
    params.set("line_items[0][quantity]", "1");
    params.set("metadata[domain]", domain);
    params.set("metadata[invoiceId]", invoiceId);
    const res = await fetch("https://api.stripe.com/v1/checkout/sessions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${stripeKey}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: params.toString(),
    });
    const body = await res.json();
    if (!res.ok) fail(body.error?.message || "Stripe session failed");
    inv.paymentUrl = body.url;
    inv.paymentProvider = "stripe";
    inv.paymentId = body.id;
    await writeDomainConfigJson(domain, "billing-invoices.json", data);
    emit({ ok: true, paymentUrl: inv.paymentUrl, provider: "stripe" });
    return;
  }

  const stub = `${redirectUrl}?pay=${invoiceId}&amount=${amount}`;
  inv.paymentUrl = stub;
  inv.paymentProvider = "manual";
  await writeDomainConfigJson(domain, "billing-invoices.json", data);
  emit({
    ok: true,
    paymentUrl: stub,
    provider: "manual",
    hint: "Set MOLLIE_API_KEY or STRIPE_SECRET_KEY for live payment links.",
  });
}

export async function mailboxQuotaSet(domain, payloadJson) {
  const payload = typeof payloadJson === "string" ? JSON.parse(payloadJson) : payloadJson;
  const user = String(payload.user || "").trim();
  const quotaMb = parseInt(String(payload.quotaMb || payload.quota || "0"), 10);
  if (!user || !quotaMb) fail("user and quotaMb required");
  const data = await readDomainConfigJson(domain, "mailbox-quotas.json", { limits: {} });
  const limits = data.limits && typeof data.limits === "object" ? data.limits : {};
  limits[user] = { quotaMb, updatedAt: new Date().toISOString() };
  await writeDomainConfigJson(domain, "mailbox-quotas.json", { limits });
  try {
    await syncDovecotQuota();
  } catch (e) {
    fail(
      `Quota saved in the panel, but Dovecot rejected it: ${e instanceof Error ? e.message : String(e)}`.slice(
        0,
        400,
      ),
    );
  }
  emit({ ok: true, user, quotaMb, enforced: true });
}

export async function mailboxQuotasGet(domain) {
  const data = await readDomainConfigJson(domain, "mailbox-quotas.json", { limits: {} });
  emit({ ok: true, limits: data.limits ?? {} });
}
