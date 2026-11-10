import { createHmac, timingSafeEqual } from "node:crypto";
import { dbQuery } from "@/lib/backend/db";
import { HttpError } from "@/lib/backend/http";
import {
	ACCESS_STATUSES,
	grantsAccess,
	isBillingPeriod,
	PLAN_KEYS,
	PLANS,
	TRIAL_DAYS,
	type BillingPeriod,
	type PlanKey,
} from "@/lib/billing/plans";
import { siteUrl } from "@/lib/seo";

/* ------------------------------------------------------------------------
 * Seller subscriptions through Kelviq (https://docs.kelviq.com).
 *
 * Our customer id is the Kelviq customerId, so every subscription Kelviq
 * reports is already keyed to the seller. Kelviq is the source of truth:
 * webhooks only tell us *whose* subscription changed, and we then read that
 * customer's subscriptions back from the API and mirror the current one
 * into seller_subscriptions. Out-of-order or missing deliveries therefore
 * can't leave a seller on the wrong plan, and the billing screen can
 * reconcile on its own when a webhook is late.
 * --------------------------------------------------------------------- */

function env(name: string) {
	return process.env[name]?.trim() ?? "";
}

function kelviqApi() {
	const custom = env("KELVIQ_API_BASE");
	if (custom) return custom.replace(/\/+$/, "");
	return env("KELVIQ_ENVIRONMENT").toLowerCase() === "sandbox"
		? "https://sandboxapi.kelviq.com/api/v1"
		: "https://api.kelviq.com/api/v1";
}

/** Kelviq plan identifiers for our plans; default to the plan keys themselves. */
function kelviqPlanIds(): Record<PlanKey, string> {
	return {
		pro: env("KELVIQ_PLAN_PRO") || "pro",
		scale: env("KELVIQ_PLAN_SCALE") || "scale",
		starter: env("KELVIQ_PLAN_STARTER") || "starter",
	};
}

/** Whether checkout can run: a server API key. */
export function billingConfigured() {
	return Boolean(env("KELVIQ_API_KEY"));
}

function planForIdentifier(identifier: unknown): PlanKey | null {
	if (typeof identifier !== "string" || !identifier) return null;
	const plans = kelviqPlanIds();
	return PLAN_KEYS.find((key) => plans[key] === identifier) ?? null;
}

type KelviqError = { detail?: unknown; message?: unknown; errors?: unknown } | null;

async function kelviqRequest<T>(method: "GET" | "POST", path: string, body?: unknown, { allow = [] as number[] } = {}): Promise<{ status: number; data: T | null }> {
	const key = env("KELVIQ_API_KEY");
	if (!key) throw new HttpError(503, "Billing isn't set up yet.", "BILLING_NOT_CONFIGURED");
	const response = await fetch(`${kelviqApi()}${path}`, {
		body: body === undefined ? undefined : JSON.stringify(body),
		cache: "no-store",
		headers: { Accept: "application/json", Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
		method,
		signal: AbortSignal.timeout(12_000),
	}).catch(() => {
		throw new HttpError(502, "Couldn't reach our payment partner. Please try again.", "PAYMENTS_UNREACHABLE");
	});
	const data = (await response.json().catch(() => null)) as T | null;
	if (!response.ok && !allow.includes(response.status)) {
		console.error("Kelviq API error", method, path, response.status, data as KelviqError);
		if (response.status === 429) throw new HttpError(503, "Billing is busy right now. Please try again in a minute.", "PAYMENTS_BUSY");
		throw new HttpError(502, "Our payment partner didn't accept that. Please try again.", "PAYMENTS_ERROR");
	}
	return { data, status: response.status };
}

/* ------------------------------------------------------------------------
 * Subscriptions
 * --------------------------------------------------------------------- */

export type SellerSubscription = {
	cancelAtPeriodEnd: boolean;
	chargePeriod: BillingPeriod;
	currentPeriodEnd: string | null;
	plan: PlanKey;
	status: string;
	subscriptionId: string;
	syncedAt: string | null;
};

type SubscriptionRow = {
	cancel_at_period_end: boolean;
	charge_period: string;
	current_period_end: Date | null;
	plan: PlanKey;
	provider_subscription_id: string;
	status: string;
	synced_at: Date | null;
};

const SUBSCRIPTION_COLUMNS = "plan, status, provider_subscription_id, charge_period, current_period_end, cancel_at_period_end, synced_at";

function toSubscription(row: SubscriptionRow): SellerSubscription {
	return {
		cancelAtPeriodEnd: row.cancel_at_period_end,
		chargePeriod: isBillingPeriod(row.charge_period) ? row.charge_period : "MONTHLY",
		currentPeriodEnd: row.current_period_end?.toISOString() ?? null,
		plan: row.plan,
		status: row.status,
		subscriptionId: row.provider_subscription_id,
		syncedAt: row.synced_at?.toISOString() ?? null,
	};
}

export async function getSubscription(customerId: string) {
	const result = await dbQuery<SubscriptionRow>(
		`SELECT ${SUBSCRIPTION_COLUMNS} FROM seller_subscriptions WHERE customer_id = $1`,
		[customerId],
	);
	return result.rows[0] ? toSubscription(result.rows[0]) : null;
}

/**
 * The plan whose limits apply to this seller, or null when they have no
 * plan that grants access. With subscriptions not required everyone gets
 * Pro's limits, as before billing existed.
 */
export async function effectivePlan(customerId: string, required: boolean): Promise<PlanKey | null> {
	if (!required) return "pro";
	const subscription = await getSubscription(customerId);
	return subscription && grantsAccess(subscription.status) ? subscription.plan : null;
}

/** Throws unless the seller's plan allows this many listings after adding one. */
export async function assertListingAllowed(customerId: string, required: boolean, otherListings: number) {
	const plan = await effectivePlan(customerId, required);
	if (!plan) {
		throw new HttpError(402, "Start your free trial to add products to your store.", "SUBSCRIPTION_REQUIRED");
	}
	const limit = PLANS[plan].listingLimit;
	if (limit !== null && otherListings >= limit) {
		throw new HttpError(
			402,
			`The ${PLANS[plan].name} plan includes up to ${limit} products. Upgrade to Pro for unlimited products.`,
			"PLAN_LIMIT",
		);
	}
}

/** Throws unless the seller's plan includes a custom domain. */
export async function assertCustomDomainAllowed(customerId: string, required: boolean) {
	const plan = await effectivePlan(customerId, required);
	if (!plan || !PLANS[plan].customDomain) {
		throw new HttpError(402, "Connecting your own domain is part of the Pro plan.", "PLAN_LIMIT");
	}
}

/**
 * Opens or closes stores to match billing. With subscriptions required, a
 * store without a plan that grants access goes 'unpaid' (hidden everywhere
 * an inactive store is); otherwise it's 'active'. Suspended stores are an
 * admin decision and are never touched. One customer, or every store when
 * customerId is null (after the admin flips the switch).
 */
export async function syncStoreBilling(customerId: string | null, required: boolean) {
	await dbQuery(
		`
			UPDATE reseller_stores s SET status = next.status, updated_at = now()
			FROM (
				SELECT rs.id,
					CASE WHEN $1::boolean AND NOT EXISTS (
						SELECT 1 FROM seller_subscriptions ss
						WHERE ss.customer_id = rs.customer_id AND ss.status = ANY($3::text[])
					) THEN 'unpaid' ELSE 'active' END AS status
				FROM reseller_stores rs
				WHERE rs.status IN ('active', 'unpaid') AND ($2::uuid IS NULL OR rs.customer_id = $2::uuid)
			) next
			WHERE s.id = next.id AND s.status <> next.status
		`,
		[required, customerId, [...ACCESS_STATUSES]],
	);
}

/* ------------------------------------------------------------------------
 * Reading Kelviq subscriptions back
 * --------------------------------------------------------------------- */

/** A Kelviq subscription, REST (camelCase) or webhook (snake_case) shape. */
export type KelviqSubscription = {
	billingPeriodEndTime?: string | null;
	billing_period_end_time?: string | null;
	canceledAt?: string | null;
	canceled_at?: string | null;
	endDate?: string | null;
	end_date?: string | null;
	id?: string;
	modifiedOn?: string | null;
	modified_on?: string | null;
	plan?: { identifier?: string | null } | null;
	recurrence?: string | null;
	recurrenceUnit?: string | null;
	recurrence_unit?: string | null;
	status?: string;
};

function toDate(value: unknown) {
	if (typeof value === "number") return new Date(value * 1000);
	if (typeof value === "string" && value) {
		// Kelviq sends ISO strings, and occasionally "yyyy-MM-dd HH:mm:ss" (UTC).
		const normalized = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}(:\d{2})?$/.test(value) ? `${value.replace(" ", "T")}Z` : value;
		const date = new Date(/^\d+$/.test(normalized) ? Number(normalized) * 1000 : normalized);
		return Number.isNaN(date.getTime()) ? null : date;
	}
	return null;
}

function chargePeriodOf(subscription: KelviqSubscription): BillingPeriod {
	const text = `${subscription.recurrence ?? ""} ${subscription.recurrenceUnit ?? subscription.recurrence_unit ?? ""}`.toUpperCase();
	return /YEAR|ANNUAL/.test(text) ? "YEARLY" : "MONTHLY";
}

/** The fields we keep from one Kelviq subscription. */
export function normalizeSubscription(subscription: KelviqSubscription) {
	const status = (subscription.status ?? "").toLowerCase();
	const endDate = toDate(subscription.endDate ?? subscription.end_date);
	const canceledAt = toDate(subscription.canceledAt ?? subscription.canceled_at);
	const periodEnd = toDate(subscription.billingPeriodEndTime ?? subscription.billing_period_end_time);
	// Kelviq has no cancel-at-period-end flag: a still-running subscription
	// that has a cancellation time or an end date is ending.
	const cancelAtPeriodEnd = grantsAccess(status) && Boolean(canceledAt || endDate);
	return {
		cancelAtPeriodEnd,
		chargePeriod: chargePeriodOf(subscription),
		currentPeriodEnd: cancelAtPeriodEnd && endDate ? endDate : periodEnd ?? endDate,
		id: subscription.id ?? "",
		modifiedOn: toDate(subscription.modifiedOn ?? subscription.modified_on),
		plan: planForIdentifier(subscription.plan?.identifier),
		status,
	};
}

/**
 * Of a customer's subscriptions, the one that decides their plan: one that
 * grants access (newest first), else the most recently changed.
 */
export function pickCurrent(subscriptions: KelviqSubscription[]) {
	const ours = subscriptions.map(normalizeSubscription).filter((item) => item.id && item.plan && item.status);
	const newest = (a: (typeof ours)[number], b: (typeof ours)[number]) => (b.modifiedOn?.getTime() ?? 0) - (a.modifiedOn?.getTime() ?? 0);
	return ours.filter((item) => grantsAccess(item.status)).sort(newest)[0] ?? ours.sort(newest)[0] ?? null;
}

async function listCustomerSubscriptions(customerId: string) {
	const items: KelviqSubscription[] = [];
	for (let page = 1; page <= 5; page += 1) {
		const query = new URLSearchParams({ customer_id: customerId, page: String(page), page_size: "100" });
		const { data } = await kelviqRequest<{ next?: string | null; results?: KelviqSubscription[] }>("GET", `/subscriptions/?${query}`);
		items.push(...(data?.results ?? []));
		if (!data?.next) break;
	}
	return items;
}

/**
 * Reads this seller's subscriptions from Kelviq and mirrors the current one.
 * Returns the stored subscription (null when they have never subscribed).
 */
export async function syncSubscription(customerId: string) {
	const current = pickCurrent(await listCustomerSubscriptions(customerId));
	if (!current?.plan) {
		await dbQuery(`UPDATE seller_subscriptions SET synced_at = now() WHERE customer_id = $1`, [customerId]);
		return getSubscription(customerId);
	}
	await dbQuery(
		`
			INSERT INTO seller_subscriptions (
				customer_id, plan, provider_subscription_id, status, charge_period,
				current_period_end, cancel_at_period_end, provider_updated_at, synced_at
			)
			VALUES ($1, $2, $3, $4, $5, $6, $7, $8, now())
			ON CONFLICT (customer_id) DO UPDATE SET
				plan = EXCLUDED.plan,
				provider_subscription_id = EXCLUDED.provider_subscription_id,
				status = EXCLUDED.status,
				charge_period = EXCLUDED.charge_period,
				current_period_end = EXCLUDED.current_period_end,
				cancel_at_period_end = EXCLUDED.cancel_at_period_end,
				provider_updated_at = EXCLUDED.provider_updated_at,
				synced_at = now(),
				updated_at = now()
		`,
		[
			customerId,
			current.plan,
			current.id,
			current.status,
			current.chargePeriod,
			current.currentPeriodEnd,
			current.cancelAtPeriodEnd,
			current.modifiedOn,
		],
	);
	return getSubscription(customerId);
}

/* ------------------------------------------------------------------------
 * Customers, checkout, plan changes, cancellation, portal
 * --------------------------------------------------------------------- */

/** Creates the seller as a Kelviq customer (keyed by our id); an existing one is fine. */
async function ensureCustomer(customerId: string) {
	const result = await dbQuery<{ email: string; name: string }>(`SELECT email, name FROM customers WHERE id = $1`, [customerId]);
	const customer = result.rows[0];
	if (!customer) throw new HttpError(404, "We couldn't find your account.", "NOT_FOUND");
	await kelviqRequest("POST", "/customers/", { customerId, email: customer.email, name: customer.name }, { allow: [400, 409, 422] });
	return customer;
}

export type CheckoutOptions = { period: BillingPeriod; plan: PlanKey };

/** A Kelviq checkout link for this seller and plan (free trial on the first plan only). */
export async function createCheckout(customerId: string, { period, plan }: CheckoutOptions) {
	if (!billingConfigured()) {
		throw new HttpError(503, "Billing isn't set up yet. Please try again soon.", "BILLING_NOT_CONFIGURED");
	}
	const current = await getSubscription(customerId);
	// A second checkout would start a second, separately billed subscription.
	if (current && grantsAccess(current.status)) {
		throw new HttpError(409, "You already have a plan. Switch plans from your billing page.", "ALREADY_SUBSCRIBED");
	}
	const customer = await ensureCustomer(customerId);
	const base = siteUrl();
	const { data } = await kelviqRequest<{ checkoutUrl?: string }>("POST", "/checkout/", {
		cancelUrl: `${base}/seller?tab=billing&checkout=cancelled`,
		chargePeriod: period,
		customerId,
		email: customer.email,
		lockEmail: true,
		metadata: { customer_id: customerId, plan },
		planIdentifier: kelviqPlanIds()[plan],
		successUrl: `${base}/seller?tab=billing&checkout=done`,
		// Trial only for a seller who has never had a plan.
		...(current ? {} : { trialPeriod: TRIAL_DAYS }),
	});
	if (!data?.checkoutUrl) throw new HttpError(502, "Our payment partner didn't return a checkout link.", "PAYMENTS_ERROR");
	return data.checkoutUrl;
}

async function requireActiveSubscription(customerId: string) {
	const current = await syncSubscription(customerId);
	if (!current || !grantsAccess(current.status)) {
		throw new HttpError(409, "You don't have an active plan to change.", "NO_SUBSCRIPTION");
	}
	return current;
}

/** Moves the seller's subscription to another plan or billing period. */
export async function changePlan(customerId: string, { period, plan }: CheckoutOptions) {
	const current = await requireActiveSubscription(customerId);
	if (current.plan === plan && current.chargePeriod === period && !current.cancelAtPeriodEnd) {
		throw new HttpError(409, "You're already on that plan.", "SAME_PLAN");
	}
	await kelviqRequest("POST", `/subscriptions/${encodeURIComponent(current.subscriptionId)}/update/`, {
		chargePeriod: period,
		planIdentifier: kelviqPlanIds()[plan],
	});
	return syncSubscription(customerId);
}

const CANCEL_REASONS = ["TOO_EXPENSIVE", "MISSING_FEATURES", "SWITCHED_SERVICE", "UNUSED", "CUSTOMER_SERVICE", "LOW_QUALITY", "TOO_COMPLEX", "OTHER"] as const;
export type CancelReason = (typeof CANCEL_REASONS)[number];
export const CANCEL_REASON_KEYS = CANCEL_REASONS;

/** Cancels at the end of the paid period (or trial); the store stays open until then. */
export async function cancelSubscription(customerId: string, feedback?: { comment?: string; reason?: CancelReason }) {
	const current = await requireActiveSubscription(customerId);
	if (current.cancelAtPeriodEnd) throw new HttpError(409, "Your plan is already set to end.", "ALREADY_CANCELLING");
	await kelviqRequest("POST", `/subscriptions/${encodeURIComponent(current.subscriptionId)}/cancel/`, {
		cancellationType: "CURRENT_PERIOD_ENDS",
		...(feedback?.reason ? { cancellationFeedback: feedback.reason } : {}),
		...(feedback?.comment ? { cancellationComment: feedback.comment.slice(0, 500) } : {}),
	});
	return syncSubscription(customerId);
}

/** A signed link to Kelviq's customer portal (cards, invoices, plan). */
export async function createPortalUrl(customerId: string) {
	await ensureCustomer(customerId);
	const { data } = await kelviqRequest<{ customerPortalUrl?: string; token?: string }>("POST", "/portal/session/", { customerId });
	if (!data?.customerPortalUrl || !data.token) throw new HttpError(502, "Our payment partner didn't return a billing link.", "PAYMENTS_ERROR");
	const url = new URL(data.customerPortalUrl);
	url.searchParams.set("token", data.token);
	return url.toString();
}

/* ------------------------------------------------------------------------
 * Live prices (optional): KELVIQ_PRODUCT_ID turns on Kelviq's offering, so
 * the billing screen shows the real amounts and a yearly option when the
 * plans have one. Cached briefly; failures fall back to lib/billing/plans.
 * --------------------------------------------------------------------- */

export type PlanPrices = Partial<Record<PlanKey, Partial<Record<BillingPeriod, number>>>>;
export type Offering = { currencyCode: string; currencySymbol: string; prices: PlanPrices } | null;

type OfferingResponse = {
	currencyCode?: string;
	currencySymbol?: string;
	plans?: { identifier?: string; price?: { charges?: { chargePeriod?: string; priceData?: { amount?: number | string } }[] } | null }[];
};

let offeringCache: { expires: number; value: Promise<Offering> } | null = null;

async function loadOffering(): Promise<Offering> {
	const productId = env("KELVIQ_PRODUCT_ID");
	if (!productId || !billingConfigured()) return null;
	try {
		const { data } = await kelviqRequest<OfferingResponse>("GET", `/monetization/product-offering/${encodeURIComponent(productId)}/`);
		const prices: PlanPrices = {};
		for (const item of data?.plans ?? []) {
			const plan = planForIdentifier(item.identifier);
			if (!plan) continue;
			for (const charge of item.price?.charges ?? []) {
				const amount = Number(charge.priceData?.amount);
				if (isBillingPeriod(charge.chargePeriod) && Number.isFinite(amount)) {
					(prices[plan] ??= {})[charge.chargePeriod] = amount;
				}
			}
		}
		return { currencyCode: data?.currencyCode ?? "USD", currencySymbol: data?.currencySymbol ?? "$", prices };
	} catch {
		return null;
	}
}

export function getOffering(): Promise<Offering> {
	if (!offeringCache || offeringCache.expires < Date.now()) {
		const value = loadOffering();
		offeringCache = { expires: Date.now() + 10 * 60 * 1000, value };
		// Don't keep a failure for ten minutes.
		void value.then((result) => {
			if (!result && offeringCache?.value === value) offeringCache = null;
		});
	}
	return offeringCache.value;
}

/* ------------------------------------------------------------------------
 * Webhooks: HMAC-SHA256 (hex) over "id.timestamp.body" with the signing
 * secret as given (kq_whsec_...), in webhook-signature as "v1,<hex>".
 * --------------------------------------------------------------------- */

const SIGNATURE_TOLERANCE_SECONDS = 5 * 60;

export function verifyKelviqSignature(headers: Headers, body: string, now = Date.now()) {
	const secret = env("KELVIQ_WEBHOOK_SECRET");
	if (!secret) return false;
	const id = headers.get("webhook-id");
	const timestamp = headers.get("webhook-timestamp");
	const signatures = headers.get("webhook-signature");
	if (!id || !timestamp || !signatures || !/^\d+$/.test(timestamp)) return false;
	if (Math.abs(now / 1000 - Number(timestamp)) > SIGNATURE_TOLERANCE_SECONDS) return false;

	const expected = Buffer.from(createHmac("sha256", secret).update(`${id}.${timestamp}.${body}`, "utf8").digest("hex"), "hex");
	return signatures.split(" ").some((entry) => {
		const [version, signature] = entry.split(",");
		if (version !== "v1" || !signature || !/^[0-9a-f]+$/i.test(signature)) return false;
		const given = Buffer.from(signature, "hex");
		return given.length === expected.length && timingSafeEqual(given, expected);
	});
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The seller a webhook event is about, when it is one of ours. */
export function webhookCustomerId(event: { data?: { object?: Record<string, unknown> | null } | null }) {
	const object = event.data?.object ?? {};
	const customer = object.customer as Record<string, unknown> | string | undefined;
	const metadata = object.metadata as Record<string, unknown> | undefined;
	const candidates = [
		typeof customer === "object" && customer ? customer.customer_id ?? customer.customerId : undefined,
		object.customer_id,
		object.customerId,
		metadata?.customer_id,
	];
	const found = candidates.find((value) => typeof value === "string" && UUID.test(value));
	return typeof found === "string" ? found.toLowerCase() : null;
}

/** Records a delivery id; false when it was already handled. */
export async function claimWebhookEvent(id: string, type: string) {
	const result = await dbQuery(
		`INSERT INTO billing_webhook_events (id, type) VALUES ($1, $2) ON CONFLICT (id) DO NOTHING`,
		[id, type],
	);
	return Boolean(result.rowCount);
}

export async function releaseWebhookEvent(id: string) {
	await dbQuery(`DELETE FROM billing_webhook_events WHERE id = $1`, [id]);
}

/** Only customers we know: a stray or foreign customer id is ignored. */
export async function isKnownCustomer(customerId: string) {
	const result = await dbQuery(`SELECT 1 FROM customers WHERE id = $1`, [customerId]);
	return Boolean(result.rowCount);
}
