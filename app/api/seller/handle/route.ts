import { NextRequest } from "next/server";
import { z } from "zod";
import { getOptionalCustomer } from "@/lib/backend/customer-auth";
import { handleApiError, json, parseJson } from "@/lib/backend/http";
import { clientIp, consumeRateLimit, rateLimits } from "@/lib/backend/request-guard";
import { getStoreForCustomer, isHandleAvailable, unavailableHandles } from "@/lib/backend/resellers";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// Live "is this store link free?" check while a seller types. Open to
// signed-out visitors too - /start asks for an account only after the
// store is designed - so those are rate limited per IP.
export async function GET(request: NextRequest) {
	try {
		const session = await getOptionalCustomer(request);
		if (!session) await consumeRateLimit(rateLimits.storeHandleCheck, clientIp(request));
		const handle = request.nextUrl.searchParams.get("handle") ?? "";
		const store = session ? await getStoreForCustomer(session.sub) : null;
		return json({ data: await isHandleAvailable(handle, store?.id) });
	} catch (error) {
		return handleApiError(error);
	}
}

const batch = z.object({ handles: z.array(z.string().max(60)).max(60) });

// Which of a list of name-idea links can't be used, in one request, so the
// "Need an idea?" chips only ever offer names that are still free.
export async function POST(request: NextRequest) {
	try {
		const session = await getOptionalCustomer(request);
		if (!session) await consumeRateLimit(rateLimits.storeHandleCheck, clientIp(request));
		const { handles } = await parseJson(request, batch);
		const store = session ? await getStoreForCustomer(session.sub) : null;
		return json({ data: { unavailable: await unavailableHandles(handles, store?.id) } });
	} catch (error) {
		return handleApiError(error);
	}
}
