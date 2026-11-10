// Kelviq billing: webhook signatures, plan limits, subscription mirroring
// and API calls.
// The database is simulated: queries are recorded, rows are supplied.
import assert from "node:assert/strict";
import { createHmac, timingSafeEqual } from "node:crypto";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { runInNewContext } from "node:vm";
import ts from "typescript";

class HttpError extends Error {
  constructor(status, message, code, details, headers) {
    super(message); this.status = status; this.code = code; this.details = details; this.headers = headers;
  }
}

function load(path, imports, env = {}) {
  const loadedModule = { exports: {} };
  const source = readFileSync(new URL(path, import.meta.url), "utf8");
  const { outputText } = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } });
  runInNewContext(outputText, { module: loadedModule, exports: loadedModule.exports, Buffer, Date, Headers, URL, URLSearchParams, AbortSignal, console, process: { env },
    fetch: (...args) => globalThis.__testFetch(...args),
    require(name) { if (!(name in imports)) throw new Error(`Unmocked dependency ${name}`); return imports[name]; },
  });
  return loadedModule.exports;
}

const plans = load("../lib/billing/plans.ts", {});

function loadBilling({ env = {}, rows = () => [], fetch: fetchImpl } = {}) {
  const queries = [];
  globalThis.__testFetch = fetchImpl;
  const billing = load("../lib/backend/billing.ts", {
    "node:crypto": { createHmac, timingSafeEqual },
    "@/lib/backend/http": { HttpError },
    "@/lib/billing/plans": plans,
    "@/lib/seo": { siteUrl: () => "https://shop.fixture-retail.net" },
    "@/lib/backend/db": { dbQuery: async (sql, values) => {
      queries.push({ sql, values });
      const result = rows(sql, values) ?? [];
      return { rows: result, rowCount: result.length || (sql.trimStart().startsWith("INSERT") ? 1 : 0) };
    } },
  }, env);
  return { billing, queries };
}

const SECRET = "kq_whsec_dGVzdC1zZWNyZXQta2V5";
const CUSTOMER = "6f1d7a2e-3b4c-4d5e-8f90-1a2b3c4d5e6f";
function signed(body, { key = SECRET, id = "msg_1", at = Math.floor(Date.now() / 1000) } = {}) {
  const signature = createHmac("sha256", key).update(`${id}.${at}.${body}`, "utf8").digest("hex");
  return new Headers({ "webhook-id": id, "webhook-timestamp": String(at), "webhook-signature": `v1,${signature}` });
}

test("a correctly signed Kelviq delivery verifies (hex HMAC over id.timestamp.body)", () => {
  const { billing } = loadBilling({ env: { KELVIQ_WEBHOOK_SECRET: SECRET } });
  const body = '{"type":"subscription.created"}';
  assert.equal(billing.verifyKelviqSignature(signed(body), body), true);
});

test("tampered, stale, wrongly keyed, malformed or unsigned deliveries are refused", () => {
  const { billing } = loadBilling({ env: { KELVIQ_WEBHOOK_SECRET: SECRET } });
  const body = '{"type":"subscription.created"}';
  assert.equal(billing.verifyKelviqSignature(signed(body), body.replace("created", "updated")), false);
  assert.equal(billing.verifyKelviqSignature(signed(body, { at: Math.floor(Date.now() / 1000) - 3600 }), body), false);
  assert.equal(billing.verifyKelviqSignature(signed(body, { key: "kq_whsec_someone-else" }), body), false);
  assert.equal(billing.verifyKelviqSignature(new Headers({ "webhook-id": "a", "webhook-timestamp": String(Math.floor(Date.now() / 1000)), "webhook-signature": "v1,zz" }), body), false);
  assert.equal(billing.verifyKelviqSignature(new Headers(), body), false);
  // No secret configured: nothing verifies.
  assert.equal(loadBilling().billing.verifyKelviqSignature(signed(body), body), false);
});

test("trialing, active and past-due subscriptions keep a store open; the rest don't", () => {
  for (const status of ["trialing", "active", "past_due"]) assert.equal(plans.grantsAccess(status), true, status);
  for (const status of ["canceled", "incomplete", "incomplete_expired", "paused", "superseded", "", undefined]) assert.equal(plans.grantsAccess(status), false, String(status));
});

test("Starter caps products at 25, Pro doesn't, and no plan blocks adding when required", async () => {
  const subscription = (plan, status) => () => [{ plan, status, provider_subscription_id: "sub_1", charge_period: "MONTHLY", current_period_end: null, cancel_at_period_end: false, synced_at: null }];
  const starter = loadBilling({ rows: subscription("starter", "active") }).billing;
  await starter.assertListingAllowed("c", true, 24);
  await assert.rejects(starter.assertListingAllowed("c", true, 25), (error) => error.status === 402 && error.code === "PLAN_LIMIT");
  await assert.rejects(starter.assertCustomDomainAllowed("c", true), (error) => error.status === 402);

  const pro = loadBilling({ rows: subscription("pro", "trialing") }).billing;
  await pro.assertListingAllowed("c", true, 400);
  await pro.assertCustomDomainAllowed("c", true);

  const lapsed = loadBilling({ rows: subscription("pro", "canceled") }).billing;
  await assert.rejects(lapsed.assertListingAllowed("c", true, 0), (error) => error.code === "SUBSCRIPTION_REQUIRED");
  // Billing switched off: everyone keeps full access, as before.
  await lapsed.assertListingAllowed("c", false, 400);
});

test("REST and webhook subscription shapes normalize the same way, including scheduled cancellation", () => {
  const { billing } = loadBilling({ env: { KELVIQ_PLAN_PRO: "pro-v2" } });
  const rest = billing.normalizeSubscription({ id: "s1", status: "active", plan: { identifier: "pro-v2" }, billingPeriodEndTime: "2026-12-01T00:00:00Z", recurrenceUnit: "YEAR" });
  assert.equal(rest.plan, "pro");
  assert.equal(rest.chargePeriod, "YEARLY");
  assert.equal(rest.cancelAtPeriodEnd, false);
  assert.equal(rest.currentPeriodEnd.toISOString(), "2026-12-01T00:00:00.000Z");

  const ending = billing.normalizeSubscription({ id: "s1", status: "active", plan: { identifier: "pro-v2" }, billing_period_end_time: "2026-12-01T00:00:00Z", end_date: "2026-12-01" });
  assert.equal(ending.cancelAtPeriodEnd, true);
  assert.equal(billing.normalizeSubscription({ id: "s2", status: "active", plan: { identifier: "unknown" } }).plan, null);
});

test("the current subscription is the newest that grants access, else the newest", () => {
  const { billing } = loadBilling();
  const picked = billing.pickCurrent([
    { id: "old", status: "canceled", plan: { identifier: "scale" }, modifiedOn: "2026-11-09T00:00:00Z" },
    { id: "live", status: "active", plan: { identifier: "starter" }, modifiedOn: "2026-10-01T00:00:00Z" },
  ]);
  assert.equal(picked.id, "live");
  assert.equal(billing.pickCurrent([{ id: "a", status: "canceled", plan: { identifier: "pro" }, modifiedOn: "2026-01-01" }, { id: "b", status: "canceled", plan: { identifier: "pro" }, modifiedOn: "2026-02-01" }]).id, "b");
  assert.equal(billing.pickCurrent([]), null);
});

test("webhook events are matched to a seller through the Kelviq customer id or checkout metadata", () => {
  const { billing } = loadBilling();
  assert.equal(billing.webhookCustomerId({ data: { object: { customer: { customer_id: CUSTOMER.toUpperCase() } } } }), CUSTOMER);
  assert.equal(billing.webhookCustomerId({ data: { object: { metadata: { customer_id: CUSTOMER } } } }), CUSTOMER);
  assert.equal(billing.webhookCustomerId({ data: { object: { customer: { customer_id: "1" } } } }), null);
  assert.equal(billing.webhookCustomerId({}), null);
});

test("sync reads the seller's subscriptions from Kelviq and mirrors the current one", async () => {
  const calls = [];
  const { billing, queries } = loadBilling({
    env: { KELVIQ_API_KEY: "sk_test", KELVIQ_ENVIRONMENT: "sandbox" },
    fetch: async (url, init) => {
      calls.push({ url, init });
      return new Response(JSON.stringify({ next: null, results: [{ id: "sub_7", status: "trialing", plan: { identifier: "scale" }, billingPeriodEndTime: "2026-11-17T00:00:00Z", modifiedOn: "2026-11-10T00:00:00Z" }] }), { status: 200 });
    },
  });
  await billing.syncSubscription(CUSTOMER);
  assert.match(calls[0].url, /^https:\/\/sandboxapi\.kelviq\.com\/api\/v1\/subscriptions\/\?customer_id=6f1d7a2e/);
  assert.equal(calls[0].init.headers.Authorization, "Bearer sk_test");
  const upsert = queries.find((query) => query.sql.includes("INSERT INTO seller_subscriptions"));
  assert.deepEqual(Array.from(upsert.values.slice(0, 5)), [CUSTOMER, "scale", "sub_7", "trialing", "MONTHLY"]);
});

test("checkout sends the plan, period, our customer id and a first-time trial", async () => {
  const bodies = {};
  const { billing } = loadBilling({
    env: { KELVIQ_API_KEY: "sk_live" },
    rows: (sql) => (sql.includes("FROM customers") ? [{ email: "seller@fixture-retail.net", name: "Sam" }] : []),
    fetch: async (url, init) => {
      bodies[new URL(url).pathname] = JSON.parse(init.body);
      return new Response(JSON.stringify(url.endsWith("/checkout/") ? { checkoutUrl: "https://checkout.kelviq.com/x" } : {}), { status: 201 });
    },
  });
  assert.equal(await billing.createCheckout(CUSTOMER, { period: "YEARLY", plan: "pro" }), "https://checkout.kelviq.com/x");
  assert.deepEqual(bodies["/api/v1/customers/"], { customerId: CUSTOMER, email: "seller@fixture-retail.net", name: "Sam" });
  const checkout = bodies["/api/v1/checkout/"];
  assert.equal(checkout.planIdentifier, "pro");
  assert.equal(checkout.chargePeriod, "YEARLY");
  assert.equal(checkout.customerId, CUSTOMER);
  assert.equal(checkout.trialPeriod, 7);
  assert.equal(checkout.successUrl, "https://shop.fixture-retail.net/seller?tab=billing&checkout=done");
});

test("a seller who already has a plan can't open a second checkout", async () => {
  const { billing } = loadBilling({
    env: { KELVIQ_API_KEY: "sk_live" },
    rows: () => [{ plan: "pro", status: "active", provider_subscription_id: "sub_1", charge_period: "MONTHLY", current_period_end: null, cancel_at_period_end: false, synced_at: null }],
    fetch: async () => { throw new Error("must not call Kelviq"); },
  });
  await assert.rejects(billing.createCheckout(CUSTOMER, { period: "MONTHLY", plan: "scale" }), (error) => error.status === 409);
});

test("the portal link carries Kelviq's session token", async () => {
  const { billing } = loadBilling({
    env: { KELVIQ_API_KEY: "sk_live" },
    rows: (sql) => (sql.includes("FROM customers") ? [{ email: "a@b.co", name: "A" }] : []),
    fetch: async (url) => new Response(JSON.stringify(url.endsWith("/portal/session/") ? { customerPortalUrl: "https://www.kelviq.com/portal/avokarto/", token: "cpt-123" } : {}), { status: 200 }),
  });
  assert.equal(await billing.createPortalUrl(CUSTOMER), "https://www.kelviq.com/portal/avokarto/?token=cpt-123");
});
