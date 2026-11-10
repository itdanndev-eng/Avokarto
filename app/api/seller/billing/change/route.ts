import { NextRequest } from "next/server";
import { z } from "zod";
import { changePlan, syncStoreBilling } from "@/lib/backend/billing";
import { requireCustomer } from "@/lib/backend/customer-auth";
import { handleApiError, json, parseJson } from "@/lib/backend/http";
import { assertSameOrigin } from "@/lib/backend/request-guard";
import { getResellerSettings } from "@/lib/backend/resellers";
import { BILLING_PERIODS, PLAN_KEYS, type BillingPeriod, type PlanKey } from "@/lib/billing/plans";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const body = z.object({
	period: z.enum(BILLING_PERIODS as [BillingPeriod, ...BillingPeriod[]]),
	plan: z.enum(PLAN_KEYS as [PlanKey, ...PlanKey[]]),
});

// Upgrades, downgrades or switches the billing period of the seller's plan.
export async function POST(request: NextRequest) {
	try {
		assertSameOrigin(request);
		const session = await requireCustomer(request);
		const subscription = await changePlan(session.sub, await parseJson(request, body));
		await syncStoreBilling(session.sub, (await getResellerSettings()).subscriptionsRequired);
		return json({ data: { subscription } });
	} catch (error) {
		return handleApiError(error);
	}
}
