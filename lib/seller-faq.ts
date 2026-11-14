import { PLANS, TRIAL_DAYS } from "@/lib/billing/plans";

type Settings = {
  maxMarginPercent: number;
  platformFeePercent: number;
  holdDays: number;
  minPayout: number;
};

/** Shared by the visible landing FAQ and its server-rendered structured data. */
export function sellerFaqs(settings?: Settings | null): [string, string][] {
  const fee = settings?.platformFeePercent ?? 0;
  return [
    ["What is Avokarto?", "Avokarto is a dropshipping platform that combines a branded online store builder, a product catalog, ready-made promotional reels and order fulfilment. Sellers choose products and set their margins; Avokarto holds the stock, packs and ships orders."],
    ["What is dropshipping on Avokarto?", "You run your own online store without buying or holding stock. When a customer orders from your store, Avokarto packs and ships it from our inventory, and you earn the margin you set."],
    ["Can I shop on Avokarto without opening a store?", "Yes. The Avokarto marketplace is the shopping part of the platform. Customers can buy products directly from the catalog or browse independent sellers' stores without becoming a seller."],
    ["How much does it cost to start?", `Every plan starts with a ${TRIAL_DAYS}-day free trial. After the trial, plans start at $${PLANS.starter.price} USD a month. You do not buy product inventory upfront. Your card is checked when the trial starts and first charged when it ends.`],
    ["How does billing work?", "Plans are billed monthly through our secure checkout. Change plans, update your card or download receipts from Plan & billing in your dashboard. Review the plan price and trial details at checkout before subscribing."],
    ["Do I need any experience?", "You do not need coding experience. Pick products, choose a theme and share your store link. Ready-made product reels and the video studio help you create promotional content. Sales depend on your products, prices and marketing."],
    ["How do I earn?", `Set a margin on top of Avokarto's catalog price${settings ? `, up to ${settings.maxMarginPercent}%` : ""}${fee ? `; Avokarto keeps ${fee}% of that margin as its platform fee` : ""}. Your earnings become withdrawable once the order is delivered and its return window${settings ? ` of ${settings.holdDays} days` : ""} has passed.`],
    ["How do I get paid?", `Add your bank account, then request a payout from your dashboard${settings?.minPayout ? ` once your available balance reaches $${settings.minPayout.toFixed(2)} USD` : ""}. Every transfer comes with a reference you can check.`],
    ["What happens with returns and cancellations?", "Avokarto handles the return itself. Margins on cancelled or refunded orders are reversed automatically, which is why earnings wait for the return window before you can withdraw them."],
    ["Can I use my own brand and domain?", "Yes. Upload a logo and banner and choose one of 8 store themes. Pro and Scale plans also support connecting your own domain from the dashboard."],
    ["Can I cancel any time?", `Cancel from Plan & billing whenever you like. Cancel during the ${TRIAL_DAYS}-day trial to avoid the first subscription charge. Earnings you have already made remain subject to the normal delivery, return and payout rules.`],
  ];
}
