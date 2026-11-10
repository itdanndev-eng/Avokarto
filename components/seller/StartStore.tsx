"use client";

import { ArrowLeft, ArrowRight, Bell, Check, ChevronRight, CreditCard, Eye, Globe, Loader2, Lock, Maximize2, Monitor, MonitorSmartphone, Palette, Plus, RefreshCw, ShieldCheck, Shuffle, Smartphone, Store, Tablet, Truck, Wallet, X } from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useId, useRef, useState, useSyncExternalStore } from "react";
import ModalTriggerButton from "@/components/action-buttons/ModalTriggerButton";
import { useCustomerSession } from "@/hooks/use-customer-session";
import { useUiStore } from "@/context/uiStore";
import type { SellLandingProduct } from "@/lib/backend/sell-landing";
import { PLAN_KEYS, PLANS, TRIAL_DAYS, type PlanKey } from "@/lib/billing/plans";
import { resellerPrice } from "@/lib/resellerPricing";
import { STORE_NAME_EXAMPLES, storeNameIdeas, TAGLINE_EXAMPLES, taglineIdeas } from "@/lib/storeNameIdeas";
import { useTypedPlaceholder } from "@/hooks/useTypedPlaceholder";
import { STORE_THEME_INFO, STORE_THEMES, type StoreTheme } from "@/lib/storeThemes";
import ProductImage from "./ProductImage";
import ThemePicker from "./ThemePicker";
import DeviceScene from "./DeviceScene";
import { clearDraft, readDraftName, readDraftTheme, saveDraft } from "./storeDraft";
import { STORE_ACCENTS } from "./StoreForm";
import StorePrototype, { type PrototypeDevice } from "./StorePrototype";
import { money, sellerRequest, type SellerApiError, type SellerSettings, type SellerStore } from "./sellerApi";
import { useStoreHandle } from "./useStoreHandle";
import styles from "./seller.module.css";
import shared from "./sell.module.css";
import s from "./builder.module.css";
import d from "./device-scene.module.css";
import SetupWait from "./SetupWait";
import StoreLaunch, { type StoreLaunchPhase as LaunchPhase } from "./StoreLaunch";

type StoreState = { billing?: { configured: boolean; required: boolean }; settings: SellerSettings; store: SellerStore | null };

const STEPS = [
	{ short: "Name", title: "Name your store and claim its link", text: "Choose a name and a link you can share with shoppers" },
	{ short: "Look", title: "Choose how your store looks", text: "Pick a theme and a brand colour, and the preview changes as you go" },
	{ short: "Earnings", title: "Set what you earn on each sale", text: "Your margin is added to our price, and you can adjust it later" },
	{ short: "Plan", title: `Pick your plan. Try it free for ${TRIAL_DAYS} days.`, text: "Full access from today. Cancel any time before your trial ends and you won't pay a thing." },
] as const;
// Day the trial-ending reminder goes out (Kelviq's subscription.trial_will_end).
const REMINDER_DAY = TRIAL_DAYS - 2;

const noSubscribe = () => () => {};
function subscribeResize(onChange: () => void) {
	window.addEventListener("resize", onChange);
	return () => window.removeEventListener("resize", onChange);
}

/**
 * Opening a store as four short steps - name, look, earnings, plan - beside the
 * real storefront it creates, updating live. Picks up the name and theme a
 * visitor tried on the homepage; sends sellers who already have a store to
 * their dashboard. On phones the live store opens full screen on request.
 */
export default function StartStore({ examples, publicSettings = null }: { examples: SellLandingProduct[]; publicSettings?: SellerSettings | null }) {
	const id = useId();
	const router = useRouter();
	const { customer, hydrated, refresh } = useCustomerSession();
	const [loaded, setLoaded] = useState<StoreState | null>(null);
	const [loadError, setLoadError] = useState<string | null>(null);
	const state = customer ? loaded : null;
	// Signed out, the public marketplace rules stand in until the account exists.
	const settings = state?.settings ?? publicSettings ?? undefined;
	const openModal = useUiStore((ui) => ui.openSpecificBsModal);
	// Set when the account step interrupts setup; the plan step follows sign-up.
	const resumeAfterAccount = useRef(false);

	// Carried over from the homepage until the seller changes them.
	const draftName = useSyncExternalStore(noSubscribe, readDraftName, () => "");
	const draftTheme = useSyncExternalStore(noSubscribe, readDraftTheme, () => "" as const);
	const [typedName, setName] = useState<string | null>(null);
	const name = typedName ?? draftName;
	const link = useStoreHandle(name);
	// Name ideas follow what's typed ("Riya" -> "Riya & Co."); shuffle for more.
	// Picking an idea doesn't change what they're built on - only typing does.
	const [ideaRound, setIdeaRound] = useState(0);
	const [ideaSource, setIdeaSource] = useState<string | null>(null);
	const nameIdeas = storeNameIdeas(ideaSource ?? draftName, name, ideaRound);
	const [tagline, setTagline] = useState("");
	const [whatsapp, setWhatsapp] = useState("");
	const [pickedTheme, setTheme] = useState<StoreTheme | null>(null);
	const theme: StoreTheme = pickedTheme ?? (draftTheme || "minimal");
	// The colour follows the theme until the seller picks one.
	const [pickedAccent, setAccent] = useState<string | null>(null);
	const accent = pickedAccent ?? STORE_THEME_INFO[theme].accents[0];
	// Hovering a theme tries it on the store without choosing it.
	const [hoveredTheme, setHoveredTheme] = useState<StoreTheme | null>(null);
	const maxMargin = settings?.maxMarginPercent ?? 50;
	const [pickedMargin, setMargin] = useState<number | null>(null);
	const margin = Math.min(pickedMargin ?? maxMargin, maxMargin);
	// Dropmax-style: the plan is chosen during setup and checkout follows the launch.
	const [plan, setPlan] = useState<PlanKey>("pro");
	const [checkingOut, setCheckingOut] = useState(false);
	const [checkoutError, setCheckoutError] = useState<string | undefined>();
	const billingReady = Boolean(state?.billing?.configured);

	const [step, setStep] = useState(0);
	// Which way the last step change went, so the fields slide the same way.
	const [direction, setDirection] = useState<"forward" | "back">("forward");
	const [saving, setSaving] = useState(false);
	const [launchPhase, setLaunchPhase] = useState<LaunchPhase | null>(null);
	const [launchError, setLaunchError] = useState<string | undefined>();
	const [createdStore, setCreatedStore] = useState<SellerStore | null>(null);
	const createdStoreRef = useRef<SellerStore | null>(null);
	const launchRequestRef = useRef(false);
	const [error, setError] = useState<{ field?: string; message: string } | null>(null);
	const [pickedDevice, setDevice] = useState<PrototypeDevice | null>(null);
	const [previewOpen, setPreviewOpen] = useState(false);
	const narrow = useSyncExternalStore(subscribeResize, () => window.innerWidth < 992, () => false);
	// The full-screen preview exists only at phone/tablet widths; widening the window closes it.
	const sheetOpen = narrow && previewOpen;
	const host = useSyncExternalStore(noSubscribe, () => window.location.host, () => "avokarto.com");
	const headingRef = useRef<HTMLHeadingElement>(null);
	const nameInputRef = useRef<HTMLInputElement>(null);
	const pageRef = useRef<HTMLDivElement>(null);
	const sheetRef = useRef<HTMLDivElement>(null);
	const closePreviewRef = useRef<HTMLButtonElement>(null);
	const [furthestStep, setFurthestStep] = useState(0);
	const viewportHeight = useSyncExternalStore(subscribeResize, () => window.innerHeight, () => 900);
	const viewportWidth = useSyncExternalStore(subscribeResize, () => window.innerWidth, () => 1280);
	// One device up close; until one is picked, big screens show them all together.
	const device = pickedDevice ?? "phone";
	const panelRef = useRef<HTMLElement>(null);
	const firstRender = useRef(true);

	// An empty name field types out real-sounding examples (once the form,
	// not the loading screen, is showing - the input has to exist).
	const nameFieldShown = hydrated && !(customer && !state && !loadError) && step === 0;
	useTypedPlaceholder(nameInputRef, STORE_NAME_EXAMPLES, { active: nameFieldShown && !name });
	// The tagline gets the same: typed examples, plus ideas to tap.
	const taglineInputRef = useRef<HTMLInputElement>(null);
	const [taglineRound, setTaglineRound] = useState(0);
	const taglineSuggestions = taglineIdeas(tagline, taglineRound);
	// Optional, so it waits behind a button until it's wanted.
	const [taglineOpen, setTaglineOpen] = useState(false);
	const taglineShown = taglineOpen || tagline.length > 0;
	useTypedPlaceholder(taglineInputRef, TAGLINE_EXAMPLES, { active: nameFieldShown && taglineShown && !tagline });

	useEffect(() => {
		if (!hydrated) void refresh();
	}, [hydrated, refresh]);

	const customerId = customer?.sub;
	useEffect(() => {
		if (!customerId) return;
		let cancelled = false;
		sellerRequest<StoreState>("GET", "/api/seller/store")
			.then((next) => {
				if (cancelled) return;
				if (next.store) {
					router.replace("/seller");
					return;
				}
				setLoaded(next);
				if (resumeAfterAccount.current) {
					resumeAfterAccount.current = false;
					setFurthestStep((current) => Math.max(current, STEPS.length - 1));
					setDirection("forward");
					setStep(STEPS.length - 1);
				}
			})
			.catch((caught: Error) => {
				if (!cancelled) setLoadError(caught.message);
			});
		return () => {
			cancelled = true;
		};
	}, [customerId, router]);

	// Each new step's heading takes focus, so keyboard and screen-reader users start there.
	useEffect(() => {
		if (firstRender.current) {
			firstRender.current = false;
			return;
		}
		headingRef.current?.focus({ preventScroll: true });
		window.scrollTo({ top: 0, behavior: "instant" });
		panelRef.current?.scrollTo({ top: 0, behavior: "instant" });
	}, [step]);

	// Keep keyboard focus inside the preview and return it to the button that opened it.
	useEffect(() => {
		if (!sheetOpen) return;
		const opener = document.activeElement;
		const page = pageRef.current;
		if (page) page.inert = true;
		const overflow = document.body.style.overflow;
		document.body.style.overflow = "hidden";
		closePreviewRef.current?.focus({ preventScroll: true });
		const onKey = (event: KeyboardEvent) => {
			if (event.key === "Escape") {
				event.preventDefault();
				setPreviewOpen(false);
			}
			if (event.key !== "Tab") return;
			const items = Array.from(sheetRef.current?.querySelectorAll<HTMLElement>(
				'button:not([disabled]), a[href], input:not([disabled]), iframe[tabindex="0"], [tabindex="0"]',
			) ?? []).filter((item) => item.getClientRects().length > 0);
			const first = items[0];
			const last = items[items.length - 1];
			if (event.shiftKey && document.activeElement === first) {
				event.preventDefault(); last?.focus();
			} else if (!event.shiftKey && document.activeElement === last) {
				event.preventDefault(); first?.focus();
			}
		};
		window.addEventListener("keydown", onKey);
		return () => {
			if (page) page.inert = false;
			document.body.style.overflow = overflow;
			window.removeEventListener("keydown", onKey);
			if (opener instanceof HTMLElement && opener.isConnected) opener.focus({ preventScroll: true });
		};
	}, [sheetOpen]);

	useEffect(() => {
		if (launchPhase) window.scrollTo({ top: 0, behavior: "instant" });
	}, [launchPhase]);

	// The name and look survive a reload or a closed tab.
	const draftEdited = typedName !== null || pickedTheme !== null;
	useEffect(() => {
		if (!draftEdited || launchPhase) return;
		const timer = window.setTimeout(() => saveDraft(name, theme), 400);
		return () => window.clearTimeout(timer);
	}, [draftEdited, launchPhase, name, theme]);

	const nameOk = name.trim().length >= 2;
	// Signed out on the step before the plan: Continue becomes "save" (sign-up).
	const accountNext = hydrated && !customer && step === STEPS.length - 2;
	const stepReady = step === 0 ? nameOk && link.usable && !link.checking : true;

	async function applyBranding(opened: SellerStore) {
		try {
			if (theme !== opened.theme) {
				setLaunchPhase("branding");
				await sellerRequest("PATCH", "/api/seller/store/branding", { theme });
			}
			const completed = { ...opened, theme };
			createdStoreRef.current = completed;
			setCreatedStore(completed);
			clearDraft();
			setLaunchError(undefined);
			setLaunchPhase("ready");
		} catch (caught) {
			setLaunchError(caught instanceof Error ? caught.message : "Your store was created, but its look could not be saved.");
			setLaunchPhase("branding-error");
		}
	}

	async function retryBranding() {
		if (launchRequestRef.current || !createdStoreRef.current) return;
		launchRequestRef.current = true;
		setSaving(true);
		setLaunchError(undefined);
		setLaunchPhase("branding");
		try {
			await applyBranding(createdStoreRef.current);
		} finally {
			launchRequestRef.current = false;
			setSaving(false);
		}
	}

	function enterDashboard() {
		clearDraft();
		router.push("/seller?welcome=1");
	}

	// The store exists; its free trial starts on Kelviq's secure checkout.
	async function startTrial() {
		if (checkingOut) return;
		setCheckingOut(true);
		setCheckoutError(undefined);
		try {
			const { url } = await sellerRequest<{ url: string }>("POST", "/api/seller/billing/checkout", { plan });
			clearDraft();
			window.location.assign(url);
		} catch (caught) {
			setCheckingOut(false);
			setCheckoutError(caught instanceof Error ? caught.message : "Couldn't open checkout. Please try again.");
		}
	}

	async function next(event: React.FormEvent) {
		event.preventDefault();
		if (launchRequestRef.current) return;
		setError(null);
		if (!nameOk) {
			setStep(0);
			setError({ field: "name", message: "Give your store a name (at least 2 characters)." });
			nameInputRef.current?.focus();
			return;
		}
		if (!link.usable || link.checking) {
			setStep(0);
			setError({ field: "handle", message: link.problem ?? link.message?.text ?? "Please wait while we check your link." });
			return;
		}
		// Name, look and margin need no account; the plan and the store itself do.
		// The sign-up popup opens here and setup carries on once it succeeds.
		if (!customer && step >= STEPS.length - 2) {
			saveDraft(name, theme);
			resumeAfterAccount.current = true;
			openModal("signupModal");
			return;
		}
		if (step < STEPS.length - 1) {
			setFurthestStep((current) => Math.max(current, step + 1));
			setDirection("forward");
			setStep(step + 1);
			return;
		}
		// Guard synchronously: two submit events must never create two requests.
		launchRequestRef.current = true;
		setSaving(true);
		setPreviewOpen(false);
		setLaunchError(undefined);
		setLaunchPhase("creating");
		saveDraft(name, theme);
		try {
			const opened = await sellerRequest<SellerStore>("POST", "/api/seller/store", {
				accentColor: accent,
				defaultMarginPercent: margin,
				handle: link.handle,
				name: name.trim(),
				tagline: tagline.trim(),
				whatsapp: whatsapp.trim(),
			});
			createdStoreRef.current = opened;
			setCreatedStore(opened);
			await applyBranding(opened);
		} catch (caught) {
			const apiError = caught as SellerApiError;
			// A lost response can still mean the server created the store. Recover
			// that result before offering another create attempt.
			if (apiError.code === "NETWORK") {
				const recovered = await sellerRequest<StoreState>("GET", "/api/seller/store").catch(() => null);
				if (recovered?.store) {
					createdStoreRef.current = recovered.store;
					setCreatedStore(recovered.store);
					await applyBranding(recovered.store);
					return;
				}
			}
			setLaunchPhase(null);
			setError({ field: apiError.field, message: apiError.message });
			if (apiError.field === "name" || apiError.field === "handle") setStep(0);
		} finally {
			launchRequestRef.current = false;
			setSaving(false);
		}
	}

	const swatches = [...new Set([...STORE_THEME_INFO[theme].accents, ...STORE_ACCENTS].map((colour) => colour.toUpperCase()))].slice(0, 9);
	const earn = (price: number) => resellerPrice(price, "percent", margin, { maxMarginPercent: maxMargin, platformFeePercent: settings?.platformFeePercent ?? 0 });
	const averageEarn = examples.length ? examples.reduce((sum, product) => sum + earn(product.price).net, 0) / examples.length : 0;

	const storeFocus = step === 2 ? "products" : "top";
	const trying = step === 1 ? hoveredTheme : null;
	const shownTheme = trying ?? theme;
	const shownAccent = trying ? STORE_THEME_INFO[trying].accents[0] : accent;
	const changeKey = `${name}|${shownTheme}|${shownAccent}|${margin}`;
	function surpriseMe() {
		const others = STORE_THEMES.filter((key) => key !== theme);
		const next = others[Math.floor(Math.random() * others.length)];
		const colours = STORE_THEME_INFO[next].accents;
		setTheme(next);
		setAccent(colours[Math.floor(Math.random() * colours.length)]);
	}
	const prototype = (
		<StorePrototype
			accent={shownAccent}
			device={device}
			focus={storeFocus}
			host={host}
			margin={margin}
			maxHeight={Math.max(240, narrow ? Math.min(580, viewportHeight - 320) : viewportHeight - 296)}
			name={name.trim() || "Your Store"}
			path={`/store/${link.handle || "your-store"}`}
			theme={shownTheme}
		/>
	);

	const gate = (() => {
		if (!hydrated || (customer && !state && !loadError)) return <SetupWait kind="studio" />;
		if (loadError) return <p className={styles.alert} role="alert">{loadError}</p>;
		if (settings && !settings.signupsOpen) return <p className={styles.notice}>New stores are paused right now. Please check back soon.</p>;
		return null;
	})();

	const themeInfo = STORE_THEME_INFO[theme];
	const deviceControls = (
		<div aria-label="Preview device" className={s.deviceSwitch} role="group">
			{([["desktop", Monitor], ["tablet", Tablet], ["phone", Smartphone]] as const).map(([key, Icon]) => (
				<button aria-label={`${key === "desktop" ? "Desktop" : key === "tablet" ? "Tablet" : "Phone"} preview`} aria-pressed={device === key} key={key} onClick={() => setDevice(key)} title={`${key} preview`} type="button"><Icon size={17} /></button>
			))}
		</div>
	);
	const modeControls = (
		<div aria-label="Preview device" className={d.modes} role="group">
			{([[null, MonitorSmartphone, "All devices"], ["desktop", Monitor, "Laptop"], ["tablet", Tablet, "Tablet"], ["phone", Smartphone, "Phone"]] as const).map(([key, Icon, label]) => (
				<button aria-label={`${label} preview`} aria-pressed={pickedDevice === key} key={label} onClick={() => setDevice(key)} title={label} type="button"><Icon size={16} /><span>{label}</span></button>
			))}
		</div>
	);
	const done = (index: number) => (furthestStep > index ? <Check size={12} /> : null);
	const buildSummary = (
		<dl aria-label="Your store so far" className={`${s.dock} ${d.summary}`}>
			<div data-current={step === 0 || undefined}><dt>Store {done(0)}</dt><dd><span>{name.trim() || "Your store"}</span></dd></div>
			<div data-current={step === 1 || undefined}><dt>Look {done(1)}</dt>{furthestStep >= 1 ? <dd><span className={s.dockDot} style={{ background: accent }} /><span>{themeInfo.label}</span></dd> : <dd data-empty=""><span>Not set</span></dd>}</div>
			<div data-current={step === 2 || undefined}><dt>Margin {done(2)}</dt>{furthestStep >= 2 ? <dd><span>{margin}%</span></dd> : <dd data-empty=""><span>Not set</span></dd>}</div>
			<div data-current={step === 3 || undefined}><dt>Plan</dt>{furthestStep >= 3 ? <dd><span>{PLANS[plan].name}</span></dd> : <dd data-empty=""><span>Not set</span></dd>}</div>
		</dl>
	);

	if (launchPhase) {
		return (
			<div className={`${styles.page} ${shared.landing} ${s.launchRoot}`}>
				<StoreLaunch
					accent={createdStore?.accentColor ?? accent}
					error={launchError}
					handle={createdStore?.handle ?? link.handle}
					host={host}
					margin={createdStore?.defaultMarginPercent ?? margin}
					name={createdStore?.name ?? name.trim()}
					onDashboard={enterDashboard}
					onRetryBranding={retryBranding}
					primaryAction={billingReady ? {
						busy: checkingOut,
						error: checkoutError,
						label: `Start my ${TRIAL_DAYS}-day free trial`,
						note: `${PLANS[plan].name} plan - $0 today, then $${PLANS[plan].price}/month. You'll confirm on our secure checkout; cancel any time.`,
						onClick: () => void startTrial(),
					} : undefined}
					phase={launchPhase}
					theme={launchPhase === "ready" ? createdStore?.theme ?? theme : theme}
					wide={viewportWidth >= 1680}
				/>
			</div>
		);
	}

	return (
		<div className={`${styles.page} ${shared.landing} ${s.start}`} data-setup-step={step + 1}>
			<div aria-hidden="true" className={s.studioBackdrop} />
			<div ref={pageRef}>
				<header className={s.obTop}>
					<div className={s.topInner}>
						<Link aria-label="Avokarto home" className={s.brand} href="/">
							<Image alt="" height={30} src="/assets/images/logo/avokarto-logo-mark.webp" width={30} />
							<span>avokarto<small>Store studio</small></span>
						</Link>
						<nav aria-label="Store setup progress" className={s.stepNav}>
							<ol className={s.obSteps}>
								{STEPS.map((item, index) => (
									<li data-current={index === step || undefined} data-done={index < furthestStep || undefined} key={item.short}>
										<button aria-current={index === step ? "step" : undefined} aria-label={item.short} disabled={Boolean(gate) || index > furthestStep || saving || (index > step && (!nameOk || !link.usable || link.checking))} onClick={() => { setError(null); setDirection(index < step ? "back" : "forward"); setStep(index); }} type="button">
											<span className={s.obStepDot}>{index < furthestStep && index !== step ? <Check size={14} /> : index + 1}</span>
											<span className={s.obStepLabel}>{item.short}</span>
										</button>
										{index < STEPS.length - 1 ? <ChevronRight aria-hidden="true" className={s.stepConnector} size={14} /> : null}
									</li>
								))}
							</ol>
						</nav>
						<div className={s.topActions}>
							<span className={s.freeBadge}><ShieldCheck size={14} /> {TRIAL_DAYS}-day free trial</span>
							<Link aria-label="Save and exit to the homepage" className={s.startBack} href="/" onClick={() => saveDraft(name, theme)}><X size={16} /><span>Exit</span></Link>
						</div>
					</div>
				</header>

				<div className={s.obGrid}>
					{narrow ? (
						<div className={s.stageBand}>
							<div className={d.stage}>
								<div className={d.bar}>
									<span aria-hidden="true" className={s.stageUrl}><Lock size={12} /><span>{host}/store/<b>{link.handle || "your-store"}</b></span></span>
									<button aria-haspopup="dialog" aria-label="Preview your store" className={s.previewLink} onClick={() => setPreviewOpen(true)} type="button"><Maximize2 size={15} /><span>Preview</span></button>
								</div>
								<div aria-hidden="true" className={d.sceneSlot}><DeviceScene accent={shownAccent} changeKey={changeKey} focus={storeFocus} margin={margin} name={name.trim() || "Your Store"} theme={shownTheme} /></div>
							</div>
						</div>
					) : null}
					<section aria-labelledby={`${id}-title`} className={s.obPanel} ref={panelRef}>
						<div className={s.obHead} key={`chapter-${step}`}>
							<span className={s.obCount}>Step {step + 1} of {STEPS.length} <span>· {["About a minute to go", "Under a minute to go", "Almost there", "Last step"][step]}</span>{draftEdited ? <span className={s.savedNote}><Check size={12} /> Name and look saved</span> : null}</span>
							<h1 className={s.obTitle} id={`${id}-title`} ref={headingRef} tabIndex={-1}>{gate ? "Your own store starts here" : STEPS[step].title.split(/(?<=\. )/).map((part) => <span className={s.titlePart} key={part}>{part}</span>)}</h1>
							<p className={s.sectionText}>{gate ? "We take care of the stock and shipping" : STEPS[step].text}</p>
						</div>
						{gate ?? (
							<form className={s.obForm} data-dir={direction} noValidate onSubmit={next}>
								<div className={s.formBody}>
									{step === 0 ? (
										<div className={s.obFields} key="name">
											<div className={s.obField}>
												<div className={s.fieldLabel}><label htmlFor={`${id}-name`}>Store name</label><span>{name.length}/60</span></div>
												<input aria-describedby={error?.field === "name" ? `${id}-error` : undefined} aria-invalid={error?.field === "name" || undefined} autoCapitalize="words" autoComplete="organization" className={`${styles.input} ${s.obBigInput}`} enterKeyHint="next" id={`${id}-name`} maxLength={60} onChange={(event) => { setError(null); setName(event.target.value); setIdeaSource(event.target.value); }} placeholder="e.g. Trendora" ref={nameInputRef} value={name} />
												<div aria-label="Store name ideas" className={s.nameIdeas} role="group">
													<span className={s.nameIdeasLabel}>{nameIdeas.seed ? "Ideas for you" : "Need an idea?"}</span>
													<div className={s.nameIdeasRow} key={`${nameIdeas.seed ?? ""}-${ideaRound}`}>
														{nameIdeas.ideas.map((idea, index) => <button key={idea} onClick={() => { setError(null); setName(idea); }} style={{ "--i": index } as React.CSSProperties} type="button">{idea}</button>)}
														<button aria-label="Show more name ideas" className={s.nameShuffle} data-spin={ideaRound % 2 ? "a" : "b"} onClick={() => setIdeaRound((round) => round + 1)} title="More ideas" type="button"><RefreshCw size={15} /></button>
													</div>
												</div>
											</div>
											<div className={s.obField}>
												<label className={styles.label} htmlFor={`${id}-handle`}>Your link</label>
												<div className={s.obLink} data-state={error?.field === "handle" ? "bad" : link.checking ? "checking" : link.message?.ok === true ? "ok" : link.message?.ok === false ? "bad" : undefined}>
													<Globe aria-hidden="true" className={s.linkGlobe} size={16} /><span className={s.obLinkHost}>{host}/store/</span>
													<input aria-describedby={`${id}-handle-msg`} aria-invalid={error?.field === "handle" || link.message?.ok === false || undefined} autoCapitalize="none" autoCorrect="off" enterKeyHint="next" id={`${id}-handle`} inputMode="url" maxLength={40} onChange={(event) => { setError(null); link.setHandle(event.target.value); }} placeholder="your-store" spellCheck={false} value={link.handle} />
													<span aria-hidden="true" className={s.obLinkState}>{link.checking ? <Loader2 className={styles.spin} size={16} /> : link.message?.ok ? <Check size={16} /> : null}</span>
												</div>
												<p aria-live="polite" className={error?.field === "handle" ? styles.error : link.message?.ok === true ? styles.ok : link.message?.ok === false ? styles.error : s.fieldHint} id={`${id}-handle-msg`}>{error?.field === "handle" ? error.message : link.checking ? "Checking your store link…" : link.message?.text ?? link.checkError ?? "Your link, ready to share"}</p>
											</div>
											{taglineShown ? (
											<div className={s.obField}>
												<div className={s.fieldLabel}><label htmlFor={`${id}-tagline`}>Tagline <span className={s.optional}>Optional</span></label><span>{tagline.length}/140</span></div>
												<input autoCapitalize="sentences" className={styles.input} enterKeyHint="next" id={`${id}-tagline`} maxLength={140} onChange={(event) => setTagline(event.target.value)} placeholder="e.g. Trending finds, shipped to your door." ref={taglineInputRef} value={tagline} />
												<div aria-label="Tagline ideas" className={s.nameIdeas} role="group">
													<span className={s.nameIdeasLabel}>One line shoppers see first. Try:</span>
													<div className={s.nameIdeasRow} key={taglineRound}>
														{taglineSuggestions.map((idea, index) => <button key={idea} onClick={() => setTagline(idea)} style={{ "--i": index } as React.CSSProperties} type="button">{idea}</button>)}
														<button aria-label="Show more tagline ideas" className={s.nameShuffle} data-spin={taglineRound % 2 ? "a" : "b"} onClick={() => setTaglineRound((round) => round + 1)} title="More ideas" type="button"><RefreshCw size={15} /></button>
													</div>
												</div>
											</div>
											) : (
												<button className={s.addField} onClick={() => { setTaglineOpen(true); requestAnimationFrame(() => taglineInputRef.current?.focus()); }} type="button"><Plus size={16} /> Add a tagline <span className={s.optional}>Optional</span></button>
											)}
										</div>
									) : null}

									{step === 1 ? (
										<div className={s.obFields} key="look">
											<div className={s.fieldLabel}><span>8 themes, all mobile ready</span><button className={s.surprise} onClick={surpriseMe} type="button"><Shuffle size={14} /> Surprise me</button></div>
											<ThemePicker accent={accent} onHover={setHoveredTheme} onPick={(key) => { setTheme(key); setAccent(null); setHoveredTheme(null); }} theme={theme} />
											<p className={s.themeNote}>{themeInfo.label}: {themeInfo.description}</p>
											<div className={s.colourPanel}>
												<div className={s.fieldLabel}><span id={`${id}-colour`}>Brand colour</span><span className={s.colourValue}>{accent.toUpperCase()}</span></div>
												<div aria-labelledby={`${id}-colour`} className={s.obSwatches} role="group">
													{swatches.map((colour) => <button aria-label={`Colour ${colour}`} aria-pressed={accent.toUpperCase() === colour} className={s.obSwatch} key={colour} onClick={() => setAccent(colour)} style={{ "--swatch": colour } as React.CSSProperties} type="button">{accent.toUpperCase() === colour ? <Check size={15} /> : null}</button>)}
													<label className={s.obCustom} title="Custom colour"><Palette size={17} /><span className={s.srOnly}>Custom colour</span><input aria-label="Custom colour" onChange={(event) => setAccent(event.target.value.toUpperCase())} type="color" value={accent.toLowerCase()} /></label>
												</div>
												<p className={s.fieldHint}>Used on buttons, badges and highlights</p>
											</div>
										</div>
									) : null}

									{step === 2 ? (
										<div className={s.obFields} key="earn">
											<div className={s.obMargin}>
												<div className={s.obMarginHead}><div><label htmlFor={`${id}-margin`}>Your margin</label><p>You set the price. We handle fulfilment.</p></div><strong>{margin}<span>%</span></strong></div>
												<input aria-valuetext={`${margin}% margin`} className={shared.rangeInput} id={`${id}-margin`} max={maxMargin} min={0} onChange={(event) => setMargin(Number(event.target.value))} style={{ "--pct": `${maxMargin > 0 ? (margin / maxMargin) * 100 : 0}%` } as React.CSSProperties} type="range" value={margin} />
												<div aria-label="Quick picks" className={s.obPresets} role="group">{[10, 20, 30, maxMargin].filter((value, index, all) => value <= maxMargin && all.indexOf(value) === index).map((value) => <button aria-pressed={margin === value} key={value} onClick={() => setMargin(value)} type="button">{value}%</button>)}</div>
											</div>
											{examples.length ? <div className={s.earningsExamples}><div className={s.fieldLabel}><span>What that looks like</span><span>Real catalog products</span></div><ul aria-label="What you'd earn on real products" className={s.obExamples}>{examples.map((product) => { const quote = earn(product.price); return <li key={product.id}><span className={s.obExampleImg}><ProductImage alt="" sizes="48px" src={product.imgSrc} /></span><span className={s.obExampleText}><strong>{product.title}</strong><small>Sells for {money(quote.salePrice)}</small></span><span className={s.obEarn}><small>You earn</small>{money(quote.net)}</span></li>; })}</ul></div> : null}
											{averageEarn > 0 ? <div className={s.obEstimate}><span className={s.estimateIcon}><Wallet size={19} /></span><div><span>At 10 sales a week, that’s about</span><strong>{money(averageEarn * 10 * 4.33)} <small>/ month</small></strong><p>An estimate based on these products, not a promise</p></div></div> : null}
											<label className={s.obField}><span className={styles.label}>WhatsApp number <span className={s.optional}>Optional</span></span><input aria-describedby={`${id}-whatsapp-note`} aria-invalid={error?.field === "whatsapp" || undefined} autoComplete="tel" className={styles.input} inputMode="tel" maxLength={20} onChange={(event) => setWhatsapp(event.target.value.replace(/[^\d+ ]/g, ""))} placeholder="+91 98765 43210" value={whatsapp} /><span className={s.fieldHint} id={`${id}-whatsapp-note`}>Lets shoppers reach you with a quick message</span></label>
										</div>
									) : null}
									{step === 3 ? (
										<div className={s.obFields} key="plan">
											<div aria-label="Plan" className={s.planPick} role="radiogroup">
												{PLAN_KEYS.map((key) => {
													const option = PLANS[key];
													return (
														<button aria-checked={plan === key} className={s.planOption} data-popular={key === "pro" || undefined} key={key} onClick={() => setPlan(key)} role="radio" type="button">
															<span className={s.planOptionHead}>
																<span className={s.planRadio} aria-hidden="true">{plan === key ? <Check size={12} strokeWidth={3} /> : null}</span>
																<strong>{option.name}</strong>
																{key === "pro" ? <span className={s.planPopular}>Most popular</span> : null}
																<span className={s.planOptionPrice}><b>${option.price}</b>/mo</span>
															</span>
															<span className={s.planOptionBlurb}>{option.blurb}</span>
															<span className={s.planOptionFeatures}>
																{option.features.slice(0, 3).map((feature) => <span key={feature}><Check size={12} /> {feature}</span>)}
															</span>
														</button>
													);
												})}
											</div>
											{/* How the trial runs, so nothing about the first charge is a surprise. */}
											<ol aria-label="How your free trial works" className={s.trialTimeline}>
												<li><span className={s.trialDot}><Store size={14} /></span><div><strong>Today</strong><small>Your store opens with full {PLANS[plan].name} access. $0 due.</small></div></li>
												<li><span className={s.trialDot}><Bell size={14} /></span><div><strong>Day {REMINDER_DAY}</strong><small>We remind you before your trial ends.</small></div></li>
												<li><span className={s.trialDot}><CreditCard size={14} /></span><div><strong>Day {TRIAL_DAYS}</strong><small>${PLANS[plan].price}/month starts. Cancel before then and pay nothing.</small></div></li>
											</ol>
											<p className={s.trialSecure}><Lock size={13} /> {billingReady ? "Secure checkout right after your store opens." : "Billing opens soon - your store opens today either way."}</p>
										</div>
									) : null}
									{error ? <p className={styles.alert} id={`${id}-error`} role="alert">{error.message}</p> : null}
									{accountNext ? (
										<div className={s.accountNext}>
											<span className={s.accountNextIcon}><Lock size={15} /></span>
											<p><strong>Next, save your store.</strong> Just an email and a password - everything you&apos;ve set up stays exactly as it is.</p>
											<ModalTriggerButton className={s.accountNextLink} onClick={() => { saveDraft(name, theme); resumeAfterAccount.current = true; }} openModalName="signinModal">I have an account</ModalTriggerButton>
										</div>
									) : null}
									<div className={s.setupAssurance}><span><ShieldCheck size={14} /> {TRIAL_DAYS} days free</span><span><Truck size={14} /> We ship every order</span><span><Palette size={14} /> Make it your own</span></div>
								</div>
								<div className={s.obActions}>
									{step > 0 ? <button aria-label="Back" className={s.obBack} disabled={saving} onClick={() => { setError(null); setDirection("back"); setStep(step - 1); }} type="button"><ArrowLeft size={17} /><span>Back</span></button> : <span className={s.actionHint}><ShieldCheck size={14} /> {TRIAL_DAYS} days free · cancel any time</span>}
									{narrow ? <button aria-haspopup="dialog" aria-label="Preview your store" className={s.obPeek} onClick={() => setPreviewOpen(true)} title="Preview your store" type="button"><Eye size={18} /></button> : null}
									<button className={`${shared.ctaPrimary} ${s.obNext}`} disabled={!stepReady || saving} type="submit">{saving ? <Loader2 className={styles.spin} size={18} /> : null}{accountNext ? <>Save my store <ArrowRight size={17} /></> : step < STEPS.length - 1 ? <><span>Continue<span className={s.nextTo}> to {STEPS[step + 1].short}</span></span> <ArrowRight size={17} /></> : saving ? "Opening your store…" : <>{billingReady ? "Open store & start trial" : "Open my store"} <ArrowRight size={17} /></>}</button>
								</div>
							</form>
						)}
					</section>

					{!narrow ? <aside aria-label="Live preview of your store" className={s.obPreview}><div className={s.obPreviewBar}><div><h2><span className={`${s.liveDot} ${s.liveBeat}`} key={changeKey} /> Live preview</h2><span className={s.previewChapter}>{trying ? `Trying ${STORE_THEME_INFO[trying].label}. Click to keep it` : ["Your store updates as you type", "Try a theme and the whole store changes", "Prices update with your margin", "This is what opens today"][step]}</span></div><span aria-hidden="true" className={`${s.stageUrl} ${d.canvasUrl}`}><Lock size={12} /><span>{host}/store/<b>{link.handle || "your-store"}</b></span></span>{modeControls}</div><div className={s.studioStage}>
						{pickedDevice ? (
							<div className={d.single} style={{ "--accent": shownAccent } as React.CSSProperties}><span className={d.floor} /><span className={d.light} /><div className={s.previewCanvas}>{prototype}</div></div>
						) : (
							<div className={d.sceneSlot}><DeviceScene accent={shownAccent} changeKey={changeKey} focus={storeFocus} margin={margin} name={name.trim() || "Your Store"} onPick={setDevice} tablet={viewportWidth >= 1680} theme={shownTheme} /></div>
						)}
						{buildSummary}
					</div></aside> : null}
				</div>
			</div>
			{sheetOpen ? <div aria-label="Live preview of your store" aria-modal="true" className={s.obSheet} ref={sheetRef} role="dialog"><div className={s.obSheetBar}><div><span className={s.previewEyebrow}>Your storefront</span><h2><span className={s.liveDot} /> Live preview</h2></div><button aria-label="Close preview" className={s.obSheetClose} onClick={() => setPreviewOpen(false)} ref={closePreviewRef} type="button"><X size={20} /></button></div><div className={s.sheetDevices}>{deviceControls}<span>See it on every screen</span></div><div className={s.obSheetBody}>{prototype}</div><div className={s.obSheetFoot}>{buildSummary}</div></div> : null}
		</div>
	);
}
