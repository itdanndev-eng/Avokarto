import { NextRequest } from "next/server";
import { createPortalUrl } from "@/lib/backend/billing";
import { requireCustomer } from "@/lib/backend/customer-auth";
import { handleApiError, json } from "@/lib/backend/http";
import { assertSameOrigin } from "@/lib/backend/request-guard";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// A short-lived, signed link to Kelviq's billing portal (cards, invoices).
export async function POST(request: NextRequest) {
	try {
		assertSameOrigin(request);
		const session = await requireCustomer(request);
		return json({ data: { url: await createPortalUrl(session.sub) } });
	} catch (error) {
		return handleApiError(error);
	}
}
