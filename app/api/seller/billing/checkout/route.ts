import { NextRequest } from "next/server";
import { z } from "zod";
import { createCheckout } from "@/lib/backend/billing";
import { requireCustomer } from "@/lib/backend/customer-auth";
import { handleApiError, json, parseJson } from "@/lib/backend/http";
import { assertSameOrigin } from "@/lib/backend/request-guard";
import { BILLING_PERIODS, PLAN_KEYS, type BillingPeriod, type PlanKey } from "@/lib/billing/plans";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const body = z.object({
	period: z.enum(BILLING_PERIODS as [BillingPeriod, ...BillingPeriod[]]).default("MONTHLY"),
	plan: z.enum(PLAN_KEYS as [PlanKey, ...PlanKey[]]),
});

// Starts a Kelviq checkout (free trial first) for the signed-in seller.
export async function POST(request: NextRequest) {
	try {
		assertSameOrigin(request);
		const session = await requireCustomer(request);
		const options = await parseJson(request, body);
		return json({ data: { url: await createCheckout(session.sub, options) } });
	} catch (error) {
		return handleApiError(error);
	}
}
