"use client";

import {
	BarChart3,
	ChevronRight,
	Clapperboard,
	ClipboardList,
	Copy,
	CreditCard,
	ExternalLink,
	House,
	Menu,
	Palette,
	PackagePlus,
	PanelLeftClose,
	PanelLeftOpen,
	Plus,
	Search,
	Settings,
	Store,
	Tag,
	UserRound,
	Wallet,
	X,
} from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Fragment, useCallback, useEffect, useState } from "react";
import ModalTriggerButton from "@/components/action-buttons/ModalTriggerButton";
import { useLiveResource } from "@/hooks/use-live-resource";
import { useCustomerSession } from "@/hooks/use-customer-session";
import { TRIAL_DAYS } from "@/lib/billing/plans";
import CommandPalette, { type Command } from "./CommandPalette";
import SellerBilling from "./SellerBilling";
import SellerCatalog from "./SellerCatalog";
import SellerInsights from "./SellerInsights";
import SellerListings from "./SellerListings";
import SellerOrders from "./SellerOrders";
import SellerPayouts from "./SellerPayouts";
import SellerVideos from "./SellerVideos";
import StudioHome from "./StudioHome";
import SellerSettingsPanel from "./SellerSettings";
import { initialsOf } from "./StoreForm";
import { readableOn } from "@/components/stores/storeTheme";
import {
	storeUrl,
	type SellerSettings,
	type SellerStore,
} from "./sellerApi";
import styles from "./seller.module.css";

export type Overview = {
	customDomain: { domain: string; status: "active" | "failed" | "pending" } | null;
	balances: { available: number; lifetime: number; paid: number; pending: number; requested: number; withdrawable: number };
	daily: { date: string; earned: number; orders: number }[];
	last30Days: { orders: number; sales: number; units: number };
	listings: { active: number; total: number };
	settings: SellerSettings;
	store: SellerStore;
};

// Named like Shopify admin. `short` is the phone tab bar label.
const TABS = [
	{ icon: House, key: "overview", label: "Home", short: "Home", title: "Home" },
	{ icon: ClipboardList, key: "orders", label: "Orders", short: "Orders", title: "Orders" },
	{ icon: Tag, key: "products", label: "Products", short: "Products", title: "Products" },
	{ icon: PackagePlus, key: "catalog", label: "Add products", short: "Add", sub: true, title: "Add products" },
	{ icon: Clapperboard, key: "videos", label: "Videos", short: "Videos", title: "Video studio" },
	{ icon: BarChart3, key: "insights", label: "Analytics", short: "Analytics", title: "Analytics" },
	{ icon: Wallet, key: "payouts", label: "Earnings", short: "Earnings", title: "Earnings & payouts" },
	{ icon: CreditCard, key: "billing", label: "Plan & billing", short: "Plan", title: "Plan & billing" },
	{ icon: Settings, key: "settings", label: "Settings", short: "Settings", title: "Settings" },
] as const;
type TabKey = (typeof TABS)[number]["key"];
const MAIN_TABS = TABS.filter((tab) => tab.key !== "settings");
// The phone tab bar: four tabs around a raised "Add products" button.
const BOTTOM_TABS = TABS.filter((tab) => ["overview", "orders", "products", "payouts"].includes(tab.key));

const SUBTITLES: Record<TabKey, string> = {
	catalog: "Pick from Avokarto's catalog - we stock, pack and ship.",
	insights: "Visitors, sources and what turns browsers into buyers.",
	orders: "Every order placed through your store, live.",
	overview: "Your store at a glance.",
	payouts: "What you've earned and how it gets to you.",
	billing: "Your Avokarto plan, free trial and billing.",
	products: "Prices, margins and what shows in your store.",
	videos: "Turn your products into scroll-stopping videos for Reels, TikTok and Shorts - made in your browser in seconds.",
	settings: "Domain, branding and store details.",
};

const EMPTY_OVERVIEW = null as Overview | null;

export function useToast() {
	const [toast, setToast] = useState<string | null>(null);
	useEffect(() => {
		if (!toast) return;
		const timer = window.setTimeout(() => setToast(null), 2600);
		return () => window.clearTimeout(timer);
	}, [toast]);
	const node = toast ? <div className={styles.toast} role="status">{toast}</div> : null;
	return { node, show: setToast };
}

export default function SellerDashboard() {
	const router = useRouter();
	const pathname = usePathname();
	const searchParams = useSearchParams();
	const { customer, hydrated, refresh: refreshSession } = useCustomerSession();
	const tabParam = searchParams.get("tab");
	// "reels" was this tab's old name: old links open its Ready-made view.
	const legacyReels = tabParam === "reels";
	const tab: TabKey = legacyReels ? "videos" : TABS.some((item) => item.key === tabParam) ? (tabParam as TabKey) : "overview";
	const toast = useToast();
	const [welcome, setWelcome] = useState(searchParams.get("welcome") === "1");
	const [menuOpen, setMenuOpen] = useState(false);
	const [paletteOpen, setPaletteOpen] = useState(false);
	// Desktop sidebar: full or icon-only, remembered per browser.
	const [collapsed, setCollapsed] = useState(() => {
		try {
			return typeof window !== "undefined" && window.localStorage.getItem("avk-seller-sidebar") === "collapsed";
		} catch {
			return false;
		}
	});
	const toggleCollapsed = () =>
		setCollapsed((value) => {
			try {
				window.localStorage.setItem("avk-seller-sidebar", value ? "full" : "collapsed");
			} catch {
				// Storage blocked: the choice just isn't remembered.
			}
			return !value;
		});

	useEffect(() => {
		const onKey = (event: KeyboardEvent) => {
			if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
				event.preventDefault();
				setPaletteOpen((value) => !value);
			}
		};
		window.addEventListener("keydown", onKey);
		return () => window.removeEventListener("keydown", onKey);
	}, []);

	useEffect(() => {
		if (!hydrated) void refreshSession();
	}, [hydrated, refreshSession]);

	// Everything on the dashboard refetches when the store's data changes
	// anywhere (a sale, an admin approving a payout, a suspension).
	const overview = useLiveResource<Overview | null>({
		endpoint: customer ? "/api/seller/overview" : null,
		initialData: EMPTY_OVERVIEW,
		topics: ["resellers", "orders"],
	});

	const noStore = overview.error === "Open your store first.";
	useEffect(() => {
		if (noStore) router.replace("/start");
	}, [noStore, router]);

	const setTab = useCallback(
		(next: TabKey, extra?: Record<string, string>) => {
			const params = new URLSearchParams(searchParams.toString());
			params.set("tab", next);
			params.delete("welcome");
			params.delete("customize");
			for (const [key, value] of Object.entries(extra ?? {})) params.set(key, value);
			router.push(`${pathname}?${params}`, { scroll: false });
			window.scrollTo({ behavior: "smooth", top: 0 });
		},
		[pathname, router, searchParams],
	);

	if (hydrated && !customer) {
		return (
			<div className={`${styles.page} ${styles.admin} ${styles.gate}`}>
				<section aria-labelledby="studio-gate-title" className={styles.gateCard}>
					<div className={styles.gateMain}>
						<Link aria-label="Avokarto home" className={styles.gateBrand} href="/">
							<Image alt="" height={32} src="/assets/images/logo/avokarto-logo-mark.webp" width={32} />
							<span>avokarto <small>Store studio</small></span>
						</Link>
						<h1 className={styles.gateTitle} id="studio-gate-title">Sign in to your store studio</h1>
						<p className={styles.gateText}>Manage products, orders, videos and earnings for your Avokarto store, all in one place.</p>
						<div className={styles.gateActions}>
							<ModalTriggerButton className={`${styles.btn} ${styles.gatePrimary}`} openModalName="signinModal">Sign in</ModalTriggerButton>
							<Link className={`${styles.ghost} ${styles.gateSecondary}`} href="/start">
								<Plus size={16} /> Open your store
							</Link>
						</div>
						<p className={styles.gateNote}>New to Avokarto? Every plan starts with a {TRIAL_DAYS}-day free trial. We stock, pack and ship every order.</p>
					</div>
					{/* What's inside, so the page says what signing in gets you. */}
					<ul aria-label="Inside your store studio" className={styles.gateSide}>
						{[
							{ icon: ClipboardList, text: "Every order through your store, live", title: "Orders" },
							{ icon: Tag, text: "Pick winning products and set your margin", title: "Products" },
							{ icon: Clapperboard, text: "Ready-made reels for each product", title: "Video studio" },
							{ icon: Wallet, text: "Track earnings and request payouts", title: "Earnings" },
						].map((item) => (
							<li key={item.title}>
								<span className={styles.gateIcon}><item.icon size={18} /></span>
								<span><strong>{item.title}</strong><small>{item.text}</small></span>
							</li>
						))}
					</ul>
				</section>
			</div>
		);
	}

	const data = overview.data;
	if (!data) {
		return (
			<div className={`${styles.page} ${styles.admin}`}>
				<div className={`${styles.adminMain} ${styles.stack}`}>
					{overview.error && !noStore ? (
						<div className={styles.alert} role="alert">
							{overview.error}{" "}
							<button className={styles.ghost} onClick={() => void overview.refresh()} type="button">Try again</button>
						</div>
					) : (
						<>
							<div className={styles.skeleton} style={{ height: 150 }} />
							<div className={styles.skeleton} style={{ height: 320 }} />
						</>
					)}
				</div>
			</div>
		);
	}

	const { store } = data;
	const link = data.customDomain?.status === "active" ? `https://${data.customDomain.domain}` : storeUrl(store.handle);
	const current = TABS.find((item) => item.key === tab) ?? TABS[0];

	const searchProducts = (q: string) => {
		const params = new URLSearchParams({ tab: "products" });
		if (q) params.set("q", q);
		router.push(`${pathname}?${params}`, { scroll: false });
	};

	const commands: Command[] = [
		...TABS.map((item) => ({ group: "Go to", icon: item.icon, id: `tab-${item.key}`, label: item.title, run: () => setTab(item.key) })),
		{ group: "Store", icon: Palette, id: "design", label: "Change store theme", run: () => setTab("settings", { customize: "1" }) },
		{ group: "Store", icon: ExternalLink, id: "view", label: "Open my store", run: () => window.open(link, "_blank", "noopener") },
		{ group: "Store", icon: UserRound, id: "profile", label: "Open my seller profile", run: () => window.open(`/sellers/${store.handle}`, "_blank", "noopener") },
		{
			group: "Store",
			icon: Copy,
			id: "copy",
			label: "Copy store link",
			run: () => {
				void navigator.clipboard?.writeText(link);
				toast.show("Store link copied");
			},
		},
	];

	const navItem = (item: (typeof TABS)[number]) => (
		<button
			aria-current={tab === item.key ? "page" : undefined}
			className={"sub" in item ? styles.navSub : styles.navItem}
			key={item.key}
			onClick={() => {
				setMenuOpen(false);
				setTab(item.key);
			}}
			title={item.label}
			type="button"
		>
			{"sub" in item ? <PackagePlus size={16} /> : <item.icon size={18} />}
			<span className={styles.navLabel}>{item.label}</span>
			{item.key === "products" && data.listings.active ? <span className={styles.navCount}>{data.listings.active}</span> : null}
		</button>
	);

	const avatar = (size: "sm" | "lg") => (
		<span className={size === "lg" ? styles.storeAvatarLg : styles.storeAvatar} style={{ background: store.accentColor, color: readableOn(store.accentColor) }}>
			{store.logoUrl ? <Image alt="" fill sizes="96px" src={store.logoUrl} style={{ objectFit: "cover" }} /> : initialsOf(store.name)}
		</span>
	);

	return (
		<div className={`${styles.page} ${styles.admin}`} data-collapsed={collapsed ? "" : undefined}>
			{menuOpen ? <button aria-label="Close menu" className={styles.scrim} onClick={() => setMenuOpen(false)} type="button" /> : null}
			<aside aria-label="Seller dashboard" className={styles.sidebar} data-open={menuOpen ? "" : undefined}>
				<div className={styles.sidebarBrand}>
					<Link className={styles.brandLink} href="/" title="Avokarto">
						<Image alt="" height={30} src="/assets/images/logo/avokarto-logo-mark.webp" width={30} />
						<span className={styles.navLabel}>
							avokarto <em>studio</em>
						</span>
					</Link>
					<button aria-label="Close menu" className={styles.sidebarClose} onClick={() => setMenuOpen(false)} type="button">
						<X size={18} />
					</button>
				</div>

				<a className={styles.storeSwitch} href={link} rel="noopener" target="_blank" title={`${store.name} - open store`}>
					{avatar("sm")}
					<span className={styles.navLabel}>
						<strong>{store.name}</strong>
						<small><span className={store.status === "active" ? styles.dotLive : styles.dotOff} /> {store.status === "active" ? "Live" : store.status === "unpaid" ? "Offline" : "Suspended"}</small>
					</span>
					<ExternalLink className={`${styles.navTrailing} ${styles.navLabel}`} size={14} />
				</a>

				<nav className={styles.sidebarNav}>
					{MAIN_TABS.map(navItem)}
				</nav>
				<div className={styles.sidebarFoot}>
					{navItem(TABS[TABS.length - 1])}
					<button
						aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
						className={`${styles.navItem} ${styles.collapseToggle}`}
						onClick={toggleCollapsed}
						title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
						type="button"
					>
						{collapsed ? <PanelLeftOpen size={18} /> : <PanelLeftClose size={18} />}
						<span className={styles.navLabel}>Collapse</span>
					</button>
				</div>
			</aside>

			<div className={styles.workspace}>
				<header className={styles.appbar}>
					<button aria-expanded={menuOpen} aria-label="Open menu" className={styles.appbarMenu} onClick={() => setMenuOpen(true)} type="button">
						<Menu size={20} />
					</button>
					<p className={styles.crumb}>
						<span className={styles.crumbStore}>{store.name}</span>
						<ChevronRight aria-hidden="true" className={styles.crumbStore} size={14} />
						<strong>{current.title}</strong>
					</p>
					<button aria-label="Search and quick actions" className={styles.searchTrigger} onClick={() => setPaletteOpen(true)} type="button">
						<Search size={16} />
						<span className={styles.searchHint}>Search or jump to…</span>
						<kbd className={styles.searchHint}>⌘K</kbd>
					</button>
					<a aria-label="View your store" className={styles.appbarIcon} href={link} rel="noopener" target="_blank" title="View store">
						<Store size={18} />
					</a>
					<button aria-label="Store settings" className={styles.appbarAvatar} onClick={() => setTab("settings")} type="button">
						{avatar("sm")}
					</button>
				</header>

				<main className={styles.adminMain}>
					<div className={styles.pageHead} hidden={tab === "overview"}>
						<div>
							<h1 className={styles.pageTitle}>{current.title}</h1>
							<p className={styles.pageSub}>{SUBTITLES[current.key]}</p>
						</div>
						<div className={styles.row}>
							{tab === "products" ? (
								<button className={styles.btn} onClick={() => setTab("catalog")} type="button">
									<PackagePlus size={16} /> Add products
								</button>
							) : null}
						</div>
					</div>

					<div className={styles.stack}>
						{store.status === "suspended" ? (
							<p className={styles.alert} role="alert">
								<strong>Your store is suspended.</strong> Shoppers can&apos;t see it and payouts are paused.
								{store.suspendedReason ? ` Reason: ${store.suspendedReason.replace(/[.!?]*\s*$/, "")}.` : ""} Contact support if you think this is a mistake.
							</p>
						) : null}
						{store.status === "unpaid" && tab !== "billing" ? (
							<p className={styles.notice} role="alert">
								<strong>Your store is offline.</strong> Start your free trial to put it live for shoppers.{" "}
								<button className={styles.btnSm + " " + styles.btn} onClick={() => setTab("billing")} type="button">
									Choose a plan
								</button>
							</p>
						) : null}
						{welcome ? (
							<div className={styles.success} role="status">
								<strong>Your store is live.</strong> Add a few products, then share your link to start earning.{" "}
								<button className={styles.btnSm + " " + styles.btn} onClick={() => { setWelcome(false); setTab("catalog"); }} type="button">
									Add products
								</button>
							</div>
						) : null}

						{tab === "overview" ? (
							<StudioHome data={data} link={link} onTab={setTab} onToast={toast.show} />
						) : null}
						{tab === "insights" ? <SellerInsights storeLink={link} /> : null}
						{tab === "products" ? (
							<SellerListings
								handle={data.store.handle}
								initialQuery={searchParams.get("q") ?? ""}
								key={searchParams.get("q") ?? ""}
								linkBase={link}
								onBrowse={() => setTab("catalog")}
								onToast={toast.show}
								settings={data.settings}
							/>
						) : null}
						{tab === "catalog" ? <SellerCatalog onToast={toast.show} settings={data.settings} store={store} /> : null}
						{tab === "videos" ? (
							<SellerVideos
								accent={store.accentColor}
								initialView={legacyReels ? "readymade" : "create"}
								onBrowse={() => setTab("catalog")}
								onToast={toast.show}
								storeLink={link}
								storeName={store.name}
							/>
						) : null}
						{tab === "orders" ? <SellerOrders /> : null}
						{tab === "payouts" ? <SellerPayouts data={data} onToast={toast.show} /> : null}
						{tab === "billing" ? <SellerBilling onToast={toast.show} /> : null}
						{tab === "settings" ? (
							<SellerSettingsPanel onRefresh={() => void overview.refresh()} onToast={toast.show} settings={data.settings} store={store} />
						) : null}
					</div>
				</main>
			</div>

			<nav aria-label="Seller dashboard" className={styles.bottomNav}>
				{BOTTOM_TABS.map((item, index) => (
					<Fragment key={item.key}>
						{index === 2 ? (
							<button aria-label="Add products" className={styles.fab} onClick={() => setTab("catalog")} type="button">
								<Plus size={24} />
							</button>
						) : null}
						<button
							aria-current={tab === item.key ? "page" : undefined}
							className={styles.bottomTab}
							onClick={() => setTab(item.key)}
							type="button"
						>
							<item.icon />
							{item.short}
						</button>
					</Fragment>
				))}
			</nav>
			<CommandPalette commands={commands} onClose={() => setPaletteOpen(false)} onSearch={searchProducts} open={paletteOpen} />
			{toast.node}
		</div>
	);
}
