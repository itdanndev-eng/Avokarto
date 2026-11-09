import { isIP } from "node:net";
import path from "node:path";
import { pathToFileURL } from "node:url";
import nextEnv from "@next/env";

const PLACEHOLDER = /replace[-_ ]|change[-_ ]?me|your[-_ ]|^test[-_]|^secret[-_]|^x+$|^0+$/i;
const RESERVED_HOST = /(?:^|\.)(?:localhost|local|internal|invalid|test|example|example\.com|example\.net|example\.org)$/i;

function privateDatabaseHost(hostname) {
  const host = hostname.replace(/^\[|\]$/g, "").toLowerCase();
  if (host === "::1" || /^(?:fc|fd)[0-9a-f]{2}:/.test(host)) return true;
  if (!host.includes(".") && !host.includes(":")) return true;
  if (/(?:^|\.)(?:localhost|local|internal)$/.test(host)) return true;
  if (/^(?:10|127)\./.test(host) || /^192\.168\./.test(host)) return true;
  const match = host.match(/^172\.(\d+)\./);
  return Boolean(match && Number(match[1]) >= 16 && Number(match[1]) <= 31);
}

function validEmail(value) {
  const display = value.match(/^[^<>\r\n]+<([^<>\r\n]+)>$/);
  const address = display ? display[1].trim() : value;
  return /^[^<>\s@]+@[^<>\s@]+\.[^<>\s@]+$/.test(address) &&
    !RESERVED_HOST.test(address.split("@")[1]);
}

/** Offline validation only. Findings contain names and remediation, never values. */
export function validateDeploymentEnv(env, { nodeVersion = process.versions.node } = {}) {
  const errors = [];
  const warnings = [];
  const addError = (key, message) => errors.push({ key, message });
  const addWarning = (key, message) => warnings.push({ key, message });
  const value = (key) => typeof env[key] === "string" ? env[key].trim() : "";

  if (![22, 24].includes(Number(nodeVersion.split(".")[0]))) {
    addError("NODE_VERSION", "Use Node.js 22 or 24 for the production build and server.");
  }

  const origin = value("NEXT_PUBLIC_SITE_URL");
  try {
    const url = new URL(origin);
    if (
      !origin.startsWith("https://") || url.username || url.password || url.search || url.hash ||
      url.pathname !== "/" || !url.hostname.includes(".") || isIP(url.hostname.replace(/^\[|\]$/g, "")) ||
      RESERVED_HOST.test(url.hostname)
    ) throw new Error("invalid origin");
  } catch {
    addError("NEXT_PUBLIC_SITE_URL", "Set the real public HTTPS origin, without credentials, a path, query, or fragment, at both build and runtime.");
  }

  const indexable = value("SITE_INDEXABLE");
  if (!["true", "false"].includes(indexable)) {
    addError("SITE_INDEXABLE", "Set true for the public live store or false for staging/preview; the default is intentionally not indexable.");
  } else if (indexable === "false") {
    addWarning("SITE_INDEXABLE", "Search indexing is disabled. Set true only when the public live store is ready.");
  }
  if (indexable === "true" && (
    (value("VERCEL_ENV") && value("VERCEL_ENV") !== "production") ||
    (value("CONTEXT") && value("CONTEXT") !== "production")
  )) {
    addWarning("SITE_INDEXABLE", "A preview environment was detected; platform guards keep it out of search results even with this flag enabled.");
  }

  const jwtSecret = value("JWT_SECRET");
  if (jwtSecret.length < 32 || PLACEHOLDER.test(jwtSecret) || new Set(jwtSecret).size < 8) {
    addError("JWT_SECRET", "Configure a unique random secret of at least 32 characters; do not use an example or repeated-character value.");
  }

  const databaseSsl = value("DATABASE_SSL");
  if (!["true", "false"].includes(databaseSsl)) {
    addError("DATABASE_SSL", "Set true for a remote database; false is only appropriate on a protected local/private database network.");
  }
  try {
    const database = new URL(value("DATABASE_URL"));
    if (
      !["postgres:", "postgresql:"].includes(database.protocol) || !database.hostname ||
      !database.username || !database.password || database.pathname.length < 2 ||
      /^(?:host|your[-_].*)$/i.test(database.hostname) ||
      /^(?:user|password|replace[-_].*)$/i.test(decodeURIComponent(database.password))
    ) throw new Error("invalid database URL");
    const privateHost = privateDatabaseHost(database.hostname);
    if (!privateHost && (databaseSsl === "false" || database.searchParams.get("sslmode") === "disable")) {
      addError("DATABASE_SSL", "Enable TLS for a public database host and remove sslmode=disable from its connection URL.");
    } else if (privateHost && databaseSsl === "false") {
      addWarning("DATABASE_SSL", "Database TLS is disabled; ensure the database stays on a protected private network and is not publicly exposed.");
    }
    // A transaction pooler (Supabase port 6543) is fine for queries, but the
    // realtime LISTEN connection needs a session: DATABASE_SESSION_URL.
    const sessionUrl = value("DATABASE_SESSION_URL");
    const transactionPooled = /(?:^|\.)supabase\.(?:com|co)$/.test(database.hostname) && database.port === "6543";
    if (transactionPooled && !sessionUrl) {
      addError("DATABASE_SESSION_URL", "DATABASE_URL uses the transaction pooler (port 6543); also set DATABASE_SESSION_URL to the session pooler (port 5432) or direct connection for realtime LISTEN and migrations.");
    }
    if (sessionUrl) {
      try {
        const session = new URL(sessionUrl);
        if (!["postgres:", "postgresql:"].includes(session.protocol) || !session.hostname || !session.username || !session.password) throw new Error("invalid");
        if (/(?:^|\.)supabase\.(?:com|co)$/.test(session.hostname) && session.port === "6543") {
          addError("DATABASE_SESSION_URL", "Use the session pooler (port 5432) or direct connection; transaction pooling cannot hold a LISTEN session.");
        }
      } catch {
        addError("DATABASE_SESSION_URL", "Configure a complete PostgreSQL URL, or leave it unset when DATABASE_URL already uses a session connection.");
      }
    }
    if (database.searchParams.get("pgbouncer") === "true" && !sessionUrl) {
      addWarning("DATABASE_URL", "Confirm the pooler uses session mode, or set DATABASE_SESSION_URL; this app requires a persistent LISTEN connection.");
    }
  } catch {
    addError("DATABASE_URL", "Configure a complete PostgreSQL URL with real credentials, host, and database name; do not use a placeholder.");
  }

  for (const key of ["DATABASE_POOL_MAX", "DATABASE_CONNECTION_TIMEOUT_MS", "ADMIN_SESSION_DAYS", "CUSTOMER_SESSION_DAYS"]) {
    if (value(key) && (!Number.isSafeInteger(Number(value(key))) || Number(value(key)) <= 0)) {
      addError(key, "Set a positive integer or omit this optional setting to use the application default.");
    }
  }
  const bootstrapPassword = value("ADMIN_BOOTSTRAP_PASSWORD");
  if (bootstrapPassword && (bootstrapPassword.length < 16 || PLACEHOLDER.test(bootstrapPassword))) {
    addError("ADMIN_BOOTSTRAP_PASSWORD", "Remove bootstrap credentials from normal runtime, or use a unique strong password for deliberate one-off provisioning.");
  }
  if (value("ADMIN_BOOTSTRAP_EMAIL") || bootstrapPassword) {
    addWarning("ADMIN_BOOTSTRAP_EMAIL", "Provision the administrator separately and remove bootstrap credentials from the running application. Do not seed demo data into the live catalog.");
  }

  const emailKey = value("RESEND_API_KEY");
  const emailFrom = value("EMAIL_FROM");
  if (!emailKey && !emailFrom) {
    addWarning("RESEND_API_KEY / EMAIL_FROM", "Order confirmations will be skipped. Configure both values and verify the sender domain before relying on email delivery.");
  } else if (!emailKey || !emailFrom || PLACEHOLDER.test(emailKey) || !validEmail(emailFrom)) {
    addError("RESEND_API_KEY / EMAIL_FROM", "Configure both a real provider credential and a valid sender address on your verified domain.");
  }
  if (value("EMAIL_REPLY_TO") && !validEmail(value("EMAIL_REPLY_TO"))) {
    addError("EMAIL_REPLY_TO", "Use a valid reply-to mailbox on a real domain or leave it empty.");
  }
  if (!value("NEXT_PUBLIC_LIGHTGALLERY_LICENSE_KEY")) {
    addWarning("NEXT_PUBLIC_LIGHTGALLERY_LICENSE_KEY", "Verify the gallery's production licensing and configure the required public license key before release.");
  }
  const storage = (value("UPLOAD_STORAGE") || "local").toLowerCase();
  if (!["local", "s3"].includes(storage)) {
    addError("UPLOAD_STORAGE", "Use local (persistent disk) or s3 (S3-compatible bucket).");
  }
  if (storage === "s3") {
    for (const key of ["UPLOAD_S3_BUCKET", "UPLOAD_S3_ACCESS_KEY_ID", "UPLOAD_S3_SECRET_ACCESS_KEY"]) {
      if (!value(key) || PLACEHOLDER.test(value(key))) addError(key, "Required when UPLOAD_STORAGE=s3.");
    }
    if (value("UPLOAD_S3_ENDPOINT")) {
      try {
        if (new URL(value("UPLOAD_S3_ENDPOINT")).protocol !== "https:") throw new Error("insecure");
      } catch {
        addError("UPLOAD_S3_ENDPOINT", "Use the provider's https:// S3 endpoint, or leave it empty for AWS S3.");
      }
    }
  } else {
    addWarning("UPLOAD_STORAGE", "Uploads are stored on this server's disk. Prefer UPLOAD_STORAGE=s3 so images survive redeploys and are shared by every instance.");
  }
  if (value("STORE_DOMAIN_TARGET")) {
    const target = value("STORE_DOMAIN_TARGET");
    if (!/^([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/i.test(target) || RESERVED_HOST.test(target)) {
      addError("STORE_DOMAIN_TARGET", "Use a public hostname (no https://), e.g. stores.yourshop.com, that points at this server.");
    }
  }
  if (value("VERCEL") || value("AWS_LAMBDA_FUNCTION_NAME") || /lambda/i.test(value("AWS_EXECUTION_ENV"))) {
    addError("HOSTING_RUNTIME", "Use a persistent Node server; the realtime LISTEN/SSE implementation is not built for ephemeral serverless functions.");
  }

  return {
    errors,
    warnings,
    manualChecks: [
      "Apply and verify database migrations, an administrator account, active shipping methods, backups, and connectivity.",
      storage === "s3"
        ? "Run npm run uploads:migrate once to copy any existing public/uploads files into the bucket, and confirm an uploaded image loads."
        : "Provide a writable persistent public/uploads volume and backup/restore it; all instances must see the same uploads (or switch to UPLOAD_STORAGE=s3).",
      "Checkout currently records pending/unpaid orders; implement and verify a payment provider before advertising online payment collection.",
      "Verify HTTPS, cookie behavior, SSE proxy settings, sender-domain delivery, and public URL/indexability on the deployed host.",
      "Reseller custom domains: run the caddy service (deploy/caddy/Caddyfile) with SITE_DOMAIN and ACME_EMAIL set, point SITE_DOMAIN and STORE_DOMAIN_TARGET at this server, open ports 80/443, and keep the caddy-data volume (certificates) backed up - see docs/backend-deploy.md.",
    ],
  };
}

const invokedDirectly = process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;
if (invokedDirectly) {
  // Match Next's production precedence without printing loaded files or values.
  nextEnv.loadEnvConfig(process.cwd(), false, { info() {}, error() {} });
  const report = validateDeploymentEnv(process.env);
  for (const issue of report.errors) console.error(`ERROR ${issue.key}: ${issue.message}`);
  for (const issue of report.warnings) console.warn(`WARN ${issue.key}: ${issue.message}`);
  for (const check of report.manualChecks) console.log(`MANUAL ${check}`);
  console.log(report.errors.length
    ? `Deployment configuration failed: ${report.errors.length} error(s). See docs/backend-deploy.md.`
    : "Offline configuration checks passed. Complete the manual launch checks; this does not verify a deployed service.");
  process.exitCode = report.errors.length ? 1 : 0;
}
