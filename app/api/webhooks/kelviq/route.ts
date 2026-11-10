import { NextRequest } from "next/server";
import {
	claimWebhookEvent,
	isKnownCustomer,
	releaseWebhookEvent,
	syncStoreBilling,
	syncSubscription,
	verifyKelviqSignature,
	webhookCustomerId,
} from "@/lib/backend/billing";
import { json } from "@/lib/backend/http";
import { getResellerSettings } from "@/lib/backend/resellers";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// Events that can change what a seller is paying for or whether they can.
const RELEVANT = /^(subscription\.|checkout\.completed$|invoice\.(paid|payment_failed)$)/;

/**
 * Kelviq webhooks. The event only says whose billing changed; the seller's
 * plan is then read back from Kelviq's API (syncSubscription), so a late
 * or out-of-order delivery can never roll a plan back. Kelviq retries
 * timeouts and 5xx replies, so a failure releases the delivery id and
 * answers 500 to get it again.
 */
export async function POST(request: NextRequest) {
	const body = await request.text();
	if (!verifyKelviqSignature(request.headers, body)) {
		return json({ error: { code: "BAD_SIGNATURE", message: "Invalid signature." } }, { status: 401 });
	}

	let event: { data?: { object?: Record<string, unknown> | null } | null; id?: string; type?: string };
	try {
		event = JSON.parse(body);
	} catch {
		return json({ error: { code: "BAD_PAYLOAD", message: "Invalid JSON." } }, { status: 400 });
	}
	const type = typeof event.type === "string" ? event.type : "unknown";
	const customerId = webhookCustomerId(event);
	if (!RELEVANT.test(type) || !customerId) return json({ received: true });

	const deliveryId = request.headers.get("webhook-id") || event.id || "";
	if (!(await claimWebhookEvent(deliveryId, type))) return json({ duplicate: true, received: true });

	try {
		if (await isKnownCustomer(customerId)) {
			await syncSubscription(customerId);
			await syncStoreBilling(customerId, (await getResellerSettings()).subscriptionsRequired);
		}
		return json({ received: true });
	} catch (error) {
		console.error("Kelviq webhook failed", type, error);
		await releaseWebhookEvent(deliveryId).catch(() => undefined);
		return json({ error: { code: "WEBHOOK_FAILED", message: "Try again." } }, { status: 500 });
	}
}
