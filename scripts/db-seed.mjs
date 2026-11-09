import path from "node:path";
import process from "node:process";
import { randomBytes } from "node:crypto";
import bcrypt from "bcryptjs";
import pg from "pg";

const { Pool } = pg;

// Local runs pick up .env; variables already set (host secrets, CI, a
// one-off `DATABASE_URL=… npm run db:seed`) take precedence over it.
try {
	process.loadEnvFile(path.join(process.cwd(), ".env"));
} catch (error) {
	if (error.code !== "ENOENT") throw error;
}

// Migrations and seeding run multi-statement sessions, so they use the
// session connection when DATABASE_URL is a transaction pooler.
const databaseUrl = process.env.DATABASE_SESSION_URL?.trim() || process.env.DATABASE_URL;

if (!databaseUrl) {
	console.error("DATABASE_URL is required to seed data.");
	process.exit(1);
}

// Demo data and a default-password admin must never land on a live store
// by accident (e.g. a .env pointing at a hosted database): anything but a
// local database needs an explicit --allow-remote.
let databaseHost;
try {
	databaseHost = new URL(databaseUrl).hostname;
} catch {
	console.error("DATABASE_URL is not a valid connection URL.");
	process.exit(1);
}
const isLocal = ["localhost", "127.0.0.1", "::1", "[::1]"].includes(databaseHost);
console.log(`Seeding database at ${databaseHost}`);
if (!isLocal && !process.argv.includes("--allow-remote")) {
	console.error(
		`Refusing to seed demo data into a non-local database (${databaseHost}).\n` +
			"If this is really a disposable database, run: npm run db:seed -- --allow-remote",
	);
	process.exit(1);
}

const ssl =
	process.env.DATABASE_SSL === "true"
		? { rejectUnauthorized: false }
		: process.env.DATABASE_SSL === "false" ||
				databaseUrl.includes("localhost") ||
				databaseUrl.includes("127.0.0.1")
			? undefined
			: { rejectUnauthorized: false };

const pool = new Pool({ connectionString: databaseUrl, ssl });

const adminEmail = (process.env.ADMIN_BOOTSTRAP_EMAIL ?? "admin@avokarto.local")
	.trim()
	.toLowerCase();
// No built-in default password: a shared default is public the moment the
// source is. Without ADMIN_BOOTSTRAP_PASSWORD a random one is generated and
// shown once, for this run only; set a real one with npm run admin:password.
const generatedPassword = !process.env.ADMIN_BOOTSTRAP_PASSWORD?.trim();
const adminPassword = process.env.ADMIN_BOOTSTRAP_PASSWORD?.trim() || randomBytes(18).toString("base64url");

const categories = [
	["Headphones", "headphones", "published", "/assets/images/catagory-img/cat-bg-headphones-01.webp"],
	["Vintage Clothing", "vintage-clothing", "published", "/assets/images/product-img/fashion/product-new-01-a-1.webp"],
	["Urban Apparel", "urban-apparel", "published", "/assets/images/product-img/fashion/product-new-02-a-1.webp"],
	["Casual Wear", "casual-wear", "published", "/assets/images/product-img/fashion/product-new-03-a-1.webp"],
	["Summer Fashion", "summer-fashion", "published", "/assets/images/product-img/fashion/product-new-04-a-1.webp"],
];

const brands = [
	["Acme", "acme", "acme.example", "AC", "Featured", "published", "bg-brand-50 text-brand-600"],
	["Hamofy", "hamofy", "hamofy.example", "HA", "Featured", "published", "bg-success-50 text-success-600"],
	["UrbanWear", "urbanwear", "urbanwear.shop", "UW", "Standard", "published", "bg-accent-50 text-accent-700"],
	["Superga", "superga", "superga.example", "SG", "Standard", "published", "bg-warning-50 text-warning-600"],
];

const products = [
	{
		legacyId: 271,
		sku: "FASH-271",
		name: "Nirvana Graphic Oversized Sweatshirt",
		slug: "nirvana-graphic-oversized-sweatshirt",
		categorySlug: "vintage-clothing",
		brandSlug: "acme",
		image: "/assets/images/product-img/fashion/product-new-01-a-1.webp",
		hoverImage: "/assets/images/product-img/fashion/product-new-01-a-2.webp",
		price: 138.07,
		oldPrice: 201.56,
		stock: 510,
		status: "published",
		rating: 4,
		reviewCount: 397,
		badge: "NEW ARRIVAL",
		tags: ["top-rated", "new", "popular", "best-color", "best-seller"],
		colors: ["Brown", "Gray", "Blue", "Green"],
		sizes: ["M", "L"],
		services: ["Free Delivery", "Cash On Delivery", "Installment"],
		demoTab: ["this-week", "this-month", "this-year"],
	},
	{
		legacyId: 272,
		sku: "FASH-272",
		name: "Vibrant Tiger Cropped Graphic Tee",
		slug: "vibrant-tiger-cropped-graphic-tee",
		categorySlug: "urban-apparel",
		brandSlug: "urbanwear",
		image: "/assets/images/product-img/fashion/product-new-02-a-1.webp",
		hoverImage: "/assets/images/product-img/fashion/product-new-02-a-2.webp",
		price: 142.38,
		oldPrice: 208.16,
		stock: 320,
		status: "published",
		rating: 4,
		reviewCount: 434,
		badge: null,
		tags: ["featured", "top-item", "popular", "best-color"],
		colors: ["Black", "Brown", "Gray", "Blue", "Green", "Yellow"],
		sizes: ["M", "L"],
		services: ["Free Delivery", "Hot Deals", "Cash On Delivery", "Installment"],
		demoTab: ["this-week", "this-month"],
	},
	{
		legacyId: 273,
		sku: "FASH-273",
		name: "The Great Lakes Cozy Pullover",
		slug: "the-great-lakes-cozy-pullover",
		categorySlug: "casual-wear",
		brandSlug: "hamofy",
		image: "/assets/images/product-img/fashion/product-new-03-a-1.webp",
		hoverImage: "/assets/images/product-img/fashion/product-new-03-a-2.webp",
		price: 147.84,
		oldPrice: 216.46,
		stock: 188,
		status: "published",
		rating: 5,
		reviewCount: 471,
		badge: null,
		tags: ["featured", "top-item", "best-color"],
		colors: ["Black", "Blue", "Brown", "Gray", "Green"],
		sizes: ["M", "L"],
		services: ["Free Delivery", "Hot Deals", "Authentic Brands", "Cash On Delivery"],
		demoTab: ["this-month", "this-year"],
	},
	{
		legacyId: 274,
		sku: "FASH-274",
		name: "Lightweight Sleeveless Knit Crop Top",
		slug: "lightweight-sleeveless-knit-crop-top",
		categorySlug: "summer-fashion",
		brandSlug: "superga",
		image: "/assets/images/product-img/fashion/product-new-04-a-1.webp",
		hoverImage: "/assets/images/product-img/fashion/product-new-04-a-2.webp",
		price: 147.98,
		oldPrice: 216.98,
		stock: 17,
		status: "low stock",
		rating: 3,
		reviewCount: 7,
		badge: "LOW STOCK",
		tags: ["top-item", "popular", "top-rated", "best-seller"],
		colors: ["Black", "Blue", "Green", "Orange", "Red", "Yellow"],
		sizes: ["M", "L"],
		services: ["Free Delivery", "Hot Deals", "Cash On Delivery"],
		demoTab: ["this-week"],
	},
];

const customers = [
	["Mila Horton", "mila@example.com", "VIP", "active", "bg-brand-50 text-brand-600"],
	["Rafi Ahmed", "rafi@example.com", "Wholesale", "review", "bg-warning-50 text-warning-600"],
	["Neha Carter", "neha@example.com", "Retail", "active", "bg-success-50 text-success-600"],
];

const orders = [
	["13290", "mila@example.com", "Francis Mitcham", "delivering", 449, "unpaid"],
	["13291", "rafi@example.com", "Francis Mitcham", "completed", 136, "paid"],
	["13292", "neha@example.com", "Ana Crown", "delivering", 168, "paid"],
	["13297", "mila@example.com", "Robert Doe", "failed", 238, "unpaid"],
];

const coupons = [
	["SUMMER25", "Summer Essentials", "Applies to selected seasonal products", "percentage", 25, 49, 500, 318, "active", "2026-06-01", "2026-06-30", "bg-brand-50 text-brand-600"],
	["WELCOME10", "First Order Bonus", "New customers only", "fixed", 10, 0, 2000, 1204, "active", null, null, "bg-success-50 text-success-600"],
	["SHIPFREE", "Free Delivery Weekend", "Cart total over $49", "shipping", 0, 49, 300, 88, "scheduled", "2026-06-22", "2026-06-24", "bg-warning-50 text-warning-600"],
];

const shippingMethods = [
	["Standard Shipping", "Reliable ground delivery for everyday orders", "UPS", 10, 5, 7, "active", 1],
	["Express Shipping", "Faster delivery for time-sensitive orders", "FedEx", 25, 2, 3, "active", 2],
	["Free Economy", "Slowest option, no charge", "USPS", 0, 7, 10, "active", 3],
];

const reviews = [
	["nirvana-graphic-oversized-sweatshirt", "mila@example.com", "Robert Doe", 5, "Fresh quality and fast delivery.", "pending"],
	["the-great-lakes-cozy-pullover", "rafi@example.com", "Mikaela Collins", 4, "Great aroma, packaging was good.", "approved"],
	["vibrant-tiger-cropped-graphic-tee", "neha@example.com", "Amin Khan", 3, "Good mix, wanted more spicy items.", "draft"],
];

const tickets = [
	["TK-1042", "#TK-1042 Delivery delay", "mila@example.com", "Robert Doe", "High", "open", "Sumit Singh"],
	["TK-1041", "#TK-1041 Refund request", "rafi@example.com", "Mikaela Collins", "Medium", "pending", "Support Team"],
	["TK-1040", "#TK-1040 Product question", "neha@example.com", "Amin Khan", "Low", "resolved", "Support Team"],
];

const attributes = [
	["Color", "Swatch", ["Red", "Blue", "Green", "Black"], "active", 128],
	["Size", "Dropdown", ["XS", "S", "M", "L", "XL"], "active", 96],
	["Material", "Text", ["Cotton", "Steel", "Wood"], "draft", 44],
];

function placeholders(count, offset = 0) {
	return Array.from({ length: count }, (_, index) => `$${index + 1 + offset}`).join(", ");
}

const client = await pool.connect();

try {
	await client.query("BEGIN");

	const passwordHash = await bcrypt.hash(adminPassword, 12);
	await client.query(
		`
			INSERT INTO app_users (email, password_hash, name, role, status)
			VALUES ($1, $2, $3, 'admin', 'active')
			ON CONFLICT (email)
			DO UPDATE SET password_hash = EXCLUDED.password_hash, role = 'admin', status = 'active'
		`,
		[adminEmail, passwordHash, "Store Administrator"],
	);

	for (const [name, slug, status, image] of categories) {
		await client.query(
			`
				INSERT INTO categories (name, slug, status, image_url)
				VALUES ($1, $2, $3, $4)
				ON CONFLICT (slug)
				DO UPDATE SET name = EXCLUDED.name, status = EXCLUDED.status, image_url = EXCLUDED.image_url
			`,
			[name, slug, status, image],
		);
	}

	for (const [name, slug, website, initials, visibility, status, tileClass] of brands) {
		await client.query(
			`
				INSERT INTO brands (name, slug, website, initials, visibility, status, tile_class)
				VALUES ($1, $2, $3, $4, $5, $6, $7)
				ON CONFLICT (slug)
				DO UPDATE SET name = EXCLUDED.name, website = EXCLUDED.website, initials = EXCLUDED.initials,
					visibility = EXCLUDED.visibility, status = EXCLUDED.status, tile_class = EXCLUDED.tile_class
			`,
			[name, slug, website, initials, visibility, status, tileClass],
		);
	}

	for (const product of products) {
		await client.query(
			`
				INSERT INTO products (
					legacy_id, sku, name, slug, category_id, brand_id, image_url, hover_image_url,
					price, old_price, stock, status, rating, review_count, storefront_badge,
					tags, filter_color, filter_sizes, services, demo_tab
				)
				VALUES (
					$1, $2, $3, $4,
					(SELECT id FROM categories WHERE slug = $5),
					(SELECT id FROM brands WHERE slug = $6),
					$7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20
				)
				ON CONFLICT (sku)
				DO UPDATE SET name = EXCLUDED.name, slug = EXCLUDED.slug, category_id = EXCLUDED.category_id,
					brand_id = EXCLUDED.brand_id, image_url = EXCLUDED.image_url, hover_image_url = EXCLUDED.hover_image_url,
					price = EXCLUDED.price, old_price = EXCLUDED.old_price, stock = EXCLUDED.stock, status = EXCLUDED.status,
					rating = EXCLUDED.rating, review_count = EXCLUDED.review_count, storefront_badge = EXCLUDED.storefront_badge,
					tags = EXCLUDED.tags, filter_color = EXCLUDED.filter_color, filter_sizes = EXCLUDED.filter_sizes,
					services = EXCLUDED.services, demo_tab = EXCLUDED.demo_tab
			`,
			[
				product.legacyId,
				product.sku,
				product.name,
				product.slug,
				product.categorySlug,
				product.brandSlug,
				product.image,
				product.hoverImage,
				product.price,
				product.oldPrice,
				product.stock,
				product.status,
				product.rating,
				product.reviewCount,
				product.badge,
				product.tags,
				product.colors,
				product.sizes,
				product.services,
				product.demoTab,
			],
		);
	}

	for (const [name, email, segment, status, avatarClass] of customers) {
		await client.query(
			`
				INSERT INTO customers (name, email, segment, status, avatar_class)
				VALUES ($1, $2, $3, $4, $5)
				ON CONFLICT (email)
				DO UPDATE SET name = EXCLUDED.name, segment = EXCLUDED.segment, status = EXCLUDED.status,
					avatar_class = EXCLUDED.avatar_class
			`,
			[name, email, segment, status, avatarClass],
		);
	}

	for (const [orderNumber, customerEmail, customerName, status, total, paymentStatus] of orders) {
		await client.query(
			`
				INSERT INTO orders (order_number, customer_id, customer_name, status, total, payment_status)
				VALUES ($1, (SELECT id FROM customers WHERE email = $2), $3, $4, $5, $6)
				ON CONFLICT (order_number)
				DO UPDATE SET customer_id = EXCLUDED.customer_id, customer_name = EXCLUDED.customer_name,
					status = EXCLUDED.status, total = EXCLUDED.total, payment_status = EXCLUDED.payment_status
			`,
			[orderNumber, customerEmail, customerName, status, total, paymentStatus],
		);
	}

	for (const product of products.slice(0, 3)) {
		await client.query(
			`
				INSERT INTO order_items (order_id, product_id, product_name, sku, image_url, qty, unit_price)
				SELECT o.id, p.id, p.name, p.sku, p.image_url, 1, p.price
				FROM orders o
				JOIN products p ON p.sku = $1
				WHERE o.order_number = '13290'
				AND NOT EXISTS (
					SELECT 1 FROM order_items oi WHERE oi.order_id = o.id AND oi.sku = p.sku
				)
			`,
			[product.sku],
		);
	}

	for (const coupon of coupons) {
		await client.query(
			`
				INSERT INTO coupons (
					code, name, summary, type, discount_value, minimum_order, usage_limit,
					used_count, status, starts_at, ends_at, icon_class
				)
				VALUES (${placeholders(coupon.length)})
				ON CONFLICT (code)
				DO UPDATE SET name = EXCLUDED.name, summary = EXCLUDED.summary, type = EXCLUDED.type,
					discount_value = EXCLUDED.discount_value, minimum_order = EXCLUDED.minimum_order,
					usage_limit = EXCLUDED.usage_limit, used_count = EXCLUDED.used_count, status = EXCLUDED.status,
					starts_at = EXCLUDED.starts_at, ends_at = EXCLUDED.ends_at, icon_class = EXCLUDED.icon_class
			`,
			coupon,
		);
	}

	for (const method of shippingMethods) {
		await client.query(
			`
				INSERT INTO shipping_methods (
					name, description, carrier, price, min_delivery_days, max_delivery_days,
					status, sort_order
				)
				VALUES (${placeholders(method.length)})
				ON CONFLICT (name)
				DO UPDATE SET description = EXCLUDED.description, carrier = EXCLUDED.carrier,
					price = EXCLUDED.price, min_delivery_days = EXCLUDED.min_delivery_days,
					max_delivery_days = EXCLUDED.max_delivery_days, status = EXCLUDED.status,
					sort_order = EXCLUDED.sort_order
			`,
			method,
		);
	}

	for (const [productSlug, customerEmail, customerName, rating, review, status] of reviews) {
		await client.query(
			`
				INSERT INTO product_reviews (product_id, product_name, customer_id, customer_name, rating, review, status)
				SELECT p.id, p.name, c.id, $3, $4, $5, $6
				FROM products p
				LEFT JOIN customers c ON c.email = $2
				WHERE p.slug = $1
				AND NOT EXISTS (
					SELECT 1 FROM product_reviews pr
					WHERE pr.product_id = p.id AND pr.customer_name = $3
				)
			`,
			[productSlug, customerEmail, customerName, rating, review, status],
		);
	}

	for (const ticket of tickets) {
		await client.query(
			`
				INSERT INTO support_tickets (
					ticket_number, title, customer_id, customer_name, priority, status, assignee
				)
				VALUES (
					$1, $2, (SELECT id FROM customers WHERE email = $3), $4, $5, $6, $7
				)
				ON CONFLICT (ticket_number)
				DO UPDATE SET title = EXCLUDED.title, customer_id = EXCLUDED.customer_id,
					customer_name = EXCLUDED.customer_name, priority = EXCLUDED.priority,
					status = EXCLUDED.status, assignee = EXCLUDED.assignee
			`,
			ticket,
		);
	}

	for (const attribute of attributes) {
		await client.query(
			`
				INSERT INTO product_attributes (name, type, values, status, products_count)
				VALUES ($1, $2, $3, $4, $5)
				ON CONFLICT (name)
				DO UPDATE SET type = EXCLUDED.type, values = EXCLUDED.values,
					status = EXCLUDED.status, products_count = EXCLUDED.products_count
			`,
			attribute,
		);
	}

	await client.query("COMMIT");
	console.log(`Seeded Unimart data. Admin: ${adminEmail}`);
	if (generatedPassword) console.log(`Generated admin password for this run (shown once - change it with npm run admin:password): ${adminPassword}`);
} catch (error) {
	await client.query("ROLLBACK");
	throw error;
} finally {
	client.release();
	await pool.end();
}
