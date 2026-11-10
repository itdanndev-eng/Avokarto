// Seller subscription plans. Shared by the landing page, the seller
// dashboard and the server (limits are enforced in lib/backend). Prices
// here are what the site shows until Kelviq's live prices load - the amounts
// actually charged, and the free trial, are configured on the matching
// Kelviq plans (identifiers starter / pro / scale, or KELVIQ_PLAN_*).

export const TRIAL_DAYS = 7;

export type PlanKey = "starter" | "pro" | "scale";

export type Plan = {
	blurb: string;
	customDomain: boolean;
	features: string[];
	key: PlanKey;
	/** Most products the store can resell; null = the store maximum. */
	listingLimit: number | null;
	name: string;
	/** USD per month, billed monthly. */
	price: number;
	/** USD per year, billed yearly (two months free). */
	yearlyPrice: number;
};

export const PLANS: Record<PlanKey, Plan> = {
	starter: {
		blurb: "Everything you need to launch and land your first sales.",
		customDomain: false,
		features: [
			"Your own branded store",
			"Up to 25 winning products",
			"All 8 premium store themes",
			"Ready-made reels & video studio",
			"Stocking, packing & shipping handled",
			"Payouts direct to your bank",
		],
		key: "starter",
		listingLimit: 25,
		name: "Starter",
		price: 17.99,
		yearlyPrice: 179.99,
	},
	pro: {
		blurb: "For growing brands ready to expand their catalog.",
		customDomain: true,
		features: [
			"Everything in Starter",
			"Unlimited products",
			"Connect your own domain",
			"Live analytics & sales insights",
			"Priority support",
		],
		key: "pro",
		listingLimit: null,
		name: "Pro",
		price: 27.99,
		yearlyPrice: 279.99,
	},
	// The extras here are services the team delivers, not product limits -
	// keep this list to what you can actually provide.
	scale: {
		blurb: "For full-time sellers who want hands-on growth support.",
		customDomain: true,
		features: [
			"Everything in Pro",
			"Dedicated success manager",
			"Same-day priority support",
			"Early access to new winning products",
			"Custom promo reels on request",
		],
		key: "scale",
		listingLimit: null,
		name: "Scale",
		price: 59.99,
		yearlyPrice: 599.99,
	},
};

export const PLAN_KEYS = Object.keys(PLANS) as PlanKey[];

export function isPlanKey(value: unknown): value is PlanKey {
	return typeof value === "string" && value in PLANS;
}

/** How often a plan bills. Yearly is offered only when the Kelviq plan has a yearly price. */
export type BillingPeriod = "MONTHLY" | "YEARLY";
export const BILLING_PERIODS: readonly BillingPeriod[] = ["MONTHLY", "YEARLY"];

export function isBillingPeriod(value: unknown): value is BillingPeriod {
	return value === "MONTHLY" || value === "YEARLY";
}

/** What one billing period of this plan costs. */
export function planPrice(plan: Plan, period: BillingPeriod) {
	return period === "YEARLY" ? plan.yearlyPrice : plan.price;
}

/** The plan's cost per month on this billing period (yearly spread over 12). */
export function monthlyCost(plan: Plan, period: BillingPeriod) {
	return period === "YEARLY" ? Math.round((plan.yearlyPrice / 12) * 100) / 100 : plan.price;
}

/** Percent saved by paying yearly instead of twelve monthly payments. */
export function yearlySaving(plan: Plan) {
	return Math.max(0, Math.round((1 - plan.yearlyPrice / (plan.price * 12)) * 100));
}

/** The best yearly saving across plans, for "Save up to N%". */
export const YEARLY_SAVING = Math.max(...Object.values(PLANS).map(yearlySaving));

/** "$17.99", or "$15" for whole amounts. */
export function usd(amount: number) {
	return `$${Number.isInteger(amount) ? amount : amount.toFixed(2)}`;
}

/** The period a link asked for (?period=YEARLY), else monthly. */
export function periodFromParam(value: string | null | undefined): BillingPeriod {
	return value?.toUpperCase() === "YEARLY" ? "YEARLY" : "MONTHLY";
}

/** Kelviq subscription statuses that keep a store open. past_due is the grace period after a failed renewal. */
export const ACCESS_STATUSES = ["trialing", "active", "past_due"] as const;

export function grantsAccess(status: string | null | undefined) {
	return (ACCESS_STATUSES as readonly string[]).includes(status ?? "");
}
