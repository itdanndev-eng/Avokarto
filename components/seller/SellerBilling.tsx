"use client";

import { ArrowDown, ArrowUp, Check, CreditCard, ExternalLink, Loader2, Lock, RefreshCw, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useLiveResource } from "@/hooks/use-live-resource";
import PeriodSwitch from "@/components/billing/PeriodSwitch";
import { grantsAccess, periodFromParam, planPrice, PLAN_KEYS, PLANS, TRIAL_DAYS, type BillingPeriod, type PlanKey } from "@/lib/billing/plans";
import { sellerRequest, SellerApiError } from "./sellerApi";
import styles from "./seller.module.css";

type Subscription = {
	cancelAtPeriodEnd: boolean;
	chargePeriod: BillingPeriod;
	currentPeriodEnd: string | null;
	plan: PlanKey;
	status: string;
};

type Billing = {
	configured: boolean;
	listings: number;
	offering: { currencyCode: string; currencySymbol: string; prices: Partial<Record<PlanKey, Partial<Record<BillingPeriod, number>>>> } | null;
	required: boolean;
	subscription: Subscription | null;
};

type Pending = { kind: "change"; period: BillingPeriod; plan: PlanKey } | { kind: "cancel" } | null;

const CANCEL_REASONS: { label: string; value: string }[] = [
	{ label: "It costs too much", value: "TOO_EXPENSIVE" },
	{ label: "Missing features I need", value: "MISSING_FEATURES" },
	{ label: "I'm not using it enough", value: "UNUSED" },
	{ label: "Switching to another service", value: "SWITCHED_SERVICE" },
	{ label: "Too complicated", value: "TOO_COMPLEX" },
	{ label: "Something else", value: "OTHER" },
];

const date = new Intl.DateTimeFormat("en-US", { day: "numeric", month: "short", year: "numeric" });
const when = (iso: string | null) => (iso ? date.format(new Date(iso)) : "");
const RANK: Record<PlanKey, number> = { starter: 0, pro: 1, scale: 2 };

function money(symbol: string, amount: number) {
	return `${symbol}${Number.isInteger(amount) ? amount : amount.toFixed(2)}`;
}

/** How the current plan reads, status by status. */
function statusLine(subscription: Subscription) {
	const end = when(subscription.currentPeriodEnd);
	if (subscription.cancelAtPeriodEnd && grantsAccess(subscription.status)) {
		return { badge: styles.badgeAmber, label: "Ending", note: end ? `Your plan ends ${end}. Your store stays online until then.` : "Your plan ends at the close of this period." };
	}
	switch (subscription.status) {
		case "trialing":
			return { badge: styles.badgeGreen, label: "Free trial", note: end ? `Trial ends ${end} - your first charge is then.` : "Your free trial is running." };
		case "active":
			return { badge: styles.badgeGreen, label: "Active", note: end ? `Renews ${end}.` : "Renews automatically." };
		case "past_due":
			return { badge: styles.badgeAmber, label: "Payment failed", note: "Update your card in Manage billing to keep your store online." };
		case "paused":
			return { badge: styles.badgeAmber, label: "Paused", note: "Your plan is paused. Resume it in Manage billing." };
		case "incomplete":
			return { badge: styles.badgeAmber, label: "Awaiting payment", note: "Finish paying in Manage billing to start your plan." };
		default:
			return { badge: styles.badgeRed, label: "Ended", note: "Your plan has ended. Pick a plan to bring your store back online." };
	}
}

export default function SellerBilling({ onToast }: { onToast: (message: string) => void }) {
	// Back from checkout: read the plan straight from Kelviq, then keep checking while the payment settles.
	const [checkoutState] = useState(() => (typeof window === "undefined" ? null : new URLSearchParams(window.location.search).get("checkout")));
	const returned = checkoutState === "done";
	const resource = useLiveResource<Billing | null>({
		endpoint: "/api/seller/billing",
		initialData: null,
		topics: ["resellers"],
	});
	const billing = resource.data;
	const { refresh } = resource;
	const [busy, setBusy] = useState<string | null>(null);
	const [gaveUp, setGaveUp] = useState(false);
	const hasAccess = grantsAccess(billing?.subscription?.status);
	const returning = returned && !hasAccess && !gaveUp;
	// ?period=yearly from the pricing pages preselects yearly.
	const [periodChoice, setPeriod] = useState<BillingPeriod | null>(() => {
		const asked = typeof window === "undefined" ? null : new URLSearchParams(window.location.search).get("period");
		return asked ? periodFromParam(asked) : null;
	});
	// Start on the period the seller already pays for.
	const period: BillingPeriod = periodChoice ?? billing?.subscription?.chargePeriod ?? "MONTHLY";
	const [pending, setPending] = useState<Pending>(null);
	const [reason, setReason] = useState("");
	const [comment, setComment] = useState("");
	const dialog = useRef<HTMLDialogElement>(null);

	useEffect(() => {
		if (checkoutState === "cancelled") onToast("Checkout cancelled - no charge was made.");
		if (checkoutState) {
			// Drop ?checkout= so a reload doesn't replay the notice.
			const url = new URL(window.location.href);
			url.searchParams.delete("checkout");
			window.history.replaceState(null, "", url);
		}
	}, [checkoutState, onToast]);

	useEffect(() => {
		if (!returning) return;
		// Ask the server to read the plan from Kelviq, then show what it stored.
		const check = () => void sellerRequest("GET", "/api/seller/billing?sync=1").catch(() => undefined).finally(() => void refresh());
		check();
		const poll = window.setInterval(check, 4000);
		const stop = window.setTimeout(() => setGaveUp(true), 45_000);
		return () => {
			window.clearInterval(poll);
			window.clearTimeout(stop);
		};
	}, [refresh, returning]);

	useEffect(() => {
		const element = dialog.current;
		if (!element) return;
		if (pending && !element.open) element.showModal();
		if (!pending && element.open) element.close();
	}, [pending]);

	async function run<T>(key: string, action: () => Promise<T>, failure: string) {
		setBusy(key);
		try {
			return await action();
		} catch (caught) {
			onToast(caught instanceof SellerApiError ? caught.message : failure);
			return null;
		} finally {
			setBusy(null);
		}
	}

	async function start(plan: PlanKey) {
		const result = await run(`start-${plan}`, () => sellerRequest<{ url: string }>("POST", "/api/seller/billing/checkout", { period, plan }), "Couldn't open checkout. Please try again.");
		if (result) {
			setBusy(`start-${plan}`);
			window.location.assign(result.url);
		}
	}

	async function openPortal() {
		// Open the tab first so pop-up blockers allow it, then point it at the signed link.
		const tab = window.open("", "_blank");
		const result = await run("portal", () => sellerRequest<{ url: string }>("POST", "/api/seller/billing/portal"), "Couldn't open billing. Please try again.");
		if (result && tab) tab.location.href = result.url;
		else if (result) window.location.assign(result.url);
		else tab?.close();
	}

	async function confirm() {
		if (!pending) return;
		if (pending.kind === "change") {
			const done = await run("confirm", () => sellerRequest("POST", "/api/seller/billing/change", { period: pending.period, plan: pending.plan }), "Couldn't change your plan. Please try again.");
			if (done) onToast(`You're now on ${PLANS[pending.plan].name}${pending.period === "YEARLY" ? " (yearly)" : ""}.`);
		} else {
			const done = await run("confirm", () => sellerRequest("POST", "/api/seller/billing/cancel", { ...(reason ? { reason } : {}), ...(comment.trim() ? { comment: comment.trim() } : {}) }), "Couldn't cancel your plan. Please try again.");
			if (done) onToast("Your plan will end at the close of this period.");
		}
		setPending(null);
		setReason("");
		setComment("");
		await refresh();
	}

	async function resync() {
		await run("sync", async () => {
			await sellerRequest("GET", "/api/seller/billing?sync=1");
			await refresh();
		}, "Couldn't refresh your plan.");
	}

	if (resource.error && !billing) {
		return (
			<div className={styles.alert} role="alert">
				{resource.error} <button className={`${styles.ghost} ${styles.btnSm}`} onClick={() => void refresh()} type="button">Try again</button>
			</div>
		);
	}
	if (!billing) {
		return <div className={styles.card}><p className={styles.muted}><Loader2 className={styles.spin} size={16} /> Loading your plan…</p></div>;
	}

	const { subscription } = billing;
	const symbol = billing.offering?.currencySymbol ?? "$";
	// Kelviq's live prices when they loaded (only periods Kelviq can charge),
	// else the list prices in lib/billing/plans.
	const priceOf = (plan: PlanKey, chosen: BillingPeriod) =>
		billing.offering ? billing.offering.prices[plan]?.[chosen] ?? null : planPrice(PLANS[plan], chosen);
	const yearlyOffered = PLAN_KEYS.some((key) => priceOf(key, "YEARLY") !== null);
	const shownPeriod: BillingPeriod = yearlyOffered ? period : "MONTHLY";
	const bestSaving = Math.max(0, ...PLAN_KEYS.map((key) => {
		const monthly = priceOf(key, "MONTHLY");
		const yearly = priceOf(key, "YEARLY");
		return monthly && yearly ? Math.round((1 - yearly / (monthly * 12)) * 100) : 0;
	}));
	const current = subscription && hasAccess ? PLANS[subscription.plan] : null;
	const currentPrice = subscription && current ? priceOf(subscription.plan, subscription.chargePeriod) : null;
	const status = subscription ? statusLine(subscription) : null;
	const limit = current?.listingLimit ?? null;
	const ending = Boolean(subscription?.cancelAtPeriodEnd && hasAccess);

	return (
		<div className={styles.stack}>
			{returning ? (
				<p className={styles.success} role="status"><Loader2 className={styles.spin} size={15} /> Confirming your plan - this takes a few seconds.</p>
			) : null}
			{returned && gaveUp && !hasAccess ? (
				<p className={styles.notice} role="status">
					Your payment is still being confirmed. <button className={`${styles.ghost} ${styles.btnSm}`} disabled={busy === "sync"} onClick={() => void resync()} type="button">Check again</button>
				</p>
			) : null}
			{returned && hasAccess ? <p className={styles.success} role="status"><Check size={15} /> Your plan is active - welcome aboard!</p> : null}
			{billing.required && !hasAccess && !returning ? (
				<p className={styles.notice} role="alert">
					<strong>Your store is offline.</strong> {subscription ? "Pick a plan to bring it back online." : `Start your ${TRIAL_DAYS}-day free trial to put it live - cancel any time before it ends and you won't be charged.`}
				</p>
			) : null}

			{/* Current plan */}
			<section className={`${styles.card} ${styles.billCurrent}`}>
				<div className={styles.cardHead}>
					<div>
						<p className={styles.billEyebrow}>Current plan</p>
						<h2 className={styles.cardTitle}>
							{current
								? `${current.name}${currentPrice !== null ? ` - ${money(symbol, currentPrice)}/${subscription?.chargePeriod === "YEARLY" ? "yr" : "mo"}` : ""}`
								: billing.required ? "No plan yet" : "Early access - free for now"}
						</h2>
					</div>
					{status ? <span className={status.badge}>{status.label}</span> : null}
				</div>
				<p className={styles.muted}>
					{status?.note ?? (billing.required
						? `Every plan starts with a ${TRIAL_DAYS}-day free trial.`
						: "Your store has full access. Subscribe any time to lock in a plan.")}
				</p>
				{current ? (
					<div className={styles.billUsage}>
						<div className={styles.row}>
							<span className={styles.muted}>Products in your store</span>
							<strong>{billing.listings}{limit !== null ? ` / ${limit}` : ""}</strong>
						</div>
						{limit !== null ? (
							<div aria-hidden="true" className={styles.billMeter}>
								<span style={{ width: `${Math.min(100, (billing.listings / limit) * 100)}%` }} />
							</div>
						) : null}
					</div>
				) : null}
				{subscription && billing.configured ? (
					<div className={styles.billActions}>
						<button className={`${styles.ghost} ${styles.btnSm}`} disabled={busy !== null} onClick={() => void openPortal()} type="button">
							{busy === "portal" ? <Loader2 className={styles.spin} size={15} /> : <CreditCard size={15} />} Manage billing <ExternalLink size={13} />
						</button>
						<button aria-label="Refresh plan status" className={`${styles.ghost} ${styles.btnSm}`} disabled={busy !== null} onClick={() => void resync()} type="button">
							<RefreshCw className={busy === "sync" ? styles.spin : undefined} size={15} /> Refresh
						</button>
						{hasAccess && !ending ? (
							<button className={`${styles.danger} ${styles.btnSm} ${styles.billCancel}`} disabled={busy !== null} onClick={() => setPending({ kind: "cancel" })} type="button">
								Cancel plan
							</button>
						) : null}
					</div>
				) : null}
				{ending ? <p className={styles.hint}>Changed your mind? Keep your plan from Manage billing before {when(subscription?.currentPeriodEnd ?? null) || "it ends"}.</p> : null}
			</section>

			{/* Period switch */}
			{yearlyOffered ? <PeriodSwitch onChange={setPeriod} saving={bestSaving} value={shownPeriod} /> : null}

			{/* Plans */}
			<div className={styles.billPlans}>
				{PLAN_KEYS.map((key) => {
					const plan = PLANS[key];
					const price = priceOf(key, shownPeriod);
					const monthly = priceOf(key, "MONTHLY");
					const isCurrent = Boolean(current && subscription?.plan === key && subscription.chargePeriod === shownPeriod);
					const upgrade = current ? RANK[key] > RANK[current.key] : false;
					return (
						<section className={styles.billPlan} data-current={isCurrent || undefined} data-featured={key === "pro" || undefined} key={key}>
							{key === "pro" ? <span className={styles.billTag}>Most popular</span> : null}
							<h3 className={styles.billPlanName}>{plan.name}</h3>
							{price !== null ? (
								<p className={styles.billPrice}>
									<strong>{money(symbol, shownPeriod === "YEARLY" ? Math.round((price / 12) * 100) / 100 : price)}</strong> /month
									{shownPeriod === "YEARLY" ? <span className={styles.billBilled}>{money(symbol, price)} billed yearly{monthly ? ` · was ${money(symbol, monthly * 12)}` : ""}</span> : null}
								</p>
							) : (
								<p className={styles.billPrice}>Monthly only</p>
							)}
							<p className={styles.muted}>{plan.blurb}</p>
							<ul className={styles.billFeatures}>
								{plan.features.map((feature) => <li key={feature}><Check size={15} /> {feature}</li>)}
							</ul>
							{isCurrent ? (
								<span className={`${styles.badgeGreen} ${styles.billCurrentTag}`}><Check size={13} /> Your plan</span>
							) : price === null ? (
								<button className={`${styles.ghost} ${styles.btnBlock}`} disabled type="button">Not available yearly</button>
							) : hasAccess ? (
								<button
									className={`${upgrade ? styles.btn : styles.ghost} ${styles.btnBlock}`}
									disabled={busy !== null || ending}
									onClick={() => setPending({ kind: "change", period: shownPeriod, plan: key })}
									title={ending ? "Keep your plan in Manage billing to switch" : undefined}
									type="button"
								>
									{current?.key === key ? `Switch to ${shownPeriod === "YEARLY" ? "yearly" : "monthly"}` : upgrade ? <><ArrowUp size={15} /> Upgrade to {plan.name}</> : <><ArrowDown size={15} /> Switch to {plan.name}</>}
								</button>
							) : (
								<button
									className={`${styles.btn} ${styles.btnBlock}`}
									disabled={!billing.configured || busy !== null}
									onClick={() => void start(key)}
									type="button"
								>
									{busy === `start-${key}` ? <Loader2 className={styles.spin} size={16} /> : null}
									{!billing.configured ? "Opening soon" : subscription ? `Choose ${plan.name}` : `Start ${TRIAL_DAYS}-day free trial`}
								</button>
							)}
						</section>
					);
				})}
			</div>
			<p className={`${styles.muted} ${styles.billSecure}`}>
				<Lock size={13} /> Secure checkout and billing by Kelviq. Taxes calculated at checkout. Cancel any time.
			</p>

			{/* Confirm a plan change or cancellation */}
			<dialog aria-labelledby="bill-dialog-title" className={styles.billDialog} onClose={() => setPending(null)} ref={dialog}>
				{pending ? (
					<form method="dialog" onSubmit={(event) => { event.preventDefault(); void confirm(); }}>
						<div className={styles.billDialogHead}>
							<h2 className={styles.cardTitle} id="bill-dialog-title">
								{pending.kind === "cancel" ? "Cancel your plan?" : `Switch to ${PLANS[pending.plan].name}${pending.period === "YEARLY" ? " yearly" : ""}?`}
							</h2>
							<button aria-label="Close" className={`${styles.ghost} ${styles.btnSm}`} onClick={() => setPending(null)} type="button"><X size={16} /></button>
						</div>
						{pending.kind === "cancel" ? (
							<>
								<p className={styles.muted}>
									Your plan stays active until {when(subscription?.currentPeriodEnd ?? null) || "the end of this period"}.{billing.required ? " After that your store goes offline and" : " After that"} you won&apos;t be charged again.
								</p>
								<label className={styles.field}>
									<span className={styles.label}>Why are you leaving? (optional)</span>
									<select className={styles.input} onChange={(event) => setReason(event.target.value)} value={reason}>
										<option value="">Choose a reason</option>
										{CANCEL_REASONS.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
									</select>
								</label>
								<label className={styles.field}>
									<span className={styles.label}>Anything we could do better? (optional)</span>
									<textarea className={`${styles.input} ${styles.billTextarea}`} maxLength={500} onChange={(event) => setComment(event.target.value)} rows={3} value={comment} />
								</label>
							</>
						) : (
							<p className={styles.muted}>
								{priceOf(pending.plan, pending.period) !== null ? `${money(symbol, priceOf(pending.plan, pending.period) ?? 0)}/${pending.period === "YEARLY" ? "year" : "month"}. ` : ""}
								{current && RANK[pending.plan] > RANK[current.key]
									? "Your new limits apply right away. The price difference for the rest of this period is charged or added to your next invoice."
									: "The change applies right away and any unused time is credited to your next invoice."}
								{subscription?.status === "trialing" ? " Your free trial continues." : ""}
							</p>
						)}
						<div className={styles.billDialogActions}>
							<button className={`${styles.ghost} ${styles.btnSm}`} onClick={() => setPending(null)} type="button">
								{pending.kind === "cancel" ? "Keep my plan" : "Not now"}
							</button>
							<button className={`${pending.kind === "cancel" ? styles.danger : styles.btn} ${styles.btnSm}`} disabled={busy === "confirm"} type="submit">
								{busy === "confirm" ? <Loader2 className={styles.spin} size={15} /> : null}
								{pending.kind === "cancel" ? "Cancel plan" : "Confirm switch"}
							</button>
						</div>
					</form>
				) : null}
			</dialog>
		</div>
	);
}
