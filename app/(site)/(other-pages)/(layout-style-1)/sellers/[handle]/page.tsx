import type { Metadata } from "next";
import { cookies } from "next/headers";
import { notFound } from "next/navigation";
import SellerProfile from "@/components/sellers/SellerProfile";
import { customerSessionCookie, verifyCustomerSessionToken } from "@/lib/backend/customer-auth";
import { hasDatabaseConfig } from "@/lib/backend/db";
import { getSellerProfile } from "@/lib/backend/seller-profiles";
import { pageMetadata } from "@/lib/seo";

export const dynamic = "force-dynamic";

type Props = { params: Promise<{ handle: string }> };

/** The signed-in shopper's id, or null - only used to show "Following". */
async function viewerId() {
  try {
    const session = await verifyCustomerSessionToken((await cookies()).get(customerSessionCookie)?.value);
    return session.sub;
  } catch {
    return null;
  }
}

async function loadProfile(handle: string) {
  if (!hasDatabaseConfig()) return null;
  return getSellerProfile(handle, await viewerId());
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { handle } = await params;
  const profile = await loadProfile(handle).catch(() => null);
  if (!profile) return pageMetadata({ title: "Seller not found", description: "This seller isn't available.", noindex: true });
  const description = profile.tagline || `${profile.name} on Avokarto - ${profile.products} products, ${profile.followers} followers.`;
  const image = { alt: profile.name, height: 630, url: `/api/stores/share-image?handle=${encodeURIComponent(profile.handle)}`, width: 1200 };
  return {
    ...pageMetadata({ title: `${profile.name} (@${profile.handle})`, description, path: `/sellers/${encodeURIComponent(profile.handle)}` }),
    openGraph: { description, images: [image], title: `${profile.name} on Avokarto`, type: "profile" },
    twitter: { card: "summary_large_image", description, images: [image.url], title: `${profile.name} on Avokarto` },
  };
}

export default async function SellerProfilePage({ params }: Props) {
  const { handle } = await params;
  const viewer = await viewerId();
  const profile = hasDatabaseConfig() ? await getSellerProfile(handle, viewer) : null;
  if (!profile) notFound();
  return <SellerProfile profile={profile} signedIn={Boolean(viewer)} />;
}
