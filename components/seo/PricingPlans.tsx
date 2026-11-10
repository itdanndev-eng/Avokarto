"use client";

import Link from "next/link";
import { useState } from "react";
import PeriodSwitch from "@/components/billing/PeriodSwitch";
import s from "@/components/seo/marketing.module.css";
import { monthlyCost, PLAN_KEYS, PLANS, TRIAL_DAYS, usd, yearlySaving, type BillingPeriod } from "@/lib/billing/plans";

/** The /pricing plan cards with a Monthly / Yearly switch. */
export default function PricingPlans() {
	const [period, setPeriod] = useState<BillingPeriod>("MONTHLY");
	const yearly = period === "YEARLY";
	return (
		<>
			<div className={s.periodRow}>
				<PeriodSwitch onChange={setPeriod} value={period} />
			</div>
			<div className={s.grid}>
				{PLAN_KEYS.map((key) => {
					const plan = PLANS[key];
					return (
						<article className={`${s.card} ${key === "pro" ? s.featured : ""}`} id={key} key={key}>
							<span className={s.tag}>{key === "pro" ? "For growing stores" : `${TRIAL_DAYS}-day free trial`}</span>
							<h2>{plan.name}</h2>
							<p>{plan.blurb}</p>
							<div className={s.price}><strong>{usd(monthlyCost(plan, period))}</strong> USD / month</div>
							<p className={s.billed}>
								{yearly ? (
									<>
										{usd(plan.yearlyPrice)} billed yearly · <del>{usd(Math.round(plan.price * 12 * 100) / 100)}</del>{" "}
										<b>Save {yearlySaving(plan)}%</b>
									</>
								) : (
									<>Billed monthly · {usd(monthlyCost(plan, "YEARLY"))}/mo if paid yearly</>
								)}
							</p>
							<ul>{plan.features.map((feature) => <li key={feature}>{feature}</li>)}</ul>
							<Link className={s.button} href={yearly ? "/start?period=yearly" : "/start"}>Try {plan.name} free</Link>
						</article>
					);
				})}
			</div>
		</>
	);
}
