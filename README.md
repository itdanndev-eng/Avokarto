# Avokarto Platform

The Avokarto dropshipping platform on its own: the seller funnel and
dashboard, reseller storefronts, the marketplace shoppers buy from, and the
admin console. Separated from the Unimart template it was built on - the
template's demo homepages, element showcases, blog/team/portfolio pages,
splash page and alternate product/shop layouts are not part of this
codebase.

## What's in it

| Area | Routes |
| --- | --- |
| Seller funnel | `/` (sell landing), `/start` (4-step store builder), `/store-preview` |
| Seller dashboard | `/seller` (home, catalog, orders, earnings, billing, settings) |
| Reseller stores | `/store/[handle]`, product, cart, checkout (also served on custom domains) |
| Marketplace | `/marketplace`, `/shop`, `/shop-by-*`, `/categories-list`, `/product/[slug]` |
| Shopper | `/cart`, `/checkout-*`, `/wishlist`, account pages (`/account-info`, `/my-*`), `/signin`, `/signup`, `/forgot-password` |
| Info | `/about`, `/contact`, `/faq-page-01`, `/help-center`, policies, `/sellers` |
| Admin | `/admin/*` (catalog, orders, resellers & payouts, customers, settings, reports) |
| API | `/api/*` (accounts, seller, stores, billing webhooks, uploads, realtime) |

Old template URLs still resolve: `/product-single-*/:id` redirects to
`/product/:id` (next.config.ts) and the other retired demo paths redirect
home (proxy.ts).

Everything shown is live data. The admin dashboard's sales chart reads
orders (per month, or per week for the last 4 weeks; failed, cancelled and
refunded orders left out). Footer newsletter sign-ups are stored in
`newsletter_subscribers` (migration 035) - download them from Admin ->
Customers -> "Newsletter list".

## Requirements

- Node.js 22 or 24, npm 10+
- PostgreSQL (Supabase works: transaction pooler on 6543 for `DATABASE_URL`,
  session pooler on 5432 for `DATABASE_SESSION_URL` - realtime + migrations)
- Durable storage for `public/uploads`

Copy `.env.example` to `.env` and fill it in. `npm run deploy:env` checks a
production configuration without printing secrets.

## Develop

```bash
npm ci
npm run db:migrate
npm run dev            # Turbopack - fast refresh, ~0.5s start
```

If Turbopack ever reports "Failed to write app endpoint" after routes are
renamed or deleted, stop it, delete `.next`, and restart. `npm run
dev:webpack` runs the slower Webpack dev server, which matches the
production build exactly.

## Scripts

- `npm run dev` / `npm run dev:webpack` - development server
- `npm run build` / `npm run start` - production build and server
- `npm run lint`, `npm run typecheck`, `npm test` - quality checks
- `npm run db:migrate` - apply `database/migrations`
- `npm run deploy:check` - config check, lint, tests and build in one go
- `npm run audit:production` - high/critical advisories in production deps
- `npm run analyze` - production build with the bundle analyzer

## Deploy

Needs a persistent Node process (the realtime listener and file uploads
don't fit ephemeral serverless functions), PostgreSQL and durable
`public/uploads`. Set the real HTTPS origin in `NEXT_PUBLIC_SITE_URL`; keep
`SITE_INDEXABLE=false` everywhere except the live site.

```bash
npm run deploy:check
npm run start
```

Before launch, configure what a build can't verify:

- **Email** - `RESEND_API_KEY`, `EMAIL_FROM` (order mail, password-reset codes)
- **Billing (Kelviq)** - `KELVIQ_API_KEY`, `KELVIQ_WEBHOOK_SECRET`, optional
  `KELVIQ_PRODUCT_ID` (live prices, yearly option) and `KELVIQ_PLAN_*`, and the
  webhook at `/api/webhooks/kelviq`; then turn on "Require a subscription" in admin
- **Database** - production `DATABASE_URL` / `DATABASE_SESSION_URL`, migrations applied

See [docs/backend-deploy.md](docs/backend-deploy.md) for the full guide.
Don't run the demo seed on a live store.

See [docs/seo.md](docs/seo.md) for public pages, catalog pagination, sitemap
generation, search verification and production indexing settings.
