"use client";

import {
	ArrowRight,
	BadgeCheck,
	Check,
	ChevronDown,
	ChevronsRight,
	Clapperboard,
	Download,
	Gift,
	Menu,
	Monitor,
	MessageCircle,
	Minus,
	Package,
	Palette,
	Play,
	ShieldCheck,
	ShoppingBag,
	Sparkles,
	Smartphone,
	Tablet,
	Star,
	Store,
	Truck,
	X,
	Zap,
} from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import ModalTriggerButton from "@/components/action-buttons/ModalTriggerButton";
import { useCustomerSession } from "@/hooks/use-customer-session";
import type { SellLandingData } from "@/lib/backend/sell-landing";
import PeriodSwitch from "@/components/billing/PeriodSwitch";
import { DEFAULT_PERIOD, monthlyCost, periodQuery, PLAN_KEYS, PLANS, TRIAL_DAYS, usd, yearlySaving, type BillingPeriod } from "@/lib/billing/plans";
import { sellerFaqs } from "@/lib/seller-faq";
import { resellerPrice, suggestHandle } from "@/lib/resellerPricing";
import { STORE_THEME_INFO, STORE_THEMES, type StoreTheme } from "@/lib/storeThemes";
import FeatureBento from "./FeatureBento";
import { LaunchBackdrop, LaunchRail, LaunchWall } from "./FinalLaunch";
import LoopingVideo from "./LoopingVideo";
import ProductImage from "./ProductImage";
import { readDraftName, readDraftTheme, saveDraft } from "./storeDraft";
import { PickScene, ReelScene } from "./StepScenes";
import StoreLiveCard from "./StoreLiveCard";
import StorePrototype, { type PrototypeDevice } from "./StorePrototype";
import { useCountUp } from "./useCountUp";
import WinningProducts from "./WinningProducts";
import { money, sellerRequest, type SellerSettings, type SellerStore } from "./sellerApi";
import pr from "./pricing.module.css";
import styles from "./seller.module.css";
import s from "./sell.module.css";

type StoreState = { settings: SellerSettings; store: SellerStore | null };

const noSubscribe = () => () => {};
function subscribeResize(onChange: () => void) {
	window.addEventListener("resize", onChange);
	return () => window.removeEventListener("resize", onChange);
}
function subscribeScroll(onChange: () => void) {
	window.addEventListener("scroll", onChange, { passive: true });
	return () => window.removeEventListener("scroll", onChange);
}

const NAV = [
	["#products", "Winning products"],
	["#how-it-works", "How it works"],
	["#reels", "Reels"],
	["#pricing", "Pricing"],
	["#faq", "FAQ"],
] as const;

const STEPS = [
	[Sparkles, "Pick winning products", "Browse best sellers from our catalog and add them to your store in one tap. No sourcing, no samples."],
	[Store, "Launch your store", "Name it, pick a theme and you're live - on your own link, or your own domain on Pro."],
	[Clapperboard, "Post reels & get paid", "Share ready-made product videos. Every order is packed and shipped by us; the profit is yours."],
] as const;

const COMPARE: [string, string, string][] = [
	["Monthly cost", "Store plan + paid apps", `From $${PLANS.starter.price}, all-in`],
	["Finding products & suppliers", "You research them", "Built-in catalog"],
	["Stock & packing", "Supplier or you", "Handled by us"],
	["Promo videos", "You film & edit", "Ready-made reels"],
	["Branded store & domain", "Extra apps & fees", "Domain from Pro"],
	["Time to launch", "Days to weeks", "About a minute"],
];

// The hero's last word is typed out like a store name; "sells" is the
// headline screen readers, search engines and reduced-motion visitors get.
// Picked to be near-equal width in the headline font, so the box stays snug.
const HERO_WORDS = ["sell", "pay", "win"];

const FINAL_WORDS = ["next minute"];

const ORDER_PRESETS = [5, 10, 25, 50];

function Range({ label, max, min, onChange, step = 1, suffix, value }: {
	label: string;
	max: number;
	min: number;
	onChange: (value: number) => void;
	step?: number;
	suffix: string;
	value: number;
}) {
	const pct = max > min ? ((value - min) / (max - min)) * 100 : 0;
	return (
		<label className={s.range}>
			<span className={s.rangeHead}>
				<span>{label}</span>
				<strong>{suffix}</strong>
			</span>
			<input
				aria-label={label}
				aria-valuetext={suffix}
				className={s.rangeInput}
				max={max}
				min={min}
				onChange={(event) => onChange(Number(event.target.value))}
				step={step}
				style={{ "--pct": `${pct}%` } as React.CSSProperties}
				type="range"
				value={value}
			/>
		</label>
	);
}

function compact(value: number) {
	return new Intl.NumberFormat("en", { maximumFractionDigits: 1, notation: "compact" }).format(value);
}

/**
 * A word typed into a lime "selected text" box with a caret: type, hold,
 * backspace, next word (one word just retypes). It starts from the full
 * first word and only types while on screen. Hidden copies of every word
 * size the box, so typing never reflows the line around it. Decorative -
 * callers give the heading its plain text for screen readers.
 */
function TypingWord({ words }: { words: readonly string[] }) {
	const slotRef = useRef<HTMLSpanElement>(null);
	const [typed, setTyped] = useState(words[0]);
	const [visible, setVisible] = useState(false);
	// Where the loop is, kept across pauses so it resumes mid-word.
	const progress = useRef({ deleting: true, length: words[0].length, word: 0 });

	useEffect(() => {
		const slot = slotRef.current;
		if (!slot) return;
		const observer = new IntersectionObserver(([entry]) => setVisible(entry.isIntersecting));
		observer.observe(slot);
		return () => observer.disconnect();
	}, []);

	useEffect(() => {
		if (!visible || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
		const state = progress.current;
		let timer = 0;
		const tick = () => {
			const current = words[state.word];
			if (state.deleting) {
				if (state.length > 0) {
					state.length -= 1;
					setTyped(current.slice(0, state.length));
					timer = window.setTimeout(tick, 55);
				} else {
					state.deleting = false;
					state.word = (state.word + 1) % words.length;
					timer = window.setTimeout(tick, 260);
				}
			} else if (state.length < words[state.word].length) {
				state.length += 1;
				setTyped(words[state.word].slice(0, state.length));
				timer = window.setTimeout(tick, 95);
			} else {
				state.deleting = true;
				timer = window.setTimeout(tick, 2000);
			}
		};
		// A full word on screen gets a moment to be read; a half-typed one carries on.
		timer = window.setTimeout(tick, state.deleting && state.length === words[state.word].length ? 2400 : 95);
		return () => window.clearTimeout(timer);
	}, [visible, words]);

	return (
		<span className={s.typeSlot} ref={slotRef}>
			{words.map((word) => <span className={s.typeGhost} key={word}>{word}</span>)}
			<span className={s.typeText}>{typed}<span className={s.caret} /></span>
		</span>
	);
}

export default function SellLanding({ data }: { data: SellLandingData }) {
	const router = useRouter();
	const { customer, hydrated, refresh } = useCustomerSession();
	const [loadedState, setState] = useState<StoreState | null>(null);
	// Store data belongs to whoever is signed in; signed out shows none.
	const state = customer ? loadedState : null;
	const [menuOpen, setMenuOpen] = useState(false);
	const menuButtonRef = useRef<HTMLButtonElement>(null);
	const headerRef = useRef<HTMLElement>(null);
	const [pickedDevice, setDevice] = useState<PrototypeDevice | null>(null);
	const narrow = useSyncExternalStore(subscribeResize, () => window.innerWidth < 640, () => false);
	const device: PrototypeDevice = pickedDevice ?? (narrow ? "phone" : "desktop");
	// The themes section has its own prototype and its own device choice.
	const [pickedThemeDevice, setThemeDevice] = useState<PrototypeDevice | null>(null);
	const themeDevice: PrototypeDevice = pickedThemeDevice ?? (narrow ? "phone" : "desktop");
	const themeRow = useRef<HTMLDivElement>(null);
	const [bannerClosed, setBannerClosed] = useState(false);
	const scrolled = useSyncExternalStore(subscribeScroll, () => window.scrollY > 8, () => false);

	// Hero store builder: null until typed, so a name saved before sign-up shows through.
	const storedDraft = useSyncExternalStore(noSubscribe, readDraftName, () => "");
	const [typedDraft, setDraft] = useState<string | null>(null);
	const draft = typedDraft ?? storedDraft;
	const host = "avokarto.com";
	// Like the name: a theme picked before signing up is where the page starts,
	// so a second "Build my store" doesn't overwrite it with the default.
	const storedTheme = useSyncExternalStore(noSubscribe, readDraftTheme, () => "" as const);
	const [pickedTheme, setTheme] = useState<StoreTheme | null>(null);
	const [period, setPeriod] = useState<BillingPeriod>(DEFAULT_PERIOD);
	const theme: StoreTheme = pickedTheme ?? (storedTheme || "minimal");
	useEffect(() => {
		const row = themeRow.current;
		const card = row?.querySelector<HTMLElement>('[aria-pressed="true"]');
		if (!row || !card || row.scrollWidth <= row.clientWidth) return;
		const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
		row.scrollTo({ behavior: reduced ? "auto" : "smooth", left: card.offsetLeft - row.offsetLeft - 16 });
	}, [theme]);

	// Calculator inputs (the margin also prices the product grid).
	const [price, setPrice] = useState(40);
	// Until the visitor moves it, the top margin, matching the offer above.
	const [chosenMargin, setMargin] = useState<number | null>(null);
	const [ordersPerWeek, setOrdersPerWeek] = useState(10);

	// Mobile sticky CTA: shown once the hero is scrolled past, hidden while the sign-up card is on screen.
	const heroRef = useRef<HTMLElement>(null);
	const formRef = useRef<HTMLElement | null>(null);
	const setFormNode = (node: HTMLElement | null) => {
		formRef.current = node;
	};
	const [heroVisible, setHeroVisible] = useState(true);
	const [formVisible, setFormVisible] = useState(false);

	useEffect(() => {
		if (!hydrated) void refresh();
	}, [hydrated, refresh]);

	// Keyed by the account id: the session object is replaced on every
	// session refresh, which would otherwise refetch the store each time.
	const customerId = customer?.sub;
	useEffect(() => {
		if (!customerId) return;
		let cancelled = false;
		sellerRequest<StoreState>("GET", "/api/seller/store")
			.then((next) => {
				if (cancelled) return;
				setState(next);
				setMargin((current) => (current === null ? null : Math.min(current, next.settings.maxMarginPercent)));
			})
			// Not loaded: the page just offers the signed-in default (start a store).
			.catch(() => undefined);
		return () => {
			cancelled = true;
		};
	}, [customerId]);

	useEffect(() => {
		const observer = new IntersectionObserver((entries) => {
			for (const entry of entries) {
				if (entry.target === heroRef.current) setHeroVisible(entry.isIntersecting);
				if (entry.target === formRef.current) setFormVisible(entry.isIntersecting);
			}
		});
		if (heroRef.current) observer.observe(heroRef.current);
		if (formRef.current) observer.observe(formRef.current);
		return () => observer.disconnect();
		// The watched form is the hero's claim form, which only signed-out visitors get.
	}, [customerId]);

	useEffect(() => {
		if (!menuOpen) return;
		const onKey = (event: KeyboardEvent) => {
			if (event.key === "Escape") {
				setMenuOpen(false);
				menuButtonRef.current?.focus();
			}
		};
		const onOutside = (event: PointerEvent) => {
			if (event.target instanceof Node && !headerRef.current?.contains(event.target)) setMenuOpen(false);
		};
		const desktop = window.matchMedia("(min-width: 1200px)");
		const onDesktop = () => { if (desktop.matches) setMenuOpen(false); };
		window.addEventListener("keydown", onKey);
		window.addEventListener("pointerdown", onOutside);
		desktop.addEventListener("change", onDesktop);
		return () => {
			window.removeEventListener("keydown", onKey);
			window.removeEventListener("pointerdown", onOutside);
			desktop.removeEventListener("change", onDesktop);
		};
	}, [menuOpen]);

	const settings = state?.settings ?? data.settings;
	const maxMargin = settings?.maxMarginPercent ?? 50;
	const fee = settings?.platformFeePercent ?? 0;
	const margin = Math.min(chosenMargin ?? maxMargin, maxMargin);
	const pricing = { maxMarginPercent: maxMargin, platformFeePercent: fee };
	const perOrder = resellerPrice(price, "percent", margin, pricing).net;
	const monthly = perOrder * ordersPerWeek * 4.33;
	const animatedMonthly = useCountUp(monthly);
	const hasStore = Boolean(state?.store);
	const signedOut = hydrated && !customer;

	const nav = NAV.filter(([href]) => href !== "#products" || data.products.length >= 4);
	const stickyVisible = !heroVisible && !formVisible && !menuOpen;

	const shownProducts = data.products.slice(0, 4);
	const spotlight = data.products[0];
	const themeInfo = STORE_THEME_INFO[theme];
	const accent = themeInfo.accents[0];
	const handle = suggestHandle(draft) || "your-store";

	const faqs = sellerFaqs(data.settings);

	function claim() {
		saveDraft(draft, theme);
	}

	// Dropmax-style: every "start" button goes straight into the store builder
	// (/start) - name, look and margin come first, and the account is only
	// asked for before the plan step, once there's a store worth saving.
	function startBuilding(event: React.FormEvent) {
		event.preventDefault();
		claim();
		router.push(state?.store ? "/seller" : "/start");
	}

	// `nav` renders the slim header pill (label + lime chevron dot) instead of text + arrow.
	// `query` carries a non-default billing period (e.g. "period=monthly") to onboarding or billing.
	const primaryCta = (label: string, className = s.ctaPrimary, dashboardLabel = "Go to my dashboard", dashboardHref = "/seller", nav = false, query = "") => {
		const content = (text: string) =>
			nav ? (
				<>
					<span>{text}</span>
					<span aria-hidden="true" className={s.ctaNavDot}><ChevronsRight size={16} strokeWidth={2.75} /></span>
				</>
			) : (
				<>{text} <ArrowRight size={18} /></>
			);
		return hasStore ? (
			<Link className={className} href={query ? `${dashboardHref}${dashboardHref.includes("?") ? "&" : "?"}${query}` : dashboardHref}>
				{content(dashboardLabel)}
			</Link>
		) : (
			<Link className={className} href={query ? `/start?${query}` : "/start"} onClick={claim}>
				{content(label)}
			</Link>
		);
	};

	// Social proof from real numbers only.
	const reviewed = data.products.filter((product) => product.reviewCount > 0);
	const reviews = reviewed.reduce((sum, product) => sum + product.reviewCount, 0);
	const avgRating = reviews ? reviewed.reduce((sum, product) => sum + product.rating * product.reviewCount, 0) / reviews : 0;
	// An admin-set advertised count (Marketplace rules) wins; otherwise the live numbers.
	const advertised = data.settings?.advertisedProducts;
	const proof = advertised
		? <><strong>{compact(advertised)}+</strong> winning products ready to sell</>
		: data.stats && data.stats.stores >= 10
			? <><strong>{compact(data.stats.stores)}</strong> stores already selling</>
			: data.stats?.products
				? <><strong>{data.stats.products >= 1000 ? `${compact(data.stats.products)}+` : data.stats.products}</strong> winning products ready to sell</>
				: <><strong>{TRIAL_DAYS}-day</strong> free trial on every plan</>;
	const spotQuote = spotlight ? resellerPrice(spotlight.price, "percent", margin, pricing) : null;
	const saleProfit = spotQuote?.net ?? 0;
	// The hero's profit card sits beside the reel, so it names the product in that video.
	const reelProduct = data.products.find((product) => /paw ops/i.test(product.title)) ?? spotlight;
	const reelQuote = reelProduct ? resellerPrice(reelProduct.price, "percent", margin, pricing) : null;
	const ticker = [
		{ pill: `${TRIAL_DAYS} days`, text: "Free trial on every plan" },
		{ pill: `$${PLANS.starter.price}`, text: "a month, all-in - no paid apps" },
		{ pill: `${maxMargin}%`, text: "Max margin you can set" },
		{ pill: "24/7", text: "Your store never closes" },
		{ pill: "1-tap", text: "Ready-made reels" },
	];

	// The page's main action, used in the hero and again at the close.
	// Only the hero's copy is the "#open-store" anchor and the watched form.
	// A lime ripple from wherever the claim box is clicked or tapped. The key
	// restarts the animation on every press; the place keeps hero and close apart.
	const [ripple, setRipple] = useState<{ key: number; place: "hero" | "final"; x: number; y: number } | null>(null);
	const pressClaim = (place: "hero" | "final") => (event: React.PointerEvent<HTMLFormElement>) => {
		const box = event.currentTarget.getBoundingClientRect();
		setRipple((current) => ({ key: (current?.key ?? 0) + 1, place, x: event.clientX - box.left, y: event.clientY - box.top }));
	};
	const filled = Boolean(draft.trim());
	// Further down the catalog than the products shown above, when there are enough.
	const marketShelf = (data.products.length >= 10 ? data.products.slice(7, 10) : data.products.slice(0, 3));

	const claimForm = (place: "hero" | "final") => (
		<>
			{hasStore ? (
				<div className={s.heroActions}>
					<Link className={s.ctaSplit} href="/seller">
						<span className={s.ctaSplitLabel}>Go to my dashboard</span>
						<span aria-hidden="true" className={s.ctaSplitIcon}><ChevronsRight size={22} strokeWidth={2.5} /></span>
					</Link>
					<Link className={s.ctaGhost} href="/seller?tab=catalog">
						<span aria-hidden="true" className={s.ctaGhostIcon}><Package size={16} strokeWidth={2.25} /></span>
						Add winning products
					</Link>
				</div>
			) : (
				<form
					className={s.claim}
					data-filled={filled || undefined}
					id={place === "hero" && !customer ? "open-store" : undefined}
					onPointerDown={pressClaim(place)}
					onSubmit={startBuilding}
					ref={place === "hero" && !customer ? setFormNode : undefined}
				>
					<span aria-hidden="true" className={s.claimRipples}>
						{ripple?.place === place ? <span className={s.claimRipple} key={ripple.key} style={{ left: ripple.x, top: ripple.y }} /> : null}
					</span>
					<label className={s.claimField}>
						<span className="visually-hidden">Name your store</span>
						<Store aria-hidden="true" className={s.claimIcon} size={18} />
						<span aria-hidden="true" className={s.claimPrefix}>{host}/</span>
						<input
							autoComplete="organization"
							enterKeyHint="go"
							maxLength={60}
							onChange={(event) => setDraft(event.target.value)}
							placeholder="your-store"
							value={draft}
						/>
					</label>
					<button className={s.ctaSplit} type="submit">
						<span className={s.ctaSplitLabel}>Build my store</span>
						<span aria-hidden="true" className={s.ctaSplitIcon}><ChevronsRight size={22} strokeWidth={2.5} /></span>
					</button>
				</form>
			)}
			{!hasStore ? (
				<p aria-live={place === "hero" ? "polite" : undefined} className={s.claimHint}>
					{/* Keyed so the line slides in fresh when it switches between hint and link. */}
					{filled
						? <span className={s.claimHintSwap} key="link">Your link: <strong>{host}/{handle}</strong></span>
						: <span className={s.claimHintSwap} key="hint">{TRIAL_DAYS}-day free trial · Cancel any time · Takes about a minute</span>}
				</p>
			) : null}
		</>
	);

	// Small live visuals for the three steps - real products, the typed name, real profit.
	const stepVisual = (index: number) => {
		if (index === 0) {
			return (
				<PickScene products={data.products.slice(0, 3).map((product) => ({ id: product.id, imgSrc: product.imgSrc, profit: resellerPrice(product.price, "percent", margin, pricing).net }))} />
			);
		}
		if (index === 1) {
			return (
				<StoreLiveCard accent={accent} address={`${host}/${handle}`} background={themeInfo.background} images={data.products.slice(0, 3).map((product) => product.imgSrc)} name={draft.trim() || "Your Store"} />
			);
		}
		return <ReelScene handle={handle} profit={spotQuote?.net ?? perOrder} />;
	};

	// Advertise seller benefits consistently, independent of live catalog/store counts.
	const stats = [
		{ label: "your online store stays open", value: "24/7" },
		{ label: "free trial on every plan", value: `${TRIAL_DAYS} days` },
		{ label: "margin on every product you sell", value: `Up to ${maxMargin}%` },
		{ label: "packing & shipping handled by us", value: "100%" },
	];

	const footerColumns: [string, [string, string][]][] = [
		["Sell", [["/dropshipping-store-builder", "Store builder"], ["/how-it-works", "How it works"], ["/pricing", "Pricing"], ["/guides", "Dropshipping guides"], ["/seller", "Seller dashboard"]]],
		["Marketplace", [["/marketplace", "Shop the marketplace"], ["/shop", "All products"], ["/shop-by-categories", "Categories"], ["/sellers", "Sellers"]]],
		["Company", [["/about", "About"], ["/contact", "Contact"], ["/help-center", "Help center"], ["/privacy-policy", "Privacy"], ["/terms-policy", "Terms"]]],
	];

	return (
		<div className={`${styles.page} ${s.landing}`}>
			<a className={s.skipLink} href="#sell-hero-title">Skip to content</a>
			{!bannerClosed ? (
				<div aria-label="Announcement" className={s.announcement} role="region">
					<p className="visually-hidden">{ticker.map((item) => item.text).join(". ")}.</p>
					<div aria-hidden="true" className={s.ticker}>
						<div className={s.tickerTrack}>
							{[...ticker, ...ticker].map((item, index) => (
								<span className={s.tickerItem} key={index}><em>{item.pill}</em>{item.text}</span>
							))}
						</div>
					</div>
					<button aria-label="Dismiss announcement" className={s.tickerClose} onClick={() => setBannerClosed(true)} type="button"><X size={15} /></button>
				</div>
			) : null}
			{/* ---------- header ---------- */}
			<header className={s.header} data-scrolled={scrolled || menuOpen || undefined} ref={headerRef}>
				<div className={s.headerInner}>
					<Link aria-label="Avokarto home" className={s.brand} href="/">
						<Image alt="" height={32} src="/assets/images/logo/avokarto-logo-mark.webp" width={32} />
						<span>avokarto</span>
					</Link>
					<nav aria-label="Main" className={s.nav}>
						{nav.map(([href, label]) => <a href={href} key={href}>{label}</a>)}
					</nav>
					<div className={s.headerActions}>
						<Link className={s.marketLink} href="/marketplace" title="Shop the marketplace">
							<ShoppingBag size={16} /> <span>Marketplace</span>
						</Link>
						{signedOut ? (
							<ModalTriggerButton className={s.signinLink} onClick={claim} openModalName="signinModal">Sign in</ModalTriggerButton>
						) : null}
						{primaryCta("Start free", s.ctaNav, "Dashboard", "/seller", true)}
						<button aria-controls="sell-mobile-navigation" aria-expanded={menuOpen} aria-label={menuOpen ? "Close menu" : "Open menu"} className={s.menuBtn} ref={menuButtonRef} onClick={() => setMenuOpen((open) => !open)} type="button">
							{menuOpen ? <X size={20} /> : <Menu size={20} />}
						</button>
					</div>
				</div>
				{menuOpen ? (
					<nav aria-label="Mobile navigation" className={s.mobileNav} id="sell-mobile-navigation">
						{nav.map(([href, label]) => <a href={href} key={href} onClick={() => setMenuOpen(false)}>{label}</a>)}
						<Link href="/marketplace" onClick={() => setMenuOpen(false)}><ShoppingBag size={16} /> Shop the marketplace</Link>
						{signedOut ? (
							<ModalTriggerButton className={styles.ghost} onClick={() => { claim(); setMenuOpen(false); }} openModalName="signinModal">Sign in</ModalTriggerButton>
						) : null}
					</nav>
				) : null}
			</header>

			{/* ---------- hero ---------- */}
			<section aria-labelledby="sell-hero-title" className={s.hero} ref={heroRef}>
				<div aria-hidden="true" className={s.heroGlow} />
				<div className={s.heroCenter}>
					<p className={s.proof}>
						{data.products.length >= 3 ? (
							<span aria-hidden="true" className={s.proofAvatars}>
								{data.products.slice(0, 3).map((product) => (
									<span key={product.id}><ProductImage alt="" sizes="40px" src={product.imgSrc} /></span>
								))}
							</span>
						) : null}
						<span>{proof}</span>
						<BadgeCheck aria-hidden="true" className={s.proofIcon} size={17} />
					</p>
					<h1 className={s.heroTitle} id="sell-hero-title" tabIndex={-1}>
						<span className="visually-hidden">Dropshipping, done for you. AI videos that sell.</span>
						<span aria-hidden="true">
							<span className={s.heroLine}>Dropshipping, done for you.</span>{" "}
							AI videos{" "}
							<span className={s.heroHl}>
								that{" "}
								<TypingWord words={HERO_WORDS} />
								.
							</span>
						</span>
					</h1>
					<p className={s.heroText}>
						Pick winning products, launch your store and post ready-made videos.
						We stock, pack and ship every order. The profit is yours.
					</p>

					{claimForm("hero")}

					<div className={s.trustRow}>
						{reviews >= 10 ? (
							<span className={s.rating}>
								<span aria-hidden="true" className={s.stars}>
									{/* Each tile fills to the real average - 4.2 shows four and a fifth, not five. */}
									{[0, 1, 2, 3, 4].map((index) => (
										<span className={s.star} key={index} style={{ "--fill": `${Math.round(Math.max(0, Math.min(1, avgRating - index)) * 100)}%` } as React.CSSProperties}>
											<Star size={13} />
										</span>
									))}
								</span>
								<strong>{avgRating.toFixed(1)}/5</strong>
								<span>from {compact(reviews)} product reviews</span>
							</span>
						) : null}
						<span className={s.trustBadge}><Truck size={16} /> Fulfilled by Avokarto</span>
					</div>
					<ul className={s.heroChecks}>
						{/* "Takes about a minute" is already in the hint above - each check says something new. */}
						<li><span aria-hidden="true" className={s.checkDot}><Check size={12} strokeWidth={3} /></span> No code needed</li>
						<li><span aria-hidden="true" className={s.checkDot}><Check size={12} strokeWidth={3} /></span> No inventory to hold</li>
						<li><span aria-hidden="true" className={s.checkDot}><Check size={12} strokeWidth={3} /></span> Ready-made reels</li>
					</ul>
				</div>

				{/* Live storefront: reacts to the name typed above and the theme picked here. */}
				<div className={s.stage}>
					<div className={s.stageControls}>
						<div aria-label="Preview a theme" className={s.themePicker} role="group">
							{STORE_THEMES.map((key) => (
								<button
									aria-label={STORE_THEME_INFO[key].label}
									aria-pressed={theme === key}
									className={s.themeDot}
									key={key}
									onClick={() => setTheme(key)}
									style={{ "--dot-accent": STORE_THEME_INFO[key].accents[0], "--dot-bg": STORE_THEME_INFO[key].background } as React.CSSProperties}
									title={STORE_THEME_INFO[key].label}
									type="button"
								/>
							))}
							<span className={s.themeName}>{themeInfo.label}</span>
						</div>
						<div aria-label="Preview device" className={s.deviceSwitch} role="group">
							{([["desktop", Monitor], ["tablet", Tablet], ["phone", Smartphone]] as const).map(([key, Icon]) => (
								<button aria-label={`${key[0].toUpperCase()}${key.slice(1)} preview`} aria-pressed={device === key} key={key} onClick={() => setDevice(key)} type="button"><Icon size={16} /></button>
							))}
						</div>
					</div>
					<StorePrototype
						accent={accent}
						device={device}
						host={host}
						name={draft.trim() || "Your Store"}
						path={`/${handle}`}
						theme={theme}
					/>
					<div className={s.floatRow}>
					{reelProduct && reelQuote ? (
						<div aria-hidden="true" className={s.floatProfit}>
							<span className={s.floatThumb}><ProductImage alt="" sizes="48px" src={reelProduct.imgSrc} /></span>
							<div>
								<small>Your profit per sale</small>
								<strong>+{money(reelQuote.net)}</strong>
								<span className={s.floatName}>{reelProduct.title}</span>
								<span className={s.floatPrice}>Sells for {money(reelQuote.salePrice)}</span>
							</div>
						</div>
					) : null}
					<div aria-hidden="true" className={s.floatReel}>
						<LoopingVideo canvasHeight={640} canvasWidth={360} playIcon={<span className={s.floatReelPlay}><Play size={14} /></span>} poster="/assets/videos/reel-dog-outfit.jpg" src="/assets/videos/reel-dog-outfit.mp4" />
						<span className={s.floatReelTag}><Clapperboard size={12} /> Reel ready</span>
					</div>
					</div>
					<div aria-hidden="true" className={s.floatShip}><Package size={15} /> Packed &amp; shipped by Avokarto</div>
				</div>
			</section>


			{/* ---------- stats ---------- */}
			<div className={`${styles.container} ${s.statsWrap}`}>
				<dl className={s.stats}>
					{stats.map((item) => (
						<div key={item.label}>
							<dd>{item.value}</dd>
							<dt>{item.label}</dt>
						</div>
					))}
				</dl>
			</div>

			<div className={`${styles.container} ${s.sections}`}>
				{/* ---------- winning products ---------- */}
				{data.products.length >= 4 ? (
					<section aria-labelledby="sell-products" className={s.section} id="products">
						<header className={s.sectionHead}>
							<span className={s.kicker}><Zap size={13} /> Winning products</span>
							<h2 className={s.sectionTitle} id="sell-products">Products that <mark className={s.mark}>already sell</mark>. Ready for your store.</h2>
							<p className={s.sectionText}>
								{data.basis === "sales" ? "This month's best sellers and fresh picks from Avokarto" : "Top-rated products on Avokarto"}. Add one
								to your store, set your price above our cost, and keep the difference on every sale. We stock, pack and ship it - no inventory, no upfront cost.
							</p>
						</header>
						<WinningProducts basis={data.basis} hasStore={hasStore} maxMargin={maxMargin} onClaim={claim} platformFeePercent={fee} products={shownProducts} topPrice={data.topPrice} />
						{/* A teaser, not the catalog: the top four, then the way to everything. */}
						<div className={s.winMore}>
							<Link className={s.winMoreLink} href={hasStore ? "/seller?tab=catalog" : "/marketplace"}>
								Browse all {advertised ? `${compact(advertised)}+` : data.stats?.products ? compact(data.stats.products) : ""} products
								<span aria-hidden="true" className={s.ctaNavDot}><ChevronsRight size={16} strokeWidth={2.75} /></span>
							</Link>
						</div>
					</section>
				) : null}

				{/* ---------- how it works ---------- */}
				<section aria-labelledby="sell-how" className={s.section} id="how-it-works">
					<header className={s.sectionHead}>
						<span className={s.kicker}>How it works</span>
						<h2 className={s.sectionTitle} id="sell-how">From zero to your <mark className={s.mark}>first sale</mark> in 3 steps</h2>
					</header>
					<ol className={s.steps}>
						{STEPS.map(([Icon, title, text], index) => (
							<li className={s.step} key={title}>
								<div aria-hidden="true" className={s.stepVisual}>{stepVisual(index)}</div>
								<div className={s.stepBody}>
									<span className={s.stepBadge}><Icon size={14} /> Step {index + 1}</span>
									<p className={s.cardTitle}>{title}</p>
									<p className={styles.muted}>{text}</p>
								</div>
							</li>
						))}
					</ol>
				</section>

				{/* ---------- reels ---------- */}
				<section aria-labelledby="sell-reels" className={s.spotlight} id="reels">
					<div className={s.spotlightCopy}>
						<span className={s.kicker}><Clapperboard size={13} /> Ready-made reels</span>
						<h2 className={s.sectionTitle} id="sell-reels">Marketing <mark className={s.mark}>done for you</mark>. Just post.</h2>
						<p className={s.sectionText}>
							Every product in your store comes with short promo videos made for Instagram Reels, TikTok and
							YouTube Shorts - plus a caption with your store link. Download in one tap and post.
						</p>
						<ul className={s.checks}>
							{["Vertical videos sized for every platform", "Captions written for you, with your link", "One-tap download or share from your phone"].map((item) => (
								<li key={item}><Check size={16} /> {item}</li>
							))}
						</ul>
						{primaryCta("Get my reels", s.ctaPrimary, "Open the video studio", "/seller?tab=videos")}
					</div>
					<div aria-hidden="true" className={s.reelStage}>
						<div className={s.reelPhone}>
							<LoopingVideo canvasHeight={960} canvasWidth={540} playIcon={<span className={s.reelPlay}><Play size={22} /></span>} poster="/assets/videos/reel-cozycarry.jpg" src="/assets/videos/reel-cozycarry.mp4" />
							<div className={s.reelShade} />
							<div className={s.reelCaption}>
								<strong>{spotlight?.title ?? "Your best seller"}</strong>
								<span>Only {money(resellerPrice(spotlight?.price ?? 25, "percent", margin, pricing).salePrice)} · link in bio 🛍️</span>
							</div>
						</div>
						<span className={`${s.reelChip} ${s.reelChipA}`}><Download size={14} /> Ready to post</span>
						<span className={`${s.reelChip} ${s.reelChipB}`}><Sparkles size={14} /> Caption included</span>
					</div>
				</section>

				{/* ---------- calculator ---------- */}
				<section aria-labelledby="sell-calc" className={s.calc}>
					<div className={s.calcInputs}>
						<span className={s.kicker}>Profit calculator</span>
						<h2 className={s.sectionTitle} id="sell-calc">Calculate your <mark className={s.mark}>monthly profit</mark></h2>
						<Range label="Average product cost" max={300} min={5} onChange={setPrice} step={5} suffix={money(price)} value={price} />
						<Range label="Your margin" max={maxMargin} min={1} onChange={setMargin} suffix={`${margin}%`} value={margin} />
						<Range label="Orders per week" max={100} min={1} onChange={setOrdersPerWeek} suffix={String(ordersPerWeek)} value={ordersPerWeek} />
						<div aria-label="Quick pick orders per week" className={s.presets} role="group">
							{ORDER_PRESETS.map((preset) => (
								<button aria-pressed={ordersPerWeek === preset} className={styles.chip} key={preset} onClick={() => setOrdersPerWeek(preset)} type="button">
									{preset} / week
								</button>
							))}
						</div>
					</div>
					<div className={s.calcResult}>
						<p className={s.calcLabel}>Your estimated profit</p>
						<p aria-hidden="true" className={s.calcValue}>{money(animatedMonthly)}</p>
						<output aria-live="polite" className={s.srOnly}>Estimated monthly profit: {money(monthly)}</output>
						<p className={s.calcLabel}>every month</p>
						<p className={s.calcNote}>An estimate, not a promise - real profit depends on what you sell and how much you promote it.</p>
						<dl className={s.calcBreakdown}>
							<div><dt>Per order</dt><dd>{money(perOrder)}</dd></div>
							<div><dt>Orders / month</dt><dd>{Math.round(ordersPerWeek * 4.33)}</dd></div>
							{fee ? <div><dt>Platform fee</dt><dd>{fee}% of margin</dd></div> : null}
							<div><dt>Per year</dt><dd>{money(monthly * 12)}</dd></div>
						</dl>
						{primaryCta("Start making money", `${s.ctaPrimary} ${s.ctaLight}`)}
					</div>
				</section>

				{/* ---------- themes ---------- */}
				<section aria-labelledby="sell-themes" className={s.section}>
					<header className={s.sectionHead}>
						<span className={s.kicker}><Palette size={13} /> Store design</span>
						<h2 className={s.sectionTitle} id="sell-themes">A store that looks like <mark className={s.mark}>a brand</mark>, not a template</h2>
						<p className={s.sectionText}>Every theme is a complete storefront design - layout, type and colour - built for phones, tablets and desktops. Tap one to see your store in it.</p>
					</header>
					<div className={s.themeStudio}>
						<div className={s.themeSide}>
							<div aria-label="Pick a theme" className={s.themeGrid} ref={themeRow} role="group">
								{STORE_THEMES.map((key) => {
									const info = STORE_THEME_INFO[key];
									return (
										<button
											aria-pressed={theme === key}
											className={s.themeCard}
											key={key}
											onClick={() => setTheme(key)}
											style={{ "--theme-accent": info.accents[0], "--theme-bg": info.background } as React.CSSProperties}
											type="button"
										>
											<span aria-hidden="true" className={s.themeSwatch}><i /></span>
											<span className={s.themeCardText}>
												<strong>{info.label}</strong>
												<small>{info.description}</small>
											</span>
											<span className={s.themeMood}>{info.mood}</span>
										</button>
									);
								})}
							</div>
							<div className={s.themeMeta}>
								<p className={s.themeNote}><span className={s.liveDot} /> Live storefront - the real store, not a mock-up</p>
								<div aria-label="Theme preview device" className={s.deviceSwitch} role="group">
									{([["desktop", Monitor], ["tablet", Tablet], ["phone", Smartphone]] as const).map(([key, Icon]) => (
										<button aria-label={`${key[0].toUpperCase()}${key.slice(1)} preview`} aria-pressed={themeDevice === key} key={key} onClick={() => setThemeDevice(key)} type="button"><Icon size={16} /></button>
									))}
								</div>
							</div>
						</div>
						<div className={s.themeStage}>
							<StorePrototype
								accent={accent}
								device={themeDevice}
								host={host}
								name={draft.trim() || "Your Store"}
									path={`/${handle}`}
								theme={theme}
							/>
						</div>
					</div>
				</section>

				{/* ---------- features ---------- */}
				<section aria-labelledby="sell-features" className={s.section}>
					<header className={s.sectionHead}>
						<span className={s.kicker}>Everything included</span>
						<h2 className={s.sectionTitle} id="sell-features">The whole dropshipping stack, <mark className={s.mark}>in one place</mark></h2>
					</header>
					<FeatureBento address={`${host}/${handle}`} domain={draft.trim() ? `${handle}.com` : "yourbrand.com"} looks={data.products.slice(0, 8).map((item) => ({ id: item.id, imgSrc: item.imgSrc, salePrice: resellerPrice(item.price, "percent", margin, pricing).salePrice }))} storeName={draft.trim() || "Your Store"} product={{ imgSrc: spotlight?.imgSrc, profit: spotQuote?.net ?? perOrder, salePrice: spotQuote?.salePrice ?? 0, title: spotlight?.title ?? "Your best seller" }} theme={theme} />
				</section>

				{/* ---------- pricing ---------- */}
				<section aria-labelledby="sell-pricing" className={s.section} id="pricing">
					<header className={s.sectionHead}>
						<span className={s.kicker}>Pricing</span>
						<h2 className={`${s.sectionTitle} ${pr.title}`} id="sell-pricing"><span className={pr.titleLine}>Simple pricing. <mark className={`${s.mark} ${pr.noBreak}`}>{TRIAL_DAYS} days free.</mark></span> <span className={pr.titleLine}>Cancel any time.</span></h2>
						<p className={s.sectionText}>
							Your store, catalog, fulfilment and promo reels in one plan. No add-on apps, no hidden fees, and secure checkout.
						</p>
					</header>
					<div className={pr.wrap}>
						<PeriodSwitch onChange={setPeriod} value={period} />
						<div className={pr.grid}>
							{PLAN_KEYS.map((key) => {
								const plan = PLANS[key];
								const perMonth = monthlyCost(plan, period);
								const sales = saleProfit > 0 ? Math.ceil(perMonth / saleProfit) : 0;
								return (
									<article className={pr.plan} data-featured={key === "pro" || undefined} key={key}>
										<div className={pr.head}>
											<p className={pr.name}>{plan.name}{key === "pro" ? <span>Most popular</span> : null}</p>
											<p className={pr.blurb}>{plan.blurb}</p>
											<p className={pr.price}><strong>{usd(perMonth)}</strong> / month</p>
											<p className={pr.billed}>
												{period === "YEARLY"
													? <>{usd(plan.yearlyPrice)} billed yearly · <b>save {yearlySaving(plan)}%</b></>
													: "Billed monthly"}
											</p>
											{sales ? <p className={pr.covered}>Covered by {sales} {sales === 1 ? "sale" : "sales"} a month</p> : null}
											{primaryCta(`Start ${TRIAL_DAYS}-day free trial`, `${s.ctaPrimary} ${styles.btnBlock} ${key === "pro" ? pr.ctaLime : pr.ctaQuiet}`, `Choose ${plan.name}`, "/seller?tab=billing", false, periodQuery(period))}
										</div>
										<ul className={pr.list}>
											{plan.features.map((item) => item.startsWith("Everything in")
												? <li className={pr.includes} key={item}>{item}, plus:</li>
												: <li key={item}><Check aria-hidden="true" /> {item}</li>)}
										</ul>
									</article>
								);
							})}
						</div>
						<p className={pr.note}>
							{saleProfit > 0 ? <span>Sales counted at +{money(saleProfit)} profit on our top product.</span> : null}{" "}
							{settings && fee
								? `Avokarto keeps just ${fee}% of your margin, and only when you make a sale.`
								: "Keep 100% of your margin on every sale."}
							{settings?.minPayout ? ` Payouts go straight to your bank once you reach ${money(settings.minPayout).replace(/\.00$/, "")}.` : " Payouts go straight to your bank."}
						</p>
					</div>
					<div aria-label="A typical dropshipping setup compared with Avokarto" className={s.compare} role="table">
						<div className={s.compareRow} role="row">
							<span role="columnheader" />
							<span className={s.compareHead} role="columnheader">Typical setup</span>
							<span className={`${s.compareHead} ${s.compareUs}`} role="columnheader">Avokarto</span>
						</div>
						{COMPARE.map(([label, them, us]) => (
							<div className={s.compareRow} key={label} role="row">
								<span className={s.compareLabel} role="rowheader">{label}</span>
								<span className={s.compareThem} role="cell"><Minus size={14} /> {them}</span>
								<span className={`${s.compareYes} ${s.compareUs}`} role="cell"><Check size={14} /> {us}</span>
							</div>
						))}
					</div>
				</section>

				{/* ---------- FAQ ---------- */}
				<section aria-labelledby="sell-faq" className={s.faqWrap} id="faq">
					<div className={s.faqAside}>
						<header className={s.sectionHead} style={{ justifyItems: "start", textAlign: "left" }}>
							<span className={s.kicker}><ShieldCheck size={13} /> Good to know</span>
							<h2 className={s.sectionTitle} id="sell-faq">Got questions? We&apos;ve got <mark className={s.mark}>answers</mark>.</h2>
							<p className={s.sectionText}>Try your store for {TRIAL_DAYS} days free. Compare <Link href="/pricing">plans and pricing</Link> before you start.</p>
						</header>
						<div className={s.helpCard}>
							<span className={s.signinIcon}><MessageCircle size={20} /></span>
							<div style={{ minWidth: 0 }}>
								<p className={s.cardTitle}>Still have questions?</p>
								<p className={styles.muted}>Ask us anything about selling on Avokarto, or browse the help center.</p>
							</div>
							<div className={s.helpActions}>
								<Link className={styles.ghost} href="/contact">Contact us</Link>
								<Link className={styles.ghost} href="/help-center">Help center</Link>
							</div>
						</div>
					</div>
					<div className={s.faqList}>
						{faqs.map(([question, answer], index) => (
							<details className={s.faq} key={question} open={index === 0}>
								<summary>
									{question}
									<ChevronDown size={18} />
								</summary>
								<p className={styles.muted}>{answer}</p>
							</details>
						))}
					</div>
				</section>

				{/* ---------- closing CTA ---------- */}
				<section aria-labelledby="sell-final" className={s.finalCta}>
					<LaunchBackdrop complete={hasStore || filled} />
					<div className={s.finalCopy}>
						<p className={s.finalKicker}>{hasStore ? "Ready when you are" : filled ? "All 4 steps ready" : "3 of 4 ready. Only your name is left"}</p>
						<h2 className={s.finalTitle} id="sell-final">
							<span className="visually-hidden">Your store could be live in the next minute.</span>
							<span aria-hidden="true">
								<span className={s.finalLine}>Your store could be</span>{" "}
								<span className={s.finalLine}>live in the <TypingWord words={FINAL_WORDS} />.</span>
							</span>
						</h2>
						<p className={s.heroText}><span>No stock, no shipping, no paid apps.</span> <span>Pick, post and get paid.</span></p>
					</div>
					<div className={hasStore ? s.finalActions : s.finalConsole}>
						{claimForm("final")}
						{hasStore ? null : <LaunchRail draft={draft.trim()} themeLabel={themeInfo.label} />}
					</div>
					<LaunchWall accent={accent} address={`${host}/${handle}`} background={themeInfo.background} name={draft.trim() || "Your Store"} products={data.products.slice(0, 10).map((product) => ({ id: product.id, imgSrc: product.imgSrc, salePrice: resellerPrice(product.price, "percent", margin, pricing).salePrice }))} />
				</section>

				{/* ---------- marketplace (secondary) ---------- */}
				<section className={s.market}>
					{marketShelf.length ? (
						<div aria-hidden="true" className={s.marketShelf}>
							{marketShelf.map((product) => <span className={s.marketTile} key={product.id}><ProductImage alt="" fit="contain" sizes="96px" src={product.imgSrc} /></span>)}
						</div>
					) : <span className={s.signinIcon}><ShoppingBag size={20} /></span>}
					<div className={s.marketCopy}>
						<p className={s.cardTitle}>Just here to shop?</p>
						<p className={styles.muted}>Browse every product on the Avokarto marketplace, or discover independent sellers&apos; stores.</p>
					</div>
					<div className={s.marketActions}>
						<Link className={s.marketShop} href="/marketplace">Shop the marketplace<ArrowRight aria-hidden="true" size={16} /></Link>
						<Link className={s.marketSellers} href="/sellers">Browse sellers</Link>
					</div>
				</section>
			</div>

			{/* ---------- footer ---------- */}
			<footer className={s.footer}>
				<div className={`${styles.container} ${s.footerGrid}`}>
					<div className={s.footerBrand}>
						<Link className={s.brand} href="/">
							<Image alt="" height={28} src="/assets/images/logo/avokarto-logo-mark.webp" width={28} />
							<span>avokarto</span>
						</Link>
						<p className={styles.muted}>Pick winning products, launch your store and post ready-made reels. We ship every order.</p>
					</div>
					{footerColumns.map(([title, links]) => (
						<nav aria-label={title} className={s.footerCol} key={title}>
							<p>{title}</p>
							{links.map(([href, label]) =>
								href.startsWith("#") ? <a href={href} key={href}>{label}</a> : <Link href={href} key={href}>{label}</Link>,
							)}
						</nav>
					))}
				</div>
				<p className={`${styles.container} ${s.copyright}`}>© {new Date().getFullYear()} Avokarto. All rights reserved.</p>
			</footer>

			{/* ---------- mobile sticky CTA ---------- */}
			<div className={s.stickyBar} data-show={stickyVisible || undefined} inert={!stickyVisible}>
				<span aria-hidden="true" className={s.stickyIcon}>{hasStore ? <Store size={18} /> : <Gift size={18} />}</span>
				<div className={s.stickyText}>
					<p className={s.stickyTitle}>{hasStore ? "Your store is ready" : "Start your free trial"}</p>
					<p className={s.stickySub}>{hasStore ? "Add products and share your link" : `${TRIAL_DAYS} days free · then from $${PLANS.starter.price}/mo`}</p>
				</div>
				{primaryCta("Try free", s.ctaNav, "Open", "/seller", true)}
			</div>
		</div>
	);
}
