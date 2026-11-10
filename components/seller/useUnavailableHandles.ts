"use client";

import { useEffect, useState } from "react";
import { suggestHandle } from "@/lib/resellerPricing";

type Result = { key: string; unavailable: Set<string> | null };

/**
 * Which of these store names can't be used because their link is taken or
 * reserved, checked in one request per list. `ready` is false while the
 * answer for this list is pending; if the check fails, nothing is filtered
 * (opening the store re-checks the link anyway).
 */
export function useUnavailableHandles(names: readonly string[]) {
	const handles = [...new Set(names.map(suggestHandle).filter(Boolean))];
	const key = handles.join(",");
	const [result, setResult] = useState<Result | null>(null);

	useEffect(() => {
		if (!key) return;
		const controller = new AbortController();
		const timeout = window.setTimeout(() => controller.abort(), 6000);
		fetch("/api/seller/handle", {
			body: JSON.stringify({ handles: key.split(",") }),
			credentials: "same-origin",
			headers: { "Content-Type": "application/json" },
			method: "POST",
			signal: controller.signal,
		})
			.then((response) => (response.ok ? response.json() : Promise.reject(new Error("check failed"))))
			.then((payload: { data?: { unavailable?: unknown } }) => {
				const list = Array.isArray(payload?.data?.unavailable) ? payload.data.unavailable.filter((item): item is string => typeof item === "string") : [];
				setResult({ key, unavailable: new Set(list) });
			})
			// Results are keyed to their list, so a cancelled request can't
			// affect another list; a failed check filters nothing.
			.catch(() => setResult({ key, unavailable: new Set() }))
			.finally(() => window.clearTimeout(timeout));
		return () => {
			window.clearTimeout(timeout);
			controller.abort();
		};
	}, [key]);

	const answer = result?.key === key ? result.unavailable : null;
	return {
		isUnavailable: (name: string) => Boolean(answer?.has(suggestHandle(name))),
		ready: !key || answer !== null,
	};
}
