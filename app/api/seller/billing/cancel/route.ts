import { NextRequest } from "next/server";
import { z } from "zod";
import { CANCEL_REASON_KEYS, cancelSubscription, type CancelReason } from "@/lib/backend/billing";
import { requireCustomer } from "@/lib/backend/customer-auth";
import { handleApiError, json, parseJson } from "@/lib/backend/http";
import { assertSameOrigin } from "@/lib/backend/request-guard";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const body = z.object({
	comment: z.string().trim().max(500).optional(),
	reason: z.enum(CANCEL_REASON_KEYS as unknown as [CancelReason, ...CancelReason[]]).optional(),
});

// Cancels at the end of the paid period; the store stays online until then.
export async function POST(request: NextRequest) {
	try {
		assertSameOrigin(request);
		const session = await requireCustomer(request);
		const subscription = await cancelSubscription(session.sub, await parseJson(request, body));
		return json({ data: { subscription } });
	} catch (error) {
		return handleApiError(error);
	}
}
