-- Seller subscriptions move from Whop to Kelviq (lib/backend/billing.ts).
-- Whop never went live, so the columns are renamed rather than migrated:
-- the row now mirrors a Kelviq subscription, and webhook deliveries are
-- deduplicated in a provider-neutral table.

ALTER TABLE seller_subscriptions RENAME COLUMN whop_membership_id TO provider_subscription_id;
ALTER TABLE seller_subscriptions RENAME COLUMN whop_updated_at TO provider_updated_at;
ALTER TABLE seller_subscriptions RENAME CONSTRAINT seller_subscriptions_whop_membership_id_key TO seller_subscriptions_provider_subscription_id_key;

-- MONTHLY or YEARLY, as the seller chose at checkout.
ALTER TABLE seller_subscriptions ADD COLUMN IF NOT EXISTS charge_period text NOT NULL DEFAULT 'MONTHLY';
-- When the seller's last reconciliation against Kelviq ran.
ALTER TABLE seller_subscriptions ADD COLUMN IF NOT EXISTS synced_at timestamptz;

ALTER TABLE whop_webhook_events RENAME TO billing_webhook_events;
ALTER TABLE billing_webhook_events RENAME CONSTRAINT whop_webhook_events_pkey TO billing_webhook_events_pkey;
