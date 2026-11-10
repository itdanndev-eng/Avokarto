import type { Metadata } from "next";
import StartStore from "@/components/seller/StartStore";
import { getSellLandingData } from "@/lib/backend/sell-landing";
import { periodFromParam } from "@/lib/billing/plans";

// Real products for the earnings examples (the homepage's cached data).
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Open your store",
  description: "Name your store, pick a theme and choose your plan. Build your branded Avokarto store and start with a 7-day free trial.",
  robots: { follow: false, index: false },
};

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> };

export default async function StartPage({ searchParams }: Props) {
  const [data, query] = await Promise.all([getSellLandingData(), searchParams]);
  // ?period=yearly from the pricing pages preselects yearly billing.
  const period = periodFromParam(Array.isArray(query.period) ? query.period[0] : query.period);
  // Settings too: signed-out visitors design their store before registering.
  return <StartStore examples={data.products.slice(0, 3)} initialPeriod={period} publicSettings={data.settings} />;
}
