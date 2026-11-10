"use client";

import type { BillingPeriod } from "@/lib/billing/plans";
import { YEARLY_SAVING } from "@/lib/billing/plans";
import styles from "./period-switch.module.css";

/**
 * Monthly / Yearly segmented switch, shared by the pricing page, the landing
 * page, onboarding and Plan & billing. A radio group: arrow keys move
 * between the two options, and the selected one carries the saving badge.
 */
export default function PeriodSwitch({
	className,
	onChange,
	saving = YEARLY_SAVING,
	tone = "light",
	value,
}: {
	className?: string;
	onChange: (period: BillingPeriod) => void;
	saving?: number;
	tone?: "dark" | "light";
	value: BillingPeriod;
}) {
	const options: { label: string; value: BillingPeriod }[] = [
		{ label: "Monthly", value: "MONTHLY" },
		{ label: "Yearly", value: "YEARLY" },
	];
	return (
		<div
			aria-label="Billing period"
			className={`${styles.switch} ${className ?? ""}`}
			data-tone={tone}
			onKeyDown={(event) => {
				if (["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(event.key)) {
					event.preventDefault();
					const next = value === "MONTHLY" ? "YEARLY" : "MONTHLY";
					onChange(next);
					(event.currentTarget.querySelector(`[data-value="${next}"]`) as HTMLButtonElement | null)?.focus();
				}
			}}
			role="radiogroup"
		>
			{options.map((option) => (
				<button
					aria-checked={value === option.value}
					className={styles.option}
					data-value={option.value}
					key={option.value}
					onClick={() => onChange(option.value)}
					role="radio"
					tabIndex={value === option.value ? 0 : -1}
					type="button"
				>
					{option.label}
					{option.value === "YEARLY" && saving > 0 ? <span className={styles.save}>Save {saving}%</span> : null}
				</button>
			))}
		</div>
	);
}
