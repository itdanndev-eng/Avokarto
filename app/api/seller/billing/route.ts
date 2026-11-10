import { NextRequest } from "next/server";
import { billingConfigured, getOffering, getSubscription, syncSubscription, syncStoreBilling } from "@/lib/backend/billing";
import { requireCustomer } from "@/lib/backend/customer-auth";
import { dbQuery } from "@/lib/backend/db";
import { handleApiError, json } from "@/lib/backend/http";
import { getResellerSettings } from "@/lib/backend/resellers";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// Reconcile with Kelviq at most this often on a normal visit, so a missed
// webhook heals itself without every page view calling the API.
const RESYNC_AFTER_MS = 15 * 60 * 1000;

// The seller's plan, live prices and what the billing screen needs.
// ?sync=1 (after checkout, or "Refresh") reads the plan straight from Kelviq.
export async function GET(request: NextRequest) {
	try {
		const session = await requireCustomer(request);
		const [settings, stored, listings, offering] = await Promise.all([
			getResellerSettings(),
			getSubscription(session.sub),
			dbQuery<{ total: number }>(
				`SELECT count(*)::int AS total FROM reseller_listings l JOIN reseller_stores s ON s.id = l.store_id WHERE s.customer_id = $1`,
				[session.sub],
			),
			getOffering(),
		]);

		let subscription = stored;
		const stale = !stored?.syncedAt || Date.now() - new Date(stored.syncedAt).getTime() > RESYNC_AFTER_MS;
		const wantsSync = request.nextUrl.searchParams.get("sync") === "1" || (stored !== null && stale);
		if (billingConfigured() && wantsSync) {
			try {
				subscription = await syncSubscription(session.sub);
				await syncStoreBilling(session.sub, settings.subscriptionsRequired);
			} catch (error) {
				console.error("Kelviq sync failed", error);
			}
		}

		return json({
			data: {
				configured: billingConfigured(),
				listings: listings.rows[0]?.total ?? 0,
				offering,
				required: settings.subscriptionsRequired,
				subscription,
			},
		});
	} catch (error) {
		return handleApiError(error);
	}
}
